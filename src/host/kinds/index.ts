/**
 * Connection kinds — the extension seam.
 *
 * One registered connection is described by its `kind`, and a kind says what
 * the live `dsh-mcp-client` bridge should actually run. Two kinds ship with the
 * core:
 *
 *   `stdio` — a local program over stdio (child process, `command` + `args` +
 *             `env` + `cwd`), with the child's stderr routed as asked;
 *   `http`  — a running service over Streamable HTTP (`url` + `headers`).
 *
 * A companion package registers more with {@link registerMcpKind}. It keeps
 * every part of the card the core already gives a connection — the list, the
 * enable/disable toggle, the live status — and only answers `resolve()`
 * differently, typically building the same stdio or http config out of an
 * `extra` field the package owns (an executable path, a debugging port, a
 * profile name).
 *
 * The global half — a map keyed on `globalThis` under one `Symbol.for(...)`, in
 * registration order, with a disposer that gives the older answer back — is
 * `createGlobalRegistry` from `@comecaramelos/dsh-ancesters/host`: two
 * dependency trees that each resolved their own copy of this file still read
 * one map, and a companion registered into a module-local map would be
 * invisible to the controller.
 *
 * What is this plugin's own is what a registry entry means here: the shape of a
 * `McpKind`, and the rule that a kind nothing registered answers a **reason**,
 * never a stdio fallback — starting a connection nobody configured is exactly
 * what a silent default would do.
 *
 * @module
 */
import { createGlobalRegistry, type GlobalRegistry } from "@comecaramelos/dsh-ancesters/host";

import type { KindContext, McpKind, ResolvedConnection, ServerEntry } from "../types.js";
import { resolveHttpKind, resolveStdioKind } from "./builtins.js";

/** The one global kind registry, keyed by this package's own symbol. */
const REGISTRY: GlobalRegistry<McpKind> = createGlobalRegistry<McpKind>(
    Symbol.for("@comecaramelos/dsh-mcp-manager/kinds")
);

/**
 * Who wants to know that what the registry answers moved — every live
 * controller, so the card's picker and a `select`'s choices follow. Global for
 * the same reason the registry is: a companion that resolved its own copy of
 * this file must still reach the controller that is running.
 */
const LISTENERS_KEY = Symbol.for("@comecaramelos/dsh-mcp-manager/kinds-changed");
const LISTENERS: Set<() => void> = ((globalThis as Record<symbol, unknown>)[LISTENERS_KEY] ??= new Set<() => void>()) as Set<() => void>;

/**
 * Say that what the kinds answer moved: one was registered or removed, or a
 * `select` field's `options()` would now answer differently (a discovery
 * landed). Every live manager republishes its `kinds` mirror. Cheap and safe to
 * call often; a listener that throws never stops the others.
 */
export function notifyMcpKindsChanged(): void {
    for (const listener of [...LISTENERS]) {
        try {
            listener();
        } catch {
            // A controller that cannot republish is its own problem; the
            // others still hear about it.
        }
    }
}

/**
 * Hear every {@link notifyMcpKindsChanged}.
 * @returns a disposer; idempotent.
 */
export function onMcpKindsChanged(listener: () => void): () => void {
    LISTENERS.add(listener);
    return () => {
        LISTENERS.delete(listener);
    };
}

/**
 * Register one connection kind.
 *
 * A later registration for the same `id` replaces the earlier one — the
 * replacement rule an integration wants when it ships a better answer for a
 * kind the core already carries. The returned disposer is what a companion
 * plugin's `ctx.effect` calls, so a hot reload never leaves two live kinds
 * registered.
 *
 * @param kind - the kind to register.
 * @returns a disposer that removes it again (only while it still stands).
 */
export function registerMcpKind(kind: McpKind): () => void {
    if (kind === null || typeof kind !== "object" || typeof kind.id !== "string" || kind.id === "") {
        throw new TypeError("registerMcpKind: `kind.id` must be a non-empty string");
    }
    if (typeof kind.resolve !== "function") {
        throw new TypeError(`registerMcpKind(${kind.id}): \`kind.resolve\` must be a function`);
    }
    const dispose = REGISTRY.register(kind.id, kind);
    // A kind arriving (or leaving) after the manager published is exactly what
    // the picker has to follow without a restart.
    notifyMcpKindsChanged();
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        dispose();
        notifyMcpKindsChanged();
    };
}

/** Every registered kind, in registration order. */
export function listMcpKinds(): readonly McpKind[] {
    return REGISTRY.list();
}

/** Registered ids — what the card's kind picker lists. */
export function listMcpKindIds(): readonly string[] {
    return REGISTRY.ids();
}

/** The kind registered under `id`, or undefined. */
export function getMcpKind(id: string): McpKind | undefined {
    return REGISTRY.get(id);
}

/**
 * Resolve one registered entry through its kind.
 *
 * An unknown `kind` answers with the reason rather than silently falling back
 * to stdio: a registered-but-unresolvable entry is the one failure mode the
 * card cannot fix on its own (the package that owns the kind is not installed,
 * or registered after this entry was saved), and guessing here would start a
 * connection the user never configured.
 */
export function resolveMcpKind(entry: ServerEntry, ctx: KindContext): ResolvedConnection | PromiseLike<ResolvedConnection> {
    const answer = REGISTRY.resolve(entry.kind, (id) => `kind "${id}" is not registered (no package that answers it is loaded)`);
    if (answer.entry === void 0) return { error: String(answer.answer) };
    return answer.entry.resolve(entry, ctx);
}

/** The kinds this plugin ships with. Registration is idempotent: a hot reload
 * replaces the previous copy rather than leaving two live registrations. */
export const builtInKinds: readonly McpKind[] = [
    {
        id: "stdio",
        label: "Local command (stdio)",
        summary: "Spawn a local MCP server as a child process.",
        builtIn: true,
        transport: "stdio",
        resolve: resolveStdioKind
    },
    {
        id: "http",
        label: "HTTP (Streamable HTTP)",
        summary: "Connect to a running MCP service over Streamable HTTP.",
        builtIn: true,
        transport: "http",
        resolve: resolveHttpKind
    }
];

for (const kind of builtInKinds) REGISTRY.register(kind.id, kind);
