/**
 * Built-in connection kinds — the two shapes the core speaks, plus the stdio
 * stderr routing that makes a `stderr` connection quiet when it needs to be.
 *
 * `stdio` spawns the server as a child process and speaks the protocol over
 * its stdin/stdout. The child's stderr is the one stream the transport does not
 * own, and where it goes is a per-entry decision:
 *
 *   `console` — inherit it (the plain dsh default, and what the transport does
 *              when nothing is said);
 *   `log`     — launch it through a small Node wrapper that keeps stdout as the
 *              protocol stream and redirects stderr into a private log file, so
 *              a chatty server stops printing over the harness. Same route on
 *              Linux, WSL and Windows.
 *
 * The wrapping itself is `buildSpawn` from `@comecaramelos/dsh-ancesters/host`
 * — one implementation for every plugin that spawns a bridge, so a change to
 * how stderr is captured lands once.
 *
 * @module
 */
import { buildSpawn } from "@comecaramelos/dsh-ancesters/host";

import type { KindContext, McpClientConfig, ResolvedConnection, ServerEntry } from "../types.js";

/** `stdio` kind: a local command, with its stderr routed as asked. */
export function resolveStdioKind(entry: ServerEntry, _ctx: KindContext): ResolvedConnection {
    if (entry.command.trim() === "") {
        return { error: `connection "${entry.id}": kind "stdio" needs a command to spawn` };
    }
    const spawned = buildSpawn({
        command: entry.command,
        args: entry.args,
        stderr: entry.stderrMode === "log" ? "log" : entry.stderrMode,
        logPath: entry.stderrLog === "" ? undefined : entry.stderrLog,
        serverName: entry.id
    });
    const config: McpClientConfig = {
        serverName: entry.id,
        transport: "stdio",
        command: spawned.command,
        args: spawned.args,
        env: entry.env,
        cwd: entry.cwd,
        toolCallTimeoutMs: entry.toolCallTimeoutMs,
        maxInstructionBytes: entry.maxInstructionBytes,
        failOnStartupError: entry.failOnStartupError,
        reconnect: entry.reconnect
    };
    if (spawned.redirect !== "") return { config, note: `stderr → ${spawned.redirect}` };
    return { config };
}

/** `http` kind: a running service over Streamable HTTP. */
export function resolveHttpKind(entry: ServerEntry): ResolvedConnection {
    const url = entry.url.trim();
    if (url === "") {
        return { error: `connection "${entry.id}": kind "http" needs a URL to connect to` };
    }
    const config: McpClientConfig = {
        serverName: entry.id,
        transport: "streamable-http",
        url,
        headers: entry.headers,
        toolCallTimeoutMs: entry.toolCallTimeoutMs,
        maxInstructionBytes: entry.maxInstructionBytes,
        failOnStartupError: entry.failOnStartupError,
        reconnect: entry.reconnect
    };
    return { config };
}
