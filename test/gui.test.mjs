/**
 * Pruebas del arnés de procesos (reglas en `docs/knowledge/desarrollo.md`).
 *
 * Lo puro (líneas de `pgrep`, columna de puerto del `ss`, arreglo de arranque,
 * y las guardas que impiden que un id inválido señale al grupo del propio
 * lanzador) se prueba en el aire. Lo que decide el ciclo de vida real — que el
 * hijo engendrado por el server muera *con* el grupo, que el wait escale a
 * SIGKILL cuando el TERM no puede, y que quien no escucha se descarte en
 * lugar de dejarlo girando, y que lo que vive de un padre vivo es sesión y no
 * objetivo — se prueba contra el `fake-web.mjs` del `test/`, porque son las
 * reglas del spec, no una simulación.
 */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    classifyOrphans,
    defaultDshArgs,
    groupAlive,
    listByPattern,
    listenOn,
    parseListenCheck,
    parsePgrepLines,
    portFree,
    runUntil,
    signalGroup,
    startServer,
    stopGroup,
} from "../scripts/gui.mjs";

/** The harness is POSIX-only (process groups and signals — see its header):
 * the tests that spawn real processes say so on Windows instead of failing. */
const POSIX_ONLY = process.platform === "win32" && "scripts/gui.mjs is POSIX-only (process groups and signals)";

const fixture =fileURLToPath(new URL("fixtures/fake-web.mjs", import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Puerto libre, lo bastante quieto para una prueba que escucha. */
async function freePort(base = 21455) {
    // `ss` alone is not the answer: under WSL's mirrored networking a port the
    // Windows side reserved (Hyper-V/Docker excluded ranges) is free for `ss`
    // and still refuses the `bind`. So a candidate must also bind for real, and
    // when the whole fixed range is taken the OS hands out one that does.
    for (let port = base; port < base + 20; port++) {
        if (!listenOn(port) && (await canBind(port))) return port;
    }
    const port = await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port: given } = server.address();
            server.close(() => resolve(given));
        });
    });
    if (port > 0) return port;
    throw new Error("sin puerto libre para las pruebas vivas");
}

/** Whether `127.0.0.1:port` really accepts a listener right now. */
function canBind(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
}

/** El hijo largo del fixture, identificado por su marcador único. */
const childLines = (marker) => listByPattern(marker).filter((row) => row.text.includes(marker) && !row.text.includes("fake-web"));

// ── lo puro ──────────────────────────────────────────────────────────────────

test("the GUI boots the profile as the app (dsh 0.2: no `web` subcommand)", () => {
    assert.deepEqual(defaultDshArgs({ profile: "plugin-dev", port: 13955 }), [
        "--profile",
        "plugin-dev",
        "--no-open",
        "--port",
        "13955",
    ]);
});

test("the listen check reads the port off the LISTEN column, not off a random column", () => {
    const ss = [
        "State  Recv-Q Send-Q  Local Address:Port Peer Address:PortProcess",
        "LISTEN 0      4096       127.0.0.54:53        0.0.0.0:*",
        "LISTEN 0      511         127.0.0.1:13955      0.0.0.0:*    users:(\"dsh\",pid=1075260,fd=20)",
    ].join("\n");
    assert.equal(parseListenCheck(ss, 13955), true, "the measured GUI port is seen");
    assert.equal(parseListenCheck(ss, 53), true, "the system resolver is seen too");
    assert.equal(parseListenCheck(ss, 9999), false, "nobody listening there");
});

test("the listen check does not mistake one port for the tail of another", () => {
    const line = 'LISTEN 0 128 127.0.0.1:113955 0.0.0.0:* users:("dsh",pid=1,fd=2)';
    assert.equal(parseListenCheck(line, 13955), false, "113955 is not 13955");
});

test("`pgrep -af` rows carry the pid and the command line, blanks and noise aside", () => {
    const rows = parsePgrepLines("1160864 npm exec chrome-devtools-mcp\n1137968 timeout -s INT 35 dsh web --port 0\n\n  \n");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { pid: 1160864, text: "npm exec chrome-devtools-mcp" });
    assert.equal(rows[1].pid, 1137968);
});

test("a broken id never reaches the launcher's own group", () => {
    // `kill(-0, …)` and `kill(-1, …)` would signal the *harness* group itself;
    // an unread pidfile has to read as dead, not as something to kill.
    assert.equal(groupAlive(0), false);
    assert.equal(groupAlive(-1), false);
    assert.equal(signalGroup(0, "SIGTERM"), false);
});

test("startServer refuses port 0 instead of waiting on a bind that cannot be confirmed", () => {
    return assert.rejects(() => startServer({ port: 0, command: "true", args: [] }), /port 0/);
});

test("a live process is a session, not a target", () => {
    // La guarda que evita borrar la sesión en la que se está trabajando: un
    // proceso que aún vive de su padre no es un huérfano, pase lo que pase con
    // el nombre que traiga en la línea de comandos.
    const { live, orphan } = classifyOrphans([{ pid: 111 }, { pid: 222 }], {
        parentOf: (pid) => (pid === 111 ? 2 : 1),
        parentAlive: () => true,
    });
    assert.deepEqual(live.map((row) => row.pid), [111], "lo que vive de su padre se marca como intocable");
    assert.deepEqual(orphan.map((row) => row.pid), [222], "lo que quedó colgado es lo único tratable");
});

test("the children a `kill -9` left dangling are the only things cleanup may touch", () => {
    // El hijo que sobrevive al padre no tiene quien le recoja: su padre ya no
    // existe, así que entra en la lista tratable y no en la sesión ajena.
    const { live, orphan } = classifyOrphans([{ pid: 1160864, text: "npm exec chrome-devtools-mcp" }], {
        parentOf: () => 1,
        parentAlive: (ppid) => ppid !== 1,
    });
    assert.equal(live.length, 0);
    assert.equal(orphan.length, 1);
    assert.equal(orphan[0].ppid, 1);
});

test("an id whose parent vanished is reported as the parent that vanished", () => {
    const { live, orphan } = classifyOrphans([{ pid: 500 }], {
        parentOf: () => 0,
        parentAlive: () => false,
    });
    assert.equal(live.length, 0);
    assert.equal(orphan[0].ppid, 0);
});

// ── lo vivo: las cuatro reglas contra un server falso ────────────────────────

test("a live server stops by the group, and the child it spawned dies with it", { skip: POSIX_ONLY }, async () => {
    const port = await freePort();
    const marker = `gui-test-child-${port}`;
    const result = await startServer({
        command: process.execPath,
        args: [fixture, `--port=${port}`, "--child=true", `--marker=${marker}`],
        port,
        intervalMs: 50,
        timeoutMs: 5_000,
    });
    assert.equal(result.status, "live", "el falso server escuchó: se le da por válido");

    try {
        const kids = childLines(marker).filter((row) => row.pid !== result.pid);
        assert.ok(kids.length >= 1, "el server dejó un hijo en el mismo grupo");

        const forced = await stopGroup(result.pid, { graceMs: 3_000, intervalMs: 50 });
        assert.equal(forced, false, "el grupo cerró con SIGTERM: no había nada que escalar");
        assert.equal(groupAlive(result.pid), false, "el grupo ya no existe");
        assert.equal(portFree(port), true, "el puerto quedó libre");

        const deadline = Date.now() + 3_000;
        let left = [];
        while (Date.now() < deadline && (left = childLines(marker).filter((row) => row.pid !== result.pid)).length > 0) {
            await sleep(50);
        }
        assert.deepEqual(left, [], "matar al grupo alcanza al hijo (regla 4: no se deja la cabeza y sus hijos)");
    } finally {
        await stopGroup(result.pid, { graceMs: 500, intervalMs: 50 });
    }
});

test("a server that ignores SIGTERM escalates to SIGKILL instead of spinning forever", { skip: POSIX_ONLY }, async () => {
    const port = await freePort(21600);
    const result = await startServer({
        command: process.execPath,
        args: [fixture, `--port=${port}`, "--ignore-term=true"],
        port,
        intervalMs: 50,
        timeoutMs: 3_000,
    });
    assert.equal(result.status, "live", "escuchó: válido");

    try {
        const forced = await stopGroup(result.pid, { graceMs: 600, intervalMs: 50 });
        assert.equal(forced, true, "el wait venció: se escaló a SIGKILL (regla 1)");
        assert.equal(groupAlive(result.pid), false);
        assert.equal(portFree(port), true);
    } finally {
        await stopGroup(result.pid, { graceMs: 500, intervalMs: 50 });
    }
});

test("a server that never binds is discarded as an orphan, not kept as a slow start", { skip: POSIX_ONLY }, async () => {
    const result = await startServer({
        command: process.execPath,
        args: [fixture, "--no-bind=true", "--ignore-term=true", "--marker=gui-no-bind"],
        port: await freePort(21650),
        intervalMs: 50,
        timeoutMs: 600,
    });
    try {
        assert.equal(result.status, "no-bind", "CPU alta y sin bind es huérfano desde el descarte (regla 3)");
        assert.equal(result.forced, true, "no cerraba con TERM: hubo que escalar para descartarlo");
        assert.equal(groupAlive(result.pid), false, "no se quedó girando: se apagó al descartarlo");
    } finally {
        await stopGroup(result.pid, { graceMs: 500, intervalMs: 50 });
    }
});

test("a process that dies before listening is reported crashed, not live", { skip: POSIX_ONLY }, async () => {
    const result = await startServer({
        command: process.execPath,
        args: [fixture, "--exit=true", `--port=${await freePort(21690)}`],
        port: 21690,
        intervalMs: 50,
        timeoutMs: 1_500,
    });
    assert.equal(result.status, "crashed");
    assert.equal(groupAlive(result.pid), false);
});

test("run wraps with TERM and its escalation — never `timeout -s INT`", { skip: POSIX_ONLY }, async () => {
    const port = await freePort(21710);
    const result = await runUntil({
        command: process.execPath,
        args: [fixture, `--port=${port}`],
        port,
        secs: 1,
        intervalMs: 50,
    });
    assert.equal(result.status, "live", "el envoltorio llegó al vencimiento y apagó el grupo");
    assert.equal(groupAlive(result.pid), false);
    assert.equal(portFree(port), true);
});
