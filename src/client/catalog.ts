/**
 * Browser half — the connection view model.
 *
 * Pure functions over what the row serves: no form service, no writes, no DOM.
 * Everything the card draws about an entry (which fields are visible, what the
 * state line says, what a brand-new entry looks like) is decided here, so the
 * component stays drawing and the rules stay testable without a DOM.
 */

/** One registered kind, as the Host answers it on the mirror. */
export interface KindInfo {
    id: string;
    label?: string;
    summary?: string;
    transport?: "stdio" | "http" | "none";
    fields?: readonly {
        key: string;
        label: string;
        type?: string;
        help?: string;
        placeholder?: string;
        required?: boolean;
        /** A `select`'s choices, as the Host read them when it published. */
        options?: readonly { value: string; label?: string }[];
        /** A `select` marked for the composer pill. */
        composer?: boolean;
    }[];
    /** Buttons this kind offers on a saved entry of its own. */
    actions?: readonly { key: string; label: string; help?: string }[];
    /** How many entries of this kind may exist; 0 or absent = no limit. */
    maxEntries?: number;
    /** Stroke paths for the composer pill's mark, on a 24×24 box. */
    icon?: readonly string[];
}

/** One connection entry, as wide as the card needs. */
export type Entry = Record<string, unknown>;

/** The two transports the core speaks. A registered kind answers `transport`
 * for what it actually runs; anything unknown reads as `none`, which is the
 * honest answer — the fields belong to the kind, not to a picker. */
const FALLBACK_TRANSPORT = "none";

/** Normalize whatever `servers` answers into a list of entries. */
export function normalizeList(value: unknown): Entry[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Entry => item !== null && typeof item === "object").map((item) => ({ ...item }));
}

/** The default fields a brand-new entry carries.
 *
 * `id` is deliberately blank rather than generated: the namespace is what the
 * live tools are named after, and a card inventing one silently decides the
 * user's tool names.
 */
export function blankEntry(_t: (key: string) => string): Entry {
    return {
        id: "",
        kind: "stdio",
        // Brand-new entries start disabled: adding a connection and having it
        // live the instant the card saves is a surprise — the user turns it on.
        enabled: false,
        label: "",
        command: "",
        args: [],
        env: {},
        cwd: "",
        stderrMode: "console",
        stderrLog: "",
        url: "",
        headers: {},
        toolCallTimeoutMs: 60000,
        maxInstructionBytes: 32768,
        failOnStartupError: false,
        reconnect: {},
        extra: {}
    };
}

/** The kinds the Host answered with. An empty answer falls back to the two
 * built-ins, which is what a host that never published kinds really has. */
export function kindsOf(answer: unknown): KindInfo[] {
    const list = Array.isArray(answer) ? (answer as readonly KindInfo[]) : [];
    if (list.length > 0) return list.filter((kind) => typeof kind?.id === "string");
    return [
        { id: "stdio", label: "Local command (stdio)", transport: "stdio" },
        { id: "http", label: "HTTP (Streamable HTTP)", transport: "http" }
    ];
}

/** Every registered kind id. */
export function kindIds(answer: unknown): string[] {
    return kindsOf(answer).map((kind) => String(kind.id));
}

/** The label one kind carries. */
export function kindLabel(id: string, answer: unknown): string {
    const found = kindsOf(answer).find((kind) => kind.id === id);
    return typeof found?.label === "string" && found.label !== "" ? found.label : id;
}

/** Which transport's fields the editor shows for one kind. */
export function transportsFor(kind: string, answer?: unknown): "stdio" | "http" | "none" {
    if (answer === undefined) {
        if (kind === "stdio") return "stdio";
        if (kind === "http") return "http";
        return FALLBACK_TRANSPORT;
    }
    const found = kindsOf(answer).find((item) => item.id === kind);
    const transport = found?.transport;
    return transport === "stdio" || transport === "http" ? transport : FALLBACK_TRANSPORT;
}

/** The extra fields one kind declares. */
export function kindFieldsOf(kind: string | undefined, answer: unknown): readonly KindInfo["fields"][number][] {
    if (kind === undefined) return [];
    const found = kindsOf(answer).find((item) => item.id === kind);
    const fields = found?.fields;
    return Array.isArray(fields) ? [...fields] : [];
}

/** One entry's display label: its own label, else its id. */
export function entryLabel(entry: Entry): string {
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    const id = typeof entry.id === "string" ? entry.id : "";
    return label === "" ? id : `${label} · ${id}`;
}

/** What the collapsed row says: how many connections, how many answering. */
export function summarize(value: unknown): { total: number; live: number; failed: number } {
    const rows = normalizeList((value as { servers?: unknown })?.servers ?? value);
    const lives = (value as { live?: unknown })?.live;
    const lines = Array.isArray(lives) ? (lives as readonly Record<string, unknown>[]) : [];
    let live = 0;
    let failed = 0;
    for (const line of lines) {
        if (line?.state === "connected") live++;
        else if (line?.state === "failed" || line?.state === "conflict") failed++;
    }
    return { total: rows.length, live, failed };
}

/**
 * The state table holds no copy: only what the dot answers, what the row's
 * target answers, and the locale key the sentence comes from. The strings are
 * the dictionary's — `AGENTS.md`: a string never sits in the middle of a
 * component — and `t` is what resolves them; the shared card machinery hands
 * one to every block, and the row summary binds its own (see `card/summary`).
 */
const STATE_ROWS: Record<string, { readonly dot: "ok" | "error" | "idle"; readonly target: string; readonly key: string }> = {
    connected: { dot: "ok", target: "connected", key: "stateConnected" },
    starting: { dot: "idle", target: "starting", key: "stateConnecting" },
    failed: { dot: "error", target: "failed", key: "stateFailed" },
    conflict: { dot: "error", target: "conflict", key: "stateConflict" },
    off: { dot: "idle", target: "off", key: "stateStopped" }
};

/** State line: `state` + `error` in, the dot and the sentence out. */
export function describeState(
    state: string,
    error: string,
    t: (key: string) => string = (key) => key
): { dot: "ok" | "error" | "idle"; text: string; target: string } {
    const row = STATE_ROWS[state] ?? STATE_ROWS["off"]!;
    // A server that answered carries its own line: what it said *is* the state.
    const text = (state === "failed" || state === "conflict") && error !== "" ? error : t(row.key);
    return { dot: row.dot, target: row.target, text };
}

/** What a proposal block shows for one offer (D4). */
export interface ProposalInfo {
    id: string;
    title: string;
    /** The entry creating it would write — normalized enough to append. */
    entry: Entry;
}

/**
 * Standing offers, normalized. An entry with no usable id or kind is dropped
 * rather than offered — creating it would refuse it back.
 */
export function proposalsOf(answer: unknown): ProposalInfo[] {
    const list = Array.isArray(answer) ? (answer as readonly Record<string, unknown>[]) : [];
    const out: ProposalInfo[] = [];
    for (const item of list) {
        const id = typeof item?.id === "string" ? item.id : "";
        const title = typeof item?.title === "string" ? item.title : "";
        const raw = item?.entry;
        if (id === "" || raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
        const entry = { ...(raw as Entry) };
        if (typeof entry.id !== "string" || entry.id === "") continue;
        if (typeof entry.kind !== "string" || entry.kind === "") continue;
        out.push({ id, title, entry });
    }
    return out;
}

/** The buttons one answered kind offers on its entries. */
export function kindActionsOf(kind: string | undefined, answer: unknown): { key: string; label: string; help: string }[] {
    if (kind === undefined) return [];
    const found = kindsOf(answer).find((item) => item.id === kind);
    const actions = found?.actions;
    return Array.isArray(actions)
        ? actions
            .filter((action) => typeof action?.key === "string" && action.key !== "")
            .map((action) => ({ key: String(action.key), label: String(action.label ?? action.key), help: String(action.help ?? "") }))
        : [];
}

/** How many registered entries stand of one kind. */
export function entriesOfKind(kind: string, entries: readonly Entry[]): number {
    return entries.filter((entry) => entry.kind === kind).length;
}

/** Whether one kind stands at its cap. A kind that declares none never does. */
export function kindAtLimit(kind: string, answer: unknown, entries: readonly Entry[]): boolean {
    const found = kindsOf(answer).find((item) => item.id === kind);
    const cap = typeof found?.maxEntries === "number" ? found.maxEntries : 0;
    return cap > 0 && entriesOfKind(kind, entries) >= cap;
}

/**
 * The kinds the picker may offer: everything registered, minus the ones at
 * their cap — except the one the edited entry already is, which always stays
 * selectable (dropping the saved kind would read as its disappearance).
 */
export function kindChoices(answer: unknown, entries: readonly Entry[], currentKind?: string): string[] {
    return kindIds(answer).filter((id) => id === currentKind || !kindAtLimit(id, answer, entries));
}

/**
 * The composer pills to stand under a card: one per **enabled** entry whose
 * kind marks a field for the composer, offering that field's served choices.
 * `write` is the whole-list door — a pick rewrites `extra[fieldKey]` of that
 * entry and leaves everything else standing.
 */
/** One composer pill, as the composer hole consumes it. */
export interface ComposerPillDeclaration {
    /** Stable key among the pills. */
    key: string;
    /** What the pill reads — the current choice's label. */
    label: string;
    /** Tooltip. */
    title: string;
    /** The kind's mark. */
    icon?: readonly string[];
    /** The choices. */
    options: { id: string; label: string }[];
    /** What stands chosen. */
    selectedId: string;
    /** A pick: rewrite this entry's `extra[key]`, leave the rest standing. */
    onSelect(id: string): Promise<unknown>;
    /** No choices to choose between. */
    disabled?: boolean;
}

export function composerDeclarations(
    entries: readonly Entry[],
    answer: unknown,
    write: (next: readonly Entry[]) => Promise<boolean>
): ComposerPillDeclaration[] {
    const out: ComposerPillDeclaration[] = [];
    for (const entry of entries) {
        if (entry.enabled === false) continue;
        const kindId = typeof entry.kind === "string" ? entry.kind : "";
        const kind = kindsOf(answer).find((item) => item.id === kindId);
        if (kind === undefined) continue;
        for (const field of kind.fields ?? []) {
            if (field?.composer !== true) continue;
            const key = String(field.key ?? "");
            if (key === "") continue;
            const options = (field.options ?? [])
                .filter((option) => typeof option?.value === "string" && option.value !== "")
                .map((option) => ({ id: option.value, label: option.label !== undefined && option.label !== "" ? option.label : option.value }));
            const current = extraValue(entry, key);
            // A stored pick the choices stopped carrying stays offered — a
            // selection never silently becomes another one.
            if (current !== "" && !options.some((option) => option.id === current)) options.push({ id: current, label: current });
            out.push({
                key: `${String(entry.id ?? "")}/${key}`,
                label: options.find((option) => option.id === current)?.label ?? current,
                title: `${kind.label ?? kindId} · ${entryLabel(entry)} — ${String(field.label ?? key)}`,
                icon: kind.icon === undefined ? undefined : [...kind.icon],
                options,
                selectedId: current,
                disabled: options.length === 0,
                async onSelect(id: string): Promise<unknown> {
                    const next: readonly Entry[] = entries.map((row) =>
                        row === entry || String(row.id ?? "") === String(entry.id ?? "")
                            ? { ...row, extra: { ...(row.extra !== null && typeof row.extra === "object" ? (row.extra as Record<string, unknown>) : {}), [key]: id } }
                            : row
                    );
                    return write(next);
                }
            });
        }
    }
    return out;
}

function extraValue(entry: Entry, key: string): string {
    const extra = entry.extra;
    return extra !== null && typeof extra === "object" ? String((extra as Record<string, unknown>)[key] ?? "") : "";
}

/** What a row's transport column reads: `stdio`/`http` for what the core
 * speaks, the kind's own label for a kind that owns its fields. */
export function transportLabel(kind: string, kinds: unknown): string {
    const transport = transportsFor(kind, kinds);
    return transport === "none" ? kindLabel(kind, kinds) : transport;
}

/** The shared control a declared kind field type draws; unknown reads as one line. */
export function extraFieldType(type: string | undefined): "string" | "lines" | "boolean" | "secret" | "select" {
    return type === "lines" || type === "boolean" || type === "secret" || type === "select" ? type : "string";
}

/**
 * What one control's answer becomes in `extra`, which holds strings only: a
 * toggle is `"true"`/`"false"`, and a `lines` field — whose control answers the
 * items — is one item per line, the shape a kind reads back (a list joined with
 * commas would be one flag with commas in it).
 */
export function extraFieldText(type: ReturnType<typeof extraFieldType>, value: unknown): string {
    if (type === "boolean") return value === true ? "true" : "false";
    if (type === "lines") return Array.isArray(value) ? value.map((item) => String(item)).join("\n") : String(value ?? "");
    return String(value ?? "");
}

/** Whether a `boolean` field reads on: what it stores (`"true"`/`"false"`), else
 * — unset, or a value from before the field was a toggle — the default the kind
 * declared in `placeholder`, else off. */
export function extraFieldChecked(value: unknown, fallback: string | undefined): boolean {
    const stored = String(value ?? "");
    if (stored === "true") return true;
    if (stored === "false") return false;
    return fallback === "true";
}

/** A `lines` field's stored text read back as its items — one per line, blank
 * lines dropped; the row list draws one row per item. */
export function extraFieldLines(value: unknown): string[] {
    return String(value ?? "")
        .split("\n")
        .filter((line) => line.trim() !== "");
}
