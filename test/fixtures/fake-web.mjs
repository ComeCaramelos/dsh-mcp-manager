/**
 * Servidor falso para las pruebas vivas del arnés de procesos: hace `bind` en
 * el puerto y deja un hijo largo, exactamente las dos cosas que los huérfanos
 * medidos hacían (`dsh web` escuchando, `npm exec chrome-devtools-mcp` debajo).
 *
 *   --port=N        escuchar en 127.0.0.1:N
 *   --no-bind       no escuchar nunca (arranque caído con CPU/vida igual)
 *   --child         engordar un hijo largo en el mismo grupo
 *   --ignore-term   no cerrar con SIGTERM: obliga a escalar a SIGKILL
 *   --exit          morir enseguida, antes de que nadie confirme escucha
 */
import { spawn } from "node:child_process";
import net from "node:net";

const arg = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const port = Number(arg("port", 0));
const bind = arg("no-bind", "false") !== "true";
const withChild = arg("child", "false") === "true";
const ignoreTerm = arg("ignore-term", "false") === "true";
const marker = arg("marker", "gui-test-child");

if (arg("exit", "false") === "true") process.exit(0);

if (withChild) {
    // El hijo queda en el MISMO grupo del servidor: es lo que hace que matar al
    // grupo lo alcance, y matar sólo a la cabecera lo deje vivo.
    const child = spawn(process.execPath, ["-e", `setTimeout(() => {}, 60_000); void 0`, marker], {
        detached: false,
        stdio: "ignore",
    });
    child.unref();
}

if (bind && port > 0) {
    net.createServer().listen(port, "127.0.0.1");
}

// Vive hasta que la señal lo lleve: exactamente el comportamiento del GUI.
const keep = setInterval(() => {}, 1 << 30);
if (ignoreTerm) {
    // Con SIGTERM *vacía*, la cabecera sólo cesa por SIGKILL; los hijos del
    // grupo pueden morir ya con el TERM, así que el wait del grupo tiene que
    // vencer y escalar.
    process.on("SIGTERM", () => {});
} else {
    process.on("SIGINT", () => clearInterval(keep) || process.exit(130));
    process.on("SIGTERM", () => clearInterval(keep) || process.exit(0));
}
