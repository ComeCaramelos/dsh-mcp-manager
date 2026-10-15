/**
 * The single zod `Config` of the plugin row.
 *
 * Since dsh 0.2.0 the Web GUI card edits the **row configuration** through the
 * profile's configuration form — one `Config`, keyed by the row's profile entry
 * id. So one schema carries everything the card reads and writes, and every
 * field is declared `.volatile()`: user edits land in the profile patch instead
 * of `settings.yaml`, a form edit commits without remounting, and a live value
 * the Host publishes never reaches the patch (the write path strips volatile
 * fields before merging, and a volatile-only diff persists nothing).
 *
 * Volatile marks stand on the **top-level fields only**, never on anything
 * inside one entry: cordis wants a fixed object path with no enclosing volatile
 * field, so a `.volatile()` sitting inside the items of a volatile array is a
 * config error that takes the whole row down — verified live against dsh
 * 0.2.0-rc.2, where a row marked that way answers `ValidationError` and
 * activates nothing.
 *
 * What makes the list work as *several* connections is that `servers` is one
 * volatile array rather than one field group per connection: the card appends,
 * edits and removes items, and the reconciler turns each live item into a
 * `dsh-mcp-client` fiber — which is also why the enable/disable toggle is an
 * ordinary field write rather than a plugin-level install.
 *
 * Validation lives with the **Host**, not in the field patterns, for one
 * reason: a malformed hand-edited entry must not fail the whole row (dsh would
 * drop every other connection with it). An entry the Host cannot resolve
 * answers as that entry's own `failed`/`conflict` state, while every other
 * connection stays live. The one exception is `args`: a control character can
 * corrupt the argv framing of a spawned child, so the field's own pattern
 * refuses it.
 */
import z from "@deepseek-ai/schemastery";

import { ARG_PATTERN, MAX_SERVERS } from "./constants.js";

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
export const Reconnect = z.object({
    enabled: z.boolean().default(true),
    initialDelayMs: z.number().min(1).max(600000).default(500),
    maxDelayMs: z.number().min(1).max(600000).default(30000),
    maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10)
});

/**
 * One registered MCP connection.
 *
 * `id` is both the identity inside the list and the live namespace
 * (`mcp__<id>__<tool>`), so it doubles as the bridge's `serverName` and the key
 * every toggle, status line and delete addresses. Two live entries claiming one
 * namespace is answered as `conflict` for the later one, not silently dropped.
 */
export const ServerEntry = z.object({
    /** Namespace and identity: `[A-Za-z0-9_-]{1,32}`, unique while live. */
    id: z.string().default(""),
    /** Which kind resolves this entry: `stdio` and `http` ship with the core;
     * anything else is whatever a companion package registered. */
    kind: z.string().default("stdio"),
    /** Start this connection at boot? An off entry is kept, never deleted. */
    enabled: z.boolean().default(true),
    /** Display label; "" falls back to `id`. */
    label: z.string().default(""),

    // ---- stdio (the local "stderr" connection) ----------------------------
    /** Executable to spawn. */
    command: z.string().default(""),
    /** Arguments, one item each, no shell interpolation. Control characters
     * are refused here, by the field's own pattern, because they corrupt the
     * argv framing of the spawned child before anything can validate them. */
    args: z.array(z.string().pattern(ARG_PATTERN)).default([]),
    /** Extra environment, merged over the scrubbed ambient env. */
    env: z.dict(z.string()).default({}),
    /** Working directory for the child; "" = inherit. */
    cwd: z.string().default(""),
    /** Where the child's stderr goes: `console` (inherit — the dsh default) or
     * `log` (redirect into a file, so a chatty server stops printing over the
     * harness). Ignored by the http kind. */
    stderrMode: z.union([z.const("console"), z.const("log")]).default("console"),
    /** Log path override for `log` mode; "" = one auto path per spawn. */
    stderrLog: z.string().default(""),

    // ---- http (Streamable HTTP) -------------------------------------------
    /** MCP endpoint. */
    url: z.string().default(""),
    /** Extra request headers. */
    headers: z.dict(z.string()).default({}),

    // ---- shared -----------------------------------------------------------
    /** Timeout per tool call / resource request, in milliseconds. */
    toolCallTimeoutMs: z.number().min(1).max(3600000).default(60000),
    /** Ceiling for the server's instructions, in UTF-8 bytes. */
    maxInstructionBytes: z.number().step(1).min(1).default(32768),
    /** Reject activation when the first connect or tool sync fails. */
    failOnStartupError: z.boolean().default(false),
    /** Automatic reconnect policy after a lost connection. */
    reconnect: Reconnect,

    /** Kind-owned fields. The card renders whatever the kind declares; the
     * core never reads them. */
    extra: z.dict(z.string().max(4096)).default({})
});

/** One connection's live state. Host-published; never user-authored. */
export const ServerLive = z.object({
    /** The entry's `id` this state belongs to. */
    id: z.string().default(""),
    /** `off` / `starting` / `connected` / `failed` / `conflict`. */
    state: z.string().default("off"),
    /** The failure or notice line, when any. */
    error: z.string().default(""),
    /** Public tool names the live server published. */
    tools: z.array(z.string()).default([]),
    /** The kind's own diagnostic note (where stderr went, what it resolved
     * to). Never a failure. */
    note: z.string().default("")
});

/**
 * One registered connection kind, projected for the card.
 *
 * The Host answers this, never the user: it is what the picker offers and what
 * decides which extra fields an entry's editor renders. Answering it through
 * the mirror is what makes a companion package's kind show up in the picker
 * without the card importing that package.
 */
export const KindInfo = z.object({
    id: z.string().default(""),
    label: z.string().default(""),
    summary: z.string().default(""),
    /** `stdio` / `http` / `none` — which transport fields the editor keeps. */
    transport: z.string().default("none"),
    fields: z.array(z.object({
        key: z.string().default(""),
        label: z.string().default(""),
        type: z.string().default("string"),
        help: z.string().default(""),
        placeholder: z.string().default(""),
        required: z.boolean().default(false),
        /** A `select`'s choices, as the Host read them at publish time. */
        options: z.array(z.object({
            value: z.string().default(""),
            label: z.string().default("")
        })).default([]),
        /** This `select` also draws a composer pill per enabled entry. */
        composer: z.boolean().default(false)
    })).default([]),
    /** Buttons the editor offers on a saved entry of this kind. */
    actions: z.array(z.object({
        key: z.string().default(""),
        label: z.string().default(""),
        help: z.string().default("")
    })).default([]),
    /** How many entries of this kind may exist; 0 = no limit. */
    maxEntries: z.number().step(1).min(0).default(0),
    /** The composer pill's mark: stroke paths on a 24×24 box. */
    icon: z.array(z.string()).default([])
});

/** A connection a component offers to create (D4). Host-published. */
export const Proposal = z.object({
    id: z.string().default(""),
    title: z.string().default(""),
    /** The entry the card writes on accept. */
    entry: ServerEntry
});

/**
 * The row's configuration, and the configuration form the Web GUI card edits.
 * Every field is ``: user edits land in the profile patch and
 * commit without a remount, and the Host's live answers ride the same
 * references without ever being persisted.
 */
export const Config = z.object({
    /** Every registered connection, in the order the card lists them. The one
     * field the card edits. */
    servers: z.array(ServerEntry).default([]).max(MAX_SERVERS).volatile(),
    /** The Host's live answer per connection — read-only for the card. */
    live: z.array(ServerLive).default([]).volatile(),
    /** Every registered kind, for the picker and the extra fields. */
    kinds: z.array(KindInfo).default([]).volatile(),
    /** Connections components offer to create — read-only for the card. */
    proposals: z.array(Proposal).default([]).volatile(),
    /** Keyed trigger `{ "<entry id>/<action key>": stamp }`: a moved stamp runs
     * that kind action once (the `entryActions` idiom). User-authored. */
    actions: z.dict(z.number()).default({}).volatile(),
    /** Keyed trigger `{ "<proposal id>": stamp }`: a moved stamp dismisses
     * that proposal. User-authored. */
    dismissals: z.dict(z.number()).default({}).volatile()
});
