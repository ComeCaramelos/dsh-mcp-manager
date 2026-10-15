/**
 * Arranque y apagado *supervisados* del GUI para las comprobaciones vivas.
 *
 * Las comprobaciones vivas dejaron seis familias de procesos que se
 * quedaban vivos cuando no deberían, y de ahí salen cinco reglas: cuatro para que no
 * queden, y una para que la limpieza no borre lo que está vivo. Éste es el
 * cuerpo que las cumple (guía en `docs/knowledge/desarrollo.md`):
 *
 *   1. **Regla 1** — se apaga por `SIGTERM` y *se espera*; sólo se escala a
 *      `SIGKILL` si el wait vence. Un `kill -9` sobre `dsh` deja vivas las
 *      fibras `dsh-mcp-client`: son hijas, no threads.
 *   2. **Regla 2** — nunca se entrega `SIGINT`; y si un arnés ajeno envuelve,
 *      que sea `timeout --signal=TERM --kill-after=…`, nunca `-s INT` a mano.
 *   3. **Regla 3** — no se da el proceso por válido hasta que *escucha*: un
 *      `dsh` que no hace `bind` es un huérfano desde el instante en que se
 *      descarta, y aquí se descarta y se le mata, no se le deja girando.
 *   4. **Regla 4** — se levanta en su propio grupo (la `detached` de Node hace
 *      de `setsid`), de modo que matar al grupo alcanza también a lo que las
 *      fibras arranquen (p. ej. `npm exec chrome-devtools-mcp`).
 *   5. **Regla 5** — al limpiar por nombre, primero se mira al padre: lo que
 *      vive de un padre vivo es una sesión, no un sobrante, y no se toca. Un
 *      `pgrep` que la alcance y se borre carga la mesa de trabajo entera.
 *
 * Y al apagar, la comprobación final del spec: que `pgrep` no deje nada y que
 * `ss` ya no muestre el puerto.
 *
 * Sólo POSIX: las reglas son sobre grupos y señales; en Windows no hay
 * nada de eso que sostener.
 *
 * ```sh
 * node scripts/gui.mjs start   [--profile plugin-dev] [--port 13955] [--dsh dsh] [--timeout-ms 30000]
 * node scripts/gui.mjs run     [--secs 35] [--profile …] [--port …] [-- <program y sus args>]
 * node scripts/gui.mjs stop    [--profile plugin-dev] [--port 13955]
 * node scripts/gui.mjs status  [--profile plugin-dev] [--port 13955]
 * node scripts/gui.mjs cleanup [--profile plugin-dev] [--port 13955] [--yes]
 * ```
 *
 * El estado es la pareja `<state>/<profile>.pid` (el pgid) y `<state>/<profile>.log`
 * (lo que `dsh` escribe, que también es donde `dsh-mcp-client` deja su stderr).
 */
import { spawn, execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Defaults del ritual medido (`--profile plugin-dev --port 13955`). */
const PROFILE = "plugin-dev";
const PORT = 13955;

/** Espera del wait antes de escalar a `SIGKILL` (regla 1: `seq 1 10` × 0.5 s). */
const GRACE_MS = 5_000;
/** Paso de sondeo del wait y del bind. */
const INTERVAL_MS = 500;
/** Cómo máximo se espera a que `dsh` escuche antes de considerarlo arranque caído. */
const START_TIMEOUT_MS = 30_000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ── lo puro: lo que el diff del proceso *decide*, aislado de las señales ──

/** El arreglo con el que `dsh` arranca el GUI del perfil (en 0.2 el perfil es la app). */
export function defaultDshArgs({ profile = PROFILE, port = PORT } = {}) {
    return ["--profile", profile, "--no-open", "--port", String(port)];
}

/** Qué es huérfano: cabeceos del GUI *del perfil* y el chrome-devtools-mcp que engendra.
 *
 *  Un `dsh` que no lleve `--profile <perfil>` es de otro sitio: puede ser justo la
 *  sesión en la que se está trabajando, y eso no es huérfano. Por eso el patrón va
 *  anclado al perfil, y por eso lo que sí lo es lo decide `classifyOrphans`, que
 *  nunca toca algo con su padre vivo.
 */
export function defaultOrphanPattern({ profile = PROFILE } = {}) {
    return `(dsh\\b[^|]*--profile[= ]${escapeRe(profile)}\\b|chrome-devtools-mcp)`;
}

/** `pgrep -af` → filas con id y línea de comando. */
export function parsePgrepLines(output) {
    const rows = [];
    for (const line of String(output ?? "").split(/\r?\n/)) {
        const hit = /^(\d+)\s+(.*)$/.exec(line);
        if (hit) rows.push({ pid: Number(hit[1]), text: hit[2] });
    }
    return rows;
}

/** `pgrep` lista, ya filtrable. */
export function listByPattern(pattern, { exec = run } = {}) {
    try {
        return parsePgrepLines(exec("pgrep", ["-af", pattern]));
    } catch {
        // pgrep devuelve 1 cuando no caza nada: es el caso limpio, no un error.
        return [];
    }
}

/** Qué vive en un puerto: la columna `Local Address:Port` del `LISTEN`. */
export function parseListenCheck(output, port) {
    const wanted = String(port);
    for (const line of String(output ?? "").split(/\r?\n/)) {
        if (!line.includes("LISTEN")) continue;
        const local = line.split(/\s+/)[3] ?? "";
        if (local.endsWith(`:${wanted}`)) return true;
    }
    return false;
}

/** El puerto está escuchando ahora mismo. */
export function listenOn(port) {
    try {
        return parseListenCheck(run("ss", ["-tlnp"]), port);
    } catch {
        return false;
    }
}

/** ¿El grupo sigue vivo? La señal 0 no mata: pregunta. Con un id inválido
 *  `kill(-0, …)` alcanzaría al grupo del propio lanzador, así que no se pregunta. */
export function groupAlive(pgid) {
    if (!(pgid > 1)) return false;
    try {
        process.kill(-pgid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Lo mismo, pero con el id *propio*: un suelto ya muerto conteste `false`. */
export function pidAlive(pid) {
    if (!(pid > 1)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** `pgid` de un proceso cualquiera: lo que hay que matar cuando nadie lo organizó. */
export function groupOf(pid) {
    try {
        const out = run("ps", ["-o", "pgid=", "-p", String(pid)]);
        const pgid = Number(out.trim());
        return Number.isFinite(pgid) && pgid > 0 ? pgid : pid;
    } catch {
        return pid;
    }
}

/** `ppid` de un proceso, o `0` si ya no está localizable. */
export function ppidOf(pid) {
    try {
        const ppid = Number(run("ps", ["-o", "ppid=", "-p", String(pid)]).trim());
        return Number.isFinite(ppid) && ppid > 0 ? ppid : 0;
    } catch {
        return 0;
    }
}

/** El lanzador propio: lo que *no* es un hijo huérfano que limpiar.
 *  `dsh web` arranca al GUI y al `npm exec chrome-devtools-mcp`, así que esa línea
 *  pertenece a una sesión viva, y si se matase se cargaría la sesión misma. */
export function launcherText() {
    return process.argv.slice(0, 2).join(" ");
}

// ── lo con señales: apagar por grupo, con wait y escalado (reglas 1 y 4) ──

/** Entrega una señal al grupo, si el grupo todavía existe. Igual que `groupAlive`:
 *  con un id inválido `kill(-0, …)` mataría al grupo del propio lanzador. */
export function signalGroup(pgid, signal) {
    if (!(pgid > 1)) return false;
    try {
        process.kill(-pgid, signal);
        return true;
    } catch {
        return false;
    }
}

/**
 * Apaga el grupo: `SIGTERM`, espera, y `SIGKILL` sólo si el wait venció
 * (regla 1). `SIGINT` no se entrega nunca: no apaga a `dsh web` y deja al
 * envoltorio esperando para siempre (regla 2).
 */
export async function stopGroup(pgid, { graceMs = GRACE_MS, intervalMs = INTERVAL_MS } = {}) {
    signalGroup(pgid, "SIGTERM");
    const deadline = Date.now() + Math.max(graceMs, intervalMs);
    while (groupAlive(pgid) && Date.now() < deadline) await sleep(intervalMs);
    let forced = false;
    if (groupAlive(pgid)) {
        forced = true;
        signalGroup(pgid, "SIGKILL");
        const killDeadline = Date.now() + Math.max(graceMs, intervalMs);
        while (groupAlive(pgid) && Date.now() < killDeadline) await sleep(intervalMs);
    }
    return forced;
}

/** Lo mismo sobre la cabecera que sea, para huérfanos que nadie organizó en grupo propio. */
export async function stopOne(pid, options) {
    return stopGroup(groupOf(pid), options);
}

/**
 * El hijo sale en su propio grupo, como `setsid dsh … >"$log" 2>&1 &`:
 * `detached` hace de `setsid`, y con `stdio` apuntando al log no hay terminal
 * que lo ate al lanzador. Hay que devolver *inmediatamente*: `spawnSync`
 * espera, así que va con `spawn` y `unref`.
 */
export function spawnGroup({ command, args, logPath, stdio = ["ignore", "ignore", "ignore"] }) {
    const fds = logPath ? [0, 1, 2].map((fd) => (fd === 0 ? "ignore" : openSync(logPath, "a"))) : stdio;
    const child = spawn(command, args, { detached: true, stdio: fds, shell: false });
    for (const fd of fds) if (typeof fd === "number") closeSync(fd);
    child.unref();
    return { pid: child.pid };
}

/**
 * Arranca el GUI y *confirma escucha* antes de darlo por válido (regla 3).
 * Un arranque caído se descarta y se apaga por grupo, no se deja girando.
 */
export async function startServer({
    command = "dsh",
    args = defaultDshArgs({ profile: PROFILE, port: PORT }),
    port = PORT,
    logPath,
    timeoutMs = START_TIMEOUT_MS,
    intervalMs = INTERVAL_MS,
} = {}) {
    if (!(port > 0)) throw new Error("gui: el puerto tiene que ser fijo (port 0 no permite comprobar escucha)");

    const launched = spawnGroup({ command, args, logPath });
    if (!launched.pid) return { status: "crashed", pid: null, log: "" };
    const pgid = launched.pid;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (listenOn(port)) return { status: "live", pid: pgid };
        if (!groupAlive(pgid)) {
            await stopGroup(pgid, { graceMs: 1_000, intervalMs });
            return { status: "crashed", pid: pgid };
        }
        await sleep(intervalMs);
    }

    // CPU alta y sin bind = muerto esperando: descartar y apagar, no esperar más.
    const forced = await stopGroup(pgid, { graceMs: 3_000, intervalMs });
    return { status: "no-bind", pid: pgid, forced };
}

/** Comprueba final: ni procesos. El `ss` del puerto lo revisa `portFree`. */
export function leftoverOrphans({ pattern = defaultOrphanPattern() } = {}) {
    return listByPattern(pattern).filter((row) => row.pid !== process.pid);
}

/**
 * Lo que lista el patrón se divide por su padre, y eso decide qué es tratable.
 *
 * El `kill -9` de la regla 1 deja *hijos* colgados: ya no tienen quien les
 * recoja, y sólo se van por la señal. Ésos son huérfanos, y para eso está el
 * `cleanup`. Lo contrario también hay que saberlo: algo con su padre vivo no es
 * huérfano, y puede ser exactamente la sesión que está en pantalla — borrarlo
 * desde aquí es cargarla.
 *
 * Por eso esto es la única puerta para matar por nombre: lo que se lista se
 * clasifica antes de considerarse, y `--yes` no tiene ninguna alternativa que
 * diga "aunque tenga padre, mátalo igual".
 */
export function classifyOrphans(rows, { parentOf = ppidOf, parentAlive = pidAlive } = {}) {
    const live = [];
    const orphan = [];
    for (const row of rows) {
        const ppid = parentOf(row.pid);
        if (ppid > 1 && parentAlive(ppid)) live.push({ ...row, ppid });
        else orphan.push({ ...row, ppid });
    }
    return { live, orphan };
}

/** Grupos grabados por `start` en el state dir, cualquier perfil. */
export function recordedGroups(stateDir) {
    const groups = [];
    if (!stateDir || !existsSync(stateDir)) return groups;
    for (const name of readdirSync(stateDir)) {
        if (!name.endsWith(".pid")) continue;
        const profile = name.slice(0, -4);
        const pgid = readPidFile(resolve(stateDir, name));
        if (groupAlive(pgid)) groups.push({ profile, pgid });
    }
    return groups;
}

/** El `ss` del puerto ya está limpio. */
export function portFree(port) {
    return !(port > 0) ? true : !listenOn(port);
}

function escapeRe(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function run(command, args) {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * @param {{ command: string, argv: string[] }} call
 * @param {{ stateDir?: string, log?: (line: string) => void }} io
 */
export async function guiCli({ command, argv }, { stateDir = resolve(root, ".gui"), log = (line) => console.log(line) } = {}) {
    const opts = parseFlags(argv);
    const profile = opts.profile ?? PROFILE;
    const port = Number(opts.port ?? PORT);
    if (process.platform === "win32") {
        log("gui: las reglas son de grupos y señales POSIX; aquí no hay grupo que sostener");
        return 2;
    }

    const pidFile = resolve(stateDir, `${profile}.pid`);
    const logFile = resolve(stateDir, `${profile}.log`);
    const state = () => readPidFile(pidFile);
    const writeState = (pgid) => {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(pidFile, `${pgid}\n`, "utf8");
    };
    const stageState = () => mkdirSync(stateDir, { recursive: true });

    switch (command) {
        case "start": {
            // Con `--` se lanza lo que se pida (un server falso, un gateway) en
            // lugar del GUI del perfil: sigue siendo supervisado, mismo grupo y
            // misma confirmación de escucha.
            const rest = opts._ ?? [];
            const dsh = rest.length > 0 ? rest[0] : (opts.dsh ?? "dsh");
            const dshArgs = rest.length > 0 ? rest.slice(1) : [...defaultDshArgs({ profile, port }), ...(opts._extra ?? [])];
            if (existsSync(pidFile) && groupAlive(state())) {
                log(`gui: ya está arriba (grupo ${state()}, puerto ${port})`);
                return listenOn(port) ? 0 : 1;
            }
            stageState();
            const result = await startServer({
                command: dsh,
                args: dshArgs,
                port,
                logPath: logFile,
                timeoutMs: Number(opts["timeout-ms"] ?? START_TIMEOUT_MS),
            });
            if (result.status === "live") {
                writeState(result.pid);
                log(`gui: vivo (grupo ${result.pid}, puerto ${port}) — log ${logFile}`);
                return 0;
            }
            rmSync(pidFile, { force: true });
            log(`gui: ${describe(result)}`);
            return result.status === "crashed" ? 4 : 3;
        }
        case "run": {
            const secs = Number(opts.secs ?? 35);
            const rest = opts._ ?? [];
            const commandLine = rest.length > 0 ? rest[0] : (opts.dsh ?? "dsh");
            const args = rest.length > 0 ? rest.slice(1) : defaultDshArgs({ profile, port });
            stageState();
            const result = await runUntil({
                command: commandLine,
                args,
                port,
                secs,
                logPath: logFile,
                intervalMs: INTERVAL_MS,
            });
            log(`gui: ${describe(result)} — log ${logFile}`);
            return result.status === "live" || result.status === "exited" ? 0 : 3;
        }
        case "stop": {
            const pgid = state();
            if (!groupAlive(pgid)) {
                log("gui: no hay nada levantado desde aquí");
                rmSync(pidFile, { force: true });
                return portFree(port) ? 0 : 1;
            }
            const forced = await stopGroup(pgid, { graceMs: Number(opts["grace-ms"] ?? GRACE_MS), intervalMs: INTERVAL_MS });
            rmSync(pidFile, { force: true });
            // El final del spec: ni procesos ni puerto. Sólo cuenta lo que quedó
            // *huérfano*; lo que tiene su padre vivo es otra sesión, y no es mérito
            // ni demérito de este apagado.
            const hits = leftoverOrphans({ pattern: defaultOrphanPattern({ profile }) });
            const { live, orphan } = classifyOrphans(hits);
            const clean = orphan.length === 0 && portFree(port);
            log(`gui: apagado (grupo ${pgid}${forced ? ", escalado a SIGKILL" : ""})${clean ? " — limpio" : ""}`);
            for (const row of live) log(`gui: (ajeno) vivo con padre ${row.ppid}: ${row.pid} ${row.text}`);
            for (const row of orphan) log(`gui: queda huérfano ${row.pid} ${row.text}`);
            return clean ? 0 : 1;
        }
        case "cleanup": {
            const pattern = opts.pattern ?? defaultOrphanPattern({ profile });
            const hits = leftoverOrphans({ pattern });
            const { live, orphan } = classifyOrphans(hits);
            const recorded = recordedGroups(stateDir).filter((group) => group.profile === profile || opts.all === true);

            // Lo grabado por este mismo `start` es nuestro, siempre: puede estar
            // colgado o puede estar todavía al día, pero lo levantamos nosotros.
            const targets = [
                ...recorded.map((group) => ({ pid: group.pgid, text: `grupo grabado (${group.profile})`, recorded: true, profile: group.profile })),
                ...orphan,
            ];
            for (const row of live) log(`gui: (intocable) ${row.pid} ${row.text} vive de su padre ${row.ppid}`);

            if (targets.length === 0) {
                const clean = portFree(port);
                log(`gui: no queda nada${clean ? "" : ` — el puerto ${port} sigue escuchando`}`);
                return clean ? 0 : 1;
            }

            if (opts.yes !== true) {
                for (const row of targets) log(`gui: apagaría ${row.pid} ${row.text}`);
                log("gui: falta --yes para apagarlos");
                return 1;
            }

            let forcedAny = false;
            for (const row of targets) {
                const forced = row.recorded
                    ? await stopGroup(row.pid, { graceMs: GRACE_MS, intervalMs: INTERVAL_MS })
                    : await stopOne(row.pid, { graceMs: GRACE_MS, intervalMs: INTERVAL_MS });
                forcedAny = forcedAny || forced;
                if (row.recorded) rmSync(resolve(stateDir, `${row.profile}.pid`), { force: true });
                log(`gui: apagado ${row.pid}${forced ? " (escaló a SIGKILL)" : ""}`);
            }

            const after = leftoverOrphans({ pattern });
            const reclassified = classifyOrphans(after);
            const still = reclassified.orphan.filter((row) => !targets.some((t) => t.pid === row.pid) || groupAlive(groupOf(row.pid)));
            const clean = still.length === 0 && portFree(port);
            if (!clean) for (const row of still) log(`gui: sigue huérfano ${row.pid} ${row.text}`);
            return clean ? 0 : 1;
        }
        case "status": {
            const pgid = state();
            const alive = groupAlive(pgid);
            const listening = listenOn(port);
            log(`gui: grupo ${pgid || "?"} ${alive ? (listening ? "vivo" : "vivo, sin escuchar") : "muerto"} (puerto ${port}${listening ? " escuchando" : " sin escuchar"})`);
            return alive && listening ? 0 : 1;
        }
        default:
            log(`gui: comando desconocido "${command}" (start | run | stop | status | cleanup)`);
            return 2;
    }
}

/** Regla 2 convertida en código: envolver con `TERM` y escalado, nunca `-s INT`.
 *  Sustituye al `timeout --signal=TERM --kill-after=10s … ; wait` del ritual. */
export async function runUntil({ command, args, port, secs, logPath, intervalMs = INTERVAL_MS }) {
    const launched = spawnGroup({ command, args, logPath });
    if (!launched.pid) return { status: "crashed", pid: null };
    const pgid = launched.pid;

    const upTo = Date.now() + Math.max(0, secs) * 1_000;
    // Sin puerto fijo no hay escucha que confirmar: se espera igualmente, con
    // escalado, y se apaga al vencer — nunca `timeout -s INT`, nunca esperar a
    // un hijo que no cierra.
    const bound = port > 0 ? await waitUntilBind({ pgid, port, deadline: upTo, intervalMs }) : groupAlive(pgid);
    if (!bound) {
        const forced = await stopGroup(pgid, { graceMs: 3_000, intervalMs });
        return { status: "no-bind", pid: pgid, forced };
    }
    let endedEarly = false;
    while (Date.now() < upTo && groupAlive(pgid)) await sleep(Math.min(intervalMs, Math.max(0, upTo - Date.now()) + 1));
    if (!groupAlive(pgid)) endedEarly = true;
    const forced = endedEarly ? false : await stopGroup(pgid, { graceMs: GRACE_MS, intervalMs });
    return endedEarly ? { status: "exited", pid: pgid } : { status: "live", pid: pgid, forced };
}

async function waitUntilBind({ pgid, port, deadline, intervalMs }) {
    while (Date.now() < deadline) {
        if (listenOn(port)) return true;
        if (!groupAlive(pgid)) return false;
        await sleep(intervalMs);
    }
    return false;
}

function describe(result) {
    switch (result.status) {
        case "live":
            return `vivo (grupo ${result.pid}${result.forced ? ", con escalado" : ""})`;
        case "exited":
            return `el proceso cerró por su cuenta (grupo ${result.pid})`;
        case "no-bind":
            return `arranque caído: no llegó a escuchar; se apagó el grupo ${result.pid}${result.forced ? " escalando a SIGKILL" : ""}`;
        default:
            return `el proceso cayó antes de escuchar (grupo ${result.pid})`;
    }
}

function readPidFile(path) {
    if (!existsSync(path)) return 0;
    const value = Number(String(readFileSync(path, "utf8")).trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseFlags(argv) {
    const out = { _: [], _extra: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--") {
            out._ = argv.slice(i + 1);
            break;
        }
        const flag = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
        if (!flag) {
            out._extra.push(arg);
            continue;
        }
        const key = flag[1];
        if (key === "yes") out.yes = true;
        else if (key === "pattern") out.pattern = flag[2] ?? argv[++i];
        else if (flag[2] === void 0) out[key] = argv[++i];
        else out[key] = flag[2];
    }
    return out;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (invoked && process.platform === "win32") {
    // Process groups, POSIX signals, `ss` and `pgrep` are what every rule here
    // stands on; on Windows there is nothing of it to hold, so say so instead
    // of half-running.
    console.error("gui.mjs: POSIX-only (WSL/Linux/macOS) — on Windows, start dsh directly and stop it from its own console");
    process.exitCode = 2;
} else if (invoked) {
    const [, , command = "status", ...argv] = process.argv;
    process.exitCode = await guiCli({ command, argv });
}
