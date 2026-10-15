/**
 * Browser half — copy.
 *
 * Every string the card renders resolves here, one dictionary per locale, under
 * the namespace `plugin-meta.ts` names. The **locale id is what the shell
 * resolves by**: the browser client ships the ids `zh` and `en`, and the
 * fallback chain closes on `en`, so a dictionary keyed `en-US` can never be
 * reached — the keys would be echoed back as keys. Keys are merged over the
 * shared `dshAncesters` dictionaries
 * (`@comecaramelos/dsh-ancesters/client`'s `apply`, `discard`, `saving`, …) so
 * what every card says everywhere is not repeated per plugin.
 *
 * Interpolation is a plain `replace("{count}", …)` — no runtime.
 */

export const DICTIONARIES: Record<string, Record<string, string>> = {
    en: {
        connectionsCount: "{count} connection(s)",
        summaryNone: "no MCP connections",
        summaryAll: "all MCP connections are live",
        summaryPartial: "some MCP connections are not running",
        summaryBroken: "one or more MCP connections are failing",
        stateConnected: "connected",
        stateConnecting: "connecting…",
        stateFailed: "failed",
        stateConflict: "id already in use",
        stateStopped: "stopped",
        addConnection: "Add connection",
        noConnections: "No MCP connections yet. Add one to start.",
        atLimit: "This row already carries the maximum number of connections.",
        remove: "Remove this connection",
        toggleEnable: "Start this connection",
        toggleDisable: "Stop this connection",
        newConnection: "New connection",
        editConnection: "Edit connection",
        save: "Save",
        cancel: "Cancel",
        id: "Id",
        idHelp: "Namespace of the tools this server publishes: mcp__<id>__<tool>. A–Z, a–z, 0–9, “_” or “-”, up to 32 characters.",
        label: "Label",
        labelHelp: "Shown in the list. Blank shows the id.",
        kind: "Connection kind",
        kindHelp: "What actually speaks MCP here. A package that adds a transport adds its own entry to this list.",
        enabled: "Enabled",
        command: "Command",
        commandHelp: "The executable to spawn.",
        args: "Arguments",
        argsHelp: "One per line. Passed as-is, never through a shell.",
        env: "Environment",
        envHelp: "One KEY=value per line.",
        cwd: "Working directory",
        cwdHelp: "Blank inherits the harness working directory.",
        stderr: "Server stderr",
        stderrHelp: "Where the child process' console output goes.",
        stderrConsole: "Console (default)",
        stderrLog: "Log file (quieter)",
        url: "URL",
        urlHelp: "The Streamable HTTP endpoint.",
        headers: "Headers",
        headersHelp: "One Header=value per line.",
        addRow: "Add",
        removeRow: "Remove",
        proposalCreate: "Create connection",
        proposalDismiss: "Dismiss"
    }
};
