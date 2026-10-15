/**
 * Host-half shared vocabulary: the shape of one registered connection, what a
 * kind may answer with, and the narrow structural views every module reads.
 *
 * Two shapes matter beyond the row config itself:
 *
 *   * {@link ResolvedConnection} is what a **kind** answers with — the config a
 *     `dsh-mcp-client` fiber should run, or the reason it cannot run yet. A
 *     built-in kind builds it from the entry's own fields; an integration kind
 *     builds it from `extra` plus whatever the Host can reach.
 *   * {@link ServerLive} is what the **Host** answers with — the live state of
 *     one connection, mirrored onto a volatile row field so the Web card reads
 *     it without talking to the bridge.
 *
 * Structural views stay narrow on purpose: the running host's services live in
 * its own module table, never in a local `node_modules`, so they are described
 * rather than imported (the same idiom `dsh-ancesters` uses).
 *
 * @module
 */
import type { Context } from "@deepseek-ai/cordis";
import type * as McpClient from "@deepseek-ai/dsh-mcp-client";

/** One connection as a live `dsh-mcp-client` fiber runs it. */
export type McpClientConfig = McpClient.Config;

/** One registered connection, normalized to what the whole host half speaks. */
export interface ServerEntry {
    /** Namespace and identity. */
    id: string;
    /** Which kind resolves it. */
    kind: string;
    /** Whether it starts. */
    enabled: boolean;
    /** Display label ("" falls back to `id`). */
    label: string;
    /** stdio: the executable to spawn. */
    command: string;
    /** stdio: arguments, one item each. */
    args: string[];
    /** stdio: extra environment. */
    env: Record<string, string>;
    /** stdio: working directory ("" = inherit). */
    cwd: string;
    /** stdio: where the child's stderr goes. */
    stderrMode: "console" | "log";
    /** stdio: explicit stderr log path ("" = auto). */
    stderrLog: string;
    /** http: the endpoint. */
    url: string;
    /** http: extra request headers. */
    headers: Record<string, string>;
    /** Timeout per tool call / resource request. */
    toolCallTimeoutMs: number;
    /** Ceiling for the server's instructions, in UTF-8 bytes. */
    maxInstructionBytes: number;
    /** Reject activation when the first connect fails. */
    failOnStartupError: boolean;
    /** Reconnect policy. */
    reconnect: Record<string, unknown>;
    /** Kind-owned fields. */
    extra: Record<string, string>;
}

/** One connection's live state, mirrored onto the row for the card. */
export interface ServerLive {
    /** The entry's `id` this state belongs to. */
    id: string;
    /** `off` / `starting` / `connected` / `failed` / `conflict`. */
    state: "off" | "starting" | "connected" | "failed" | "conflict";
    /** The failure line, when any. */
    error: string;
    /** Public tool names the live server published. */
    tools: string[];
    /** The kind's diagnostic note (where stderr went). Never a failure. */
    note: string;
}

/** What one kind answers for one registered connection. */
export interface ResolvedConnection {
    /** The live bridge config to run, when it can run. */
    config?: McpClientConfig;
    /** Why it cannot run, as one line the card shows verbatim. */
    error?: string;
    /** Diagnostic note — the log sink a stdio child's stderr went to. Shown
     * once under the row, never treated as a failure. */
    note?: string;
}

/** One choice a `select` field offers. */
export interface KindOption {
    /** What lands in `extra[key]` when picked. */
    value: string;
    /** What the card shows; "" or absent shows `value`. */
    label?: string;
}

/** One extra field a kind declares the card should render. */
export interface KindField {
    /** Key inside `extra` this field writes. */
    key: string;
    /** Label the card shows. */
    label: string;
    /** `string` = one line; `lines` = one item per line; `boolean` = a toggle;
     * `secret` = one line the browser never echoes back; `select` = one of
     * `options`. */
    type?: "string" | "lines" | "boolean" | "secret" | "select";
    /**
     * The choices of a `select`. A function is read **by the Host** on every
     * publish, so a kind can offer what it discovered (profiles, executables)
     * without the card importing it; call `notifyMcpKindsChanged()` when what
     * it would answer moved. A value the options stop carrying stays offered by
     * the card — a stored pick never silently becomes another one.
     */
    options?: readonly KindOption[] | (() => readonly KindOption[]);
    /** Whether the field must be filled for the connection to run. */
    required?: boolean;
    /** Pre-filled value while nothing is stored. */
    placeholder?: string;
    /** One-line help. */
    help?: string;
    /**
     * A `select` marked for the composer: the manager draws a pill in the
     * conversation input row for every **enabled** entry of this kind, offering
     * the same choices, and a pick rewrites `extra[key]` of that entry (the pool
     * switches the live connection in place).
     */
    composer?: boolean;
}

/** One button a kind offers on an entry of its own (Fetch, Relaunch…). */
export interface KindAction {
    /** Stable key; what the card's trigger names. */
    key: string;
    /** Button copy. */
    label: string;
    /** Tooltip. */
    help?: string;
    /**
     * Run it for one entry. A failure is that entry's line, never the row's;
     * `ctx.invalidate()` makes the entry prepare again (a relaunch).
     */
    run(entry: ServerEntry, ctx: KindActionContext): unknown;
}

/** What an action runs with. */
export interface KindActionContext extends KindContext {
    /** Forget what this entry prepared and reconcile it again. */
    invalidate(): void;
}

/**
 * A connection a component proposes — the standalone row config it found,
 * translated into an entry — that the card offers to create (D4). Nothing is
 * written until the person accepts it.
 */
export interface McpProposal {
    /** Stable id (the proposing row's id is a good one). */
    id: string;
    /** One line the card shows: what would be created and why. */
    title: string;
    /** The entry the card writes on accept. Its `id` is the namespace. */
    entry: Partial<ServerEntry> & { id: string; kind: string };
    /** The person said no: remember it so it is not proposed again. */
    onDismiss?(): unknown;
}

/**
 * The `mcpConnections` service the manager provides (`ctx.provide`). A
 * companion component injects it — `inject: ["mcpConnections"]` — so it runs
 * only while the manager does, and everything it registers is withdrawn with
 * it.
 */
export interface McpConnectionsService {
    /** Register a kind; the disposer is what the companion's effect returns. */
    registerKind(kind: McpKind): () => void;
    /** A `select`'s `options()` (or anything a kind answers) moved. */
    notifyKindsChanged(): void;
    /** Offer one connection to create; the disposer withdraws the offer. */
    propose(proposal: McpProposal): () => void;
    /** Every registered entry, as the row says now. */
    entries(): ServerEntry[];
    /** One entry's live line, when it has one. */
    line(id: string): ServerLive | undefined;
    /** Make one entry prepare again (relaunch, rediscover). */
    invalidate(id: string): void;
    /**
     * Rewrite one entry through the row's own write channel — what a slash
     * command does for a person without the card. Answers `false` when no
     * entry carries that id or the write was refused.
     */
    update(id: string, patch: Partial<ServerEntry>): Promise<boolean>;
}

/** What a connection kind contributes. */
export interface McpKind {
    /** Registry id, as stored in an entry's `kind`. Built-ins own `"stdio"`
     * and `"http"`. */
    id: string;
    /** Label the picker shows. */
    label: string;
    /** One line the picker shows under the label. */
    summary?: string;
    /** Whether the core registered it (`true`) or a package did (`false`) —
     * the card marks an integration differently. */
    builtIn?: boolean;
    /** Which transport fields the card keeps visible: `stdio` =
     * command/args/env/cwd, `http` = url/headers, `none` = the kind owns
     * everything through `fields`. */
    transport: "stdio" | "http" | "none";
    /** Extra fields the card renders in the entry's editor. */
    fields?: readonly KindField[];
    /** Buttons the editor offers on a saved entry of this kind. */
    actions?: readonly KindAction[];
    /** How many entries of this kind may exist; the card stops offering the
     * kind at the limit and the Host answers the extra ones `conflict`. */
    maxEntries?: number;
    /** A mark (stroke paths on a 24×24 box) for this kind's composer pill. */
    icon?: readonly string[];
    /**
     * Turn one registered entry into the bridge config to run. May answer a
     * promise when the answer needs preparing (a daemon to wait for, a browser
     * to launch): the entry reads `starting` meanwhile, prepares once per
     * entry state, and a rejection is that entry's `failed` line.
     */
    resolve(entry: ServerEntry, ctx: KindContext): ResolvedConnection | PromiseLike<ResolvedConnection>;
}

/** What a kind is handed to resolve with. */
export interface KindContext {
    /** Plugin logger — anything worth knowing belongs here, not in the mirror. */
    logger: Context["logger"];
}

/** A live bridge fiber, narrowed to what the controller calls. */
export interface BridgeFiber {
    update(config: unknown): unknown;
    dispose(): unknown;
}

/** Plugin context as the host half consumes it. */
export type PluginContext = Context;

/** Host settings service surface the form wiring consumes. */
export interface SettingsForms {
    configure(presentation: { auto?: boolean }, owner?: unknown): () => void;
    describe(options?: unknown): unknown;
}
