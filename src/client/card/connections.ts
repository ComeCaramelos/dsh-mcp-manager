/**
 * Browser half — the connection list and its editor.
 *
 * This is the manager's only visible body: one list of every registered
 * connection, one editor for the entry picked out of it, and one form for adding
 * a new one. Every rule it answers is this plugin's own — what an entry means,
 * what the toggle does, how a whole-list save folds back — but every **control**
 * it draws is the shared block set's: one line, one list of lines, one
 * `KEY=value` map, one choice, whatever a kind declares, and the switch. Those
 * read the same way once, in `@comecaramelos/dsh-ancesters/client`'s blocks,
 * instead of being written again here (and slightly differently each time).
 *
 * What the editor is, then, is a **table** of fields: which key of the entry it
 * edits, which copy names it, and which shared control draws it. The transport
 * decides which table shows, and a registered kind decides which extra fields
 * ride along — a companion package gets its fields on the page without a fork.
 *
 * Two shapes of write, and the difference is what the user feels:
 *
 *   * the **toggle** writes that one entry's `enabled` immediately — turning a
 *     connection off is not a staged edit that needs an apply button, because
 *     the whole point of the control is that the connection stops *now*;
 *   * the **editor** stages nothing either: one save writes the whole list with
 *     the edited entry folded back in, so a partial write can never leave the
 *     list holding a half-edited entry.
 *
 * Adding is the same write path with one entry appended, and deleting the same
 * with one entry removed — there is no "add" API, because there is no separate
 * store: the row is the list.
 */
/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";

import { DropdownField, ExtraField, FlagsBlock, LinesField, MapField, SwitchField, TextField } from "@comecaramelos/dsh-ancesters/client";

import { ENTRY_ID, MAX_SERVERS } from "../plugin-meta.js";
import STYLES from "../styles/McpManagerCard.module.css";
import {
    blankEntry,
    describeState,
    entryLabel,
    kindActionsOf,
    kindChoices,
    kindFieldsOf,
    kindLabel,
    normalizeList,
    proposalsOf,
    extraFieldChecked,
    extraFieldLines,
    extraFieldText,
    extraFieldType,
    transportLabel,
    transportsFor
} from "../catalog.js";

/** The props every card block receives from the shared machinery. */
export interface ConnectionsBlockProps {
    /** Every registered entry, as the row serves them. */
    servers: unknown;
    /** Every live answer, keyed by entry id. */
    live: unknown;
    /** The registered kinds, as the Host answered them. */
    kinds: unknown;
    /** Standing offers from components (D4), as the Host mirrors them. */
    proposals?: unknown;
    /** Whether anything serves this row at all. */
    available: boolean;
    /** Whether the Host document accepts writes. */
    writable: boolean;
    /** Whether a write is crossing the wire. */
    saving: boolean;
    /** Whole-list write: the controller's door. */
    write: (servers: readonly Record<string, unknown>[]) => Promise<boolean>;
    /** Ask a saved entry's kind to run one of its actions (`"<id>/<key>"`). */
    runAction?: (key: string) => Promise<boolean>;
    /** Say no to one standing offer. */
    dismissProposal?: (id: string) => Promise<boolean>;
    /** Locale copy. */
    t: (key: string) => string;
}

/** Entry-local editor state (never persisted, never the Host's answer). */
interface Draft {
    /** `new` = the add form; otherwise the entry's id. */
    open: string;
    /** The entry being edited. */
    entry: Record<string, unknown>;
}

/** One live answer, as the mirror serves it. */
interface LiveLineData {
    state?: string;
    error?: string;
    tools?: string[];
    note?: string;
}

/** One field of the editor's table. */
interface EditorField {
    /** Which key of the entry it writes. */
    key: string;
    /** The locale keys naming it and giving its hint. */
    label: string;
    help: string;
    /** Which shared control draws it. Default `text` — one line. */
    control?: "text" | "lines" | "map" | "select";
    /** The control's empty-state copy. */
    placeholder?: string;
    /** A `select`'s answers, picked from what the card was handed. */
    options?: (t: (key: string) => string) => readonly { value: unknown; label: string }[];
}

/** What every entry editor shows first, whatever its kind. */
const IDENTITY_FIELDS: readonly EditorField[] = [
    { key: "id", label: "id", help: "idHelp", placeholder: "github" },
    { key: "label", label: "label", help: "labelHelp" },
    // The answers are the Host's registered kinds, folded in by the render: a
    // companion package's kind is a choice the card never has to know about.
    { key: "kind", label: "kind", help: "kindHelp", control: "select", options: () => [] }
];

/** One local command over stdio. */
const STDIO_FIELDS: readonly EditorField[] = [
    { key: "command", label: "command", help: "commandHelp", placeholder: "npx" },
    { key: "args", label: "args", help: "argsHelp", control: "lines", placeholder: "-y @modelcontextprotocol/server-everything" },
    { key: "env", label: "env", help: "envHelp", control: "map", placeholder: "TOKEN=…" },
    { key: "cwd", label: "cwd", help: "cwdHelp" },
    {
        key: "stderrMode",
        label: "stderr",
        help: "stderrHelp",
        control: "select",
        options: (t) => [
            { value: "console", label: t("stderrConsole") },
            { value: "log", label: t("stderrLog") }
        ]
    }
];

/** One running service over Streamable HTTP. */
const HTTP_FIELDS: readonly EditorField[] = [
    { key: "url", label: "url", help: "urlHelp", placeholder: "http://localhost:3000/mcp" },
    { key: "headers", label: "headers", help: "headersHelp", control: "map", placeholder: "Authorization=…" }
];

/** Render one entry's live answer: the state dot, its tooltip, and the tools. */
function LiveLine(props: { state: string; error: string; tools: string[]; note: string; t: (key: string) => string }): any {
    const described = describeState(props.state, props.error, props.t);
    return jsxs("div", {
        className: STYLES.liveLine,
        children: [
            jsx("span", { className: described.dot === "error" ? STYLES.dotError : STYLES.dot, title: described.text }),
            // The note is a diagnostic, never a failure (where stderr went, what
            // an action answered): it rides the tooltip, not the state line.
            jsx("span", { className: STYLES.liveText, title: props.note === "" ? described.text : `${described.text}\n${props.note}`, children: described.text }),
            props.tools.length > 0 ? jsx("span", { className: STYLES.tools, children: String(props.tools.length) }) : null
        ]
    });
}

/**
 * One registered connection: identity, toggle, transport, live answer, edit
 * and delete.
 *
 * The toggle is the shared switch in its `row` form — the line already names the
 * connection, so a boxed switch would read as a card inside a row.
 */
function ConnectionRow(props: {
    entry: Record<string, unknown>;
    live: LiveLineData | undefined;
    index: number;
    busy: boolean;
    selected: boolean;
    onToggle: (index: number, enabled: boolean) => void;
    onEdit: (index: number) => void;
    onRemove: (index: number) => void;
    kinds: unknown;
    t: (key: string) => string
}): any {
    const entry = props.entry;
    const live = props.live;
    const id = typeof entry.id === "string" ? entry.id : "";
    const state = live === void 0 ? "off" : live.state ?? "off";
    const target = describeState(state, String(live?.error ?? "")).target;
    const enabled = entry.enabled !== false;
    return jsxs("div", {
        className: [STYLES.row, props.selected ? STYLES.selected : "", target === "failed" ? STYLES.hasError : ""]
            .filter(Boolean)
            .join(" "),
        "data-id": id,
        children: [
            SwitchField({
                label: props.t("enabled"),
                title: enabled ? props.t("toggleDisable") : props.t("toggleEnable"),
                checked: enabled,
                disabled: props.busy,
                variant: "row",
                onToggle: () => props.onToggle(props.index, !enabled)
            }),
            jsx("button", {
                className: STYLES.identity,
                type: "button",
                onClick: () => props.onEdit(props.index),
                children: jsx("span", { className: STYLES.label, children: entryLabel(entry) })
            }),
            // The core transports read as themselves; a kind that owns its
            // fields (a component's) reads as its own label.
            jsx("span", { className: STYLES.transport, children: transportLabel(String(entry.kind ?? "stdio"), props.kinds) }),
            LiveLine({
                state,
                error: String(live?.error ?? ""),
                tools: Array.isArray(live?.tools) ? (live?.tools as string[]) : [],
                note: String(live?.note ?? ""),
                t: props.t
            }),
            jsx("button", {
                className: STYLES.icon,
                type: "button",
                disabled: props.busy,
                title: props.t("remove"),
                onClick: () => props.onRemove(props.index),
                children: "✕"
            })
        ]
    });
}

/**
 * One editor field, drawn by the shared control its table named.
 *
 * The control is drawn as a **component** (`jsx(LinesField, …)`), never as a
 * function call: `LinesField` and `MapField` stand their own typed-box state up,
 * and a control called inline hands that state to whoever is rendering the editor
 * — so the editor opening or closing moves the hook list underneath the card and
 * React refuses the render ("rendered fewer hooks than expected"). A component
 * keeps the hook where it belongs, and the field appears and disappears freely.
 */
function EditorControl(props: { field: EditorField; entry: Record<string, unknown>; t: (key: string) => string; onChange: (value: unknown) => void }): any {
    const { field, entry } = props;
    const label = props.t(field.label);
    const help = props.t(field.help);
    const control = field.control ?? "text";
    const args = { label, help, placeholder: field.placeholder ?? "", value: entry[field.key], onChange: props.onChange };
    if (control === "lines") return jsx(LinesField, args);
    if (control === "map") return jsx(MapField, args);
    if (control === "select") return jsx(DropdownField, { ...args, options: field.options === void 0 ? [] : field.options(props.t) });
    return jsx(TextField, args);
}

/**
 * One extra field a registered kind declared — the shape `extra` carries and the
 * control the declaration asks for.
 *
 * A companion package gets its fields on the page without a fork of this card
 * because the kind answers them through the mirror, not because the card knows
 * the package: the shared `ExtraField` draws whichever shape was declared, and
 * the answer stays a string in `extra` the same way the card stores everything
 * else. A choice wears the shared dropdown, and a `lines` field (a kind's extra
 * flags) the shared row list — one row per item, the same widget the kind's own
 * card draws its flags with.
 */
function KindExtraField(props: {
    field: {
        key: string;
        label: string;
        type?: string;
        help?: string;
        placeholder?: string;
        options?: readonly { value: string; label?: string }[];
    };
    value: unknown;
    onChange: (value: string) => void;
    t: (key: string) => string;
}): any {
    const type = extraFieldType(props.field.type);
    if (type === "boolean") {
        // A toggle, the switch the rows wear; a value nobody set reads as the
        // kind's declared default (`placeholder`), else off.
        const checked = extraFieldChecked(props.value, props.field.placeholder);
        return SwitchField({
            label: props.field.label,
            hint: props.field.help === undefined || props.field.help === "" ? undefined : props.field.help,
            checked,
            onToggle: () => props.onChange(extraFieldText("boolean", !checked))
        });
    }
    if (type === "select") {
        return jsx(
            DropdownField,
            {
                label: props.field.label,
                help: props.field.help ?? "",
                placeholder: props.field.placeholder ?? "",
                // The choices are what the Host served on the mirror, re-read on
                // every render: a discovery that lands republishes them.
                options: selectChoices(props.field.options),
                value: String(props.value ?? ""),
                onChange: (value: unknown): void => props.onChange(String(value ?? ""))
            },
            props.field.key
        );
    }
    if (type === "lines") {
        return jsx(
            FlagsBlock,
            {
                title: props.field.label,
                hint: props.field.help === undefined || props.field.help === "" ? undefined : props.field.help,
                flags: extraFieldLines(props.value),
                save: (flags: string[]): void => props.onChange(extraFieldText("lines", flags)),
                rowPlaceholder: props.field.placeholder ?? "",
                addLabel: props.t("addRow"),
                removeLabel: props.t("removeRow"),
                writable: true
            },
            props.field.key
        );
    }
    return jsx(
        ExtraField,
        {
            label: props.field.label,
            help: props.field.help ?? "",
            placeholder: props.field.placeholder ?? "",
            type,
            value: type === "boolean" ? String(props.value ?? "") === "true" : String(props.value ?? ""),
            onChange: (value: unknown): void => props.onChange(extraFieldText(type, value))
        },
        type
    );
}


/** A kind field's served choices as the shared select reads them. */
function selectChoices(options: readonly { value: string; label?: string }[] | undefined): { value: string; label: string }[] {
    return (options ?? []).map((option) => ({ value: option.value, label: option.label !== undefined && option.label !== "" ? option.label : option.value }));
}

/**
 * Render the connection list, its editor and the add form.
 *
 * @param props - the served list + live answers + the controller's write door.
 */
export function ConnectionsBlock(props: ConnectionsBlockProps): any {
    const t = props.t;
    const served = normalizeList(props.servers);
    const lives: Map<string, LiveLineData> = new Map();
    for (const line of Array.isArray(props.live) ? (props.live as readonly Record<string, unknown>[]) : []) {
        lives.set(typeof line?.id === "string" ? line.id : "", {
            state: typeof line?.state === "string" ? line.state : "off",
            error: typeof line?.error === "string" ? line.error : "",
            tools: Array.isArray(line?.tools) ? (line.tools as string[]) : [],
            note: typeof line?.note === "string" ? line.note : ""
        });
    }
    const [draft, setDraft] = react.useState({ open: "", entry: {} } as Draft) as [Draft, (next: Draft | ((current: Draft) => Draft)) => void];
    const busy = props.saving === true || props.writable !== true;
    const atLimit = served.length >= MAX_SERVERS;

    /** One write of the whole list, with the draft's entry folded in. */
    const commit = react.useCallback(
        async (next: Record<string, unknown>[]): Promise<void> => {
            if (busy) return;
            const accepted = await props.write(next);
            if (accepted) setDraft({ open: "", entry: {} });
        },
        [busy, props.write]
    );

    const toggle = react.useCallback(
        (index: number, enabled: boolean): void => {
            void commit(served.map((entry, position) => (position === index ? { ...entry, enabled } : entry)));
        },
        [served, commit]
    );

    const remove = react.useCallback(
        (index: number): void => {
            void commit(served.filter((entry, position) => position !== index));
        },
        [served, commit]
    );

    const startEdit = react.useCallback(
        (index: number): void => {
            const entry = served[index];
            if (entry === void 0) return;
            // The row is the editor's switch: a click on the row already open
            // closes it, the way the editor's own ✕ does.
            setDraft((current) => (current.open === String(index) ? { open: "", entry: {} } : { open: String(index), entry: { ...entry } }));
        },
        [served]
    );

    const startAdd = react.useCallback(
        (): void => {
            if (busy || atLimit) return;
            setDraft({ open: "new", entry: blankEntry(t) });
        },
        [busy, atLimit, t]
    );

    const saveDraft = react.useCallback(
        (): void => {
            const entry = draft.entry;
            const id = typeof entry.id === "string" ? entry.id.trim() : "";
            if (id === "") return;
            if (draft.open === "new") void commit([...served, { ...entry, id }]);
            // On/off belongs to the row's switch: a save keeps what the row
            // answers now, never the copy taken when the editor opened.
            else void commit(served.map((item, index) => (index === Number(draft.open) ? { ...entry, id, enabled: item.enabled } : item)));
        },
        [draft, served, commit]
    );

    /** Fold one edited value into the draft. */
    const editField = react.useCallback(
        (field: string, value: unknown): void => {
            setDraft((current) => ({ ...current, entry: { ...current.entry, [field]: value } }));
        },
        []
    );

    /** Fold one `extra` key into the draft. */
    const editExtra = react.useCallback(
        (key: string, value: string): void => {
            setDraft((current) => {
                const extra = (current.entry.extra !== null && typeof current.entry.extra === "object" ? current.entry.extra : {}) as Record<string, string>;
                return { ...current, entry: { ...current.entry, extra: { ...extra, [key]: value } } };
            });
        },
        []
    );

    const editing = draft.open !== "";
    const kind = String(draft.entry.kind ?? "stdio");
    const transport = transportsFor(kind);
    const kindFields = kindFieldsOf(kind, props.kinds);
    const transportFields = transport === "stdio" ? STDIO_FIELDS : transport === "http" ? HTTP_FIELDS : [];
    /** A saved entry offers what its own kind declares — a field or a button
     * belonging to another kind never shows here (Host-side resolution ignores
     * what is not asked; showing it would promise a run that never comes). */
    const entryActions = draft.open === "new" ? [] : kindActionsOf(kind, props.kinds);
    /** The kind choice is answered by the picker, not by the table: everything
     * registered, minus what stands at its cap (the kind being edited stays
     * selectable — dropping a saved kind would read as its disappearance). */
    const identity = IDENTITY_FIELDS.filter((field) => field.key !== "kind").concat(
        IDENTITY_FIELDS.filter((field) => field.key === "kind").map((field) => ({
            ...field,
            options: (t: (key: string) => string) =>
                kindChoices(props.kinds, served, kind)
                    .map((id) => ({ value: id, label: kindLabel(id, props.kinds) }))
        }))
    );

    /** The offers standing now; creating one is a normal whole-list write. */
    const proposals = proposalsOf(props.proposals ?? void 0);

    const createProposal = react.useCallback(
        (entry: Record<string, unknown>): void => {
            void commit([...served, { ...entry }]);
        },
        [served, commit]
    );

    const dismissProposal = react.useCallback(
        (id: string): void => {
            const dismiss = props.dismissProposal;
            if (dismiss === void 0 || busy) return;
            void dismiss(id);
        },
        [props.dismissProposal, busy]
    );

    return jsxs("div", {
        className: STYLES.card,
        "data-plugin": ENTRY_ID,
        children: [
            jsxs("div", {
                className: STYLES.header,
                children: [
                    jsx("span", { className: STYLES.count, children: t("connectionsCount").replace("{count}", String(served.length)) }),
                    jsx("button", {
                        className: STYLES.button,
                        type: "button",
                        disabled: busy || atLimit,
                        onClick: startAdd,
                        title: atLimit ? t("atLimit") : t("addConnection"),
                        children: t("addConnection")
                    })
                ]
            }),
            served.length === 0
                ? jsx("div", { className: STYLES.empty, children: t("noConnections") })
                : null,
            /** Standing offers from components (D4): nothing is created until
             * the person accepts one — *Dismiss* answers the component so it
             * stops offering it. */
            proposals.length === 0
                ? null
                : jsx("div", {
                      className: STYLES.list,
                      children: proposals.map((proposal) =>
                          jsxs(
                              "div",
                              {
                                  className: STYLES.row,
                                  children: [
                                      jsx("span", { className: STYLES.label, children: proposal.title }),
                                      jsx("span", {
                                          className: STYLES.transport,
                                          children: `${proposal.entry.id} · ${kindLabel(String(proposal.entry.kind), props.kinds)}`
                                      }),
                                      jsx("button", {
                                          className: STYLES.button,
                                          type: "button",
                                          disabled: busy,
                                          onClick: () => createProposal(proposal.entry),
                                          children: t("proposalCreate")
                                      }),
                                      jsx("button", {
                                          className: STYLES.ghost,
                                          type: "button",
                                          disabled: busy,
                                          onClick: () => dismissProposal(proposal.id),
                                          children: t("proposalDismiss")
                                      })
                                  ]
                              },
                              proposal.id
                          )
                      )
                  }),
            served.length === 0
                ? null
                : jsx("div", {
                      className: STYLES.list,
                      children: served.map((entry, index) =>
                          ConnectionRow({
                              entry,
                              live: lives.get(typeof entry.id === "string" ? entry.id : ""),
                              kinds: props.kinds,
                              index,
                              busy,
                              selected: draft.open === String(index),
                              onToggle: toggle,
                              onEdit: startEdit,
                              onRemove: remove,
                              t
                          })
                      )
                  }),
            editing
                ? jsxs("div", {
                      className: STYLES.editor,
                      children: [
                          jsxs("div", {
                              className: STYLES.editorHeader,
                              children: [
                                  jsx("span", { className: STYLES.editorTitle, children: draft.open === "new" ? t("newConnection") : t("editConnection") }),
                                  jsx("button", {
                                      className: STYLES.icon,
                                      type: "button",
                                      onClick: () => setDraft({ open: "", entry: {} }),
                                      children: "✕"
                                  })
                              ]
                          }),
                          // The editor answers no toggle: a brand-new connection
                          // always lands disabled, and on/off is the row's switch.
                          jsx("div", {
                              className: STYLES.grid,
                              children: identity.map((field) =>
                                  EditorControl({ field, entry: draft.entry, t, onChange: (value) => editField(field.key, value) })
                              )
                          }),
                          transportFields.length === 0
                              ? null
                              : jsx("div", {
                                    className: STYLES.grid,
                                    children: transportFields.map((field) =>
                                        EditorControl({ field, entry: draft.entry, t, onChange: (value) => editField(field.key, value) })
                                    )
                                }),
                          kindFields.length === 0
                              ? null
                              : jsx("div", {
                                    className: STYLES.grid,
                                    children: kindFields.map((field) =>
                                        KindExtraField({
                                            field,
                                            value: (draft.entry.extra !== null && typeof draft.entry.extra === "object"
                                                ? (draft.entry.extra as Record<string, unknown>)[field.key]
                                                : undefined) ?? "",
                                            onChange: (value) => editExtra(field.key, value),
                                            t
                                        })
                                    )
                                }),
                          jsxs("div", {
                              className: STYLES.editorFooter,
                              children: [
                                  ...entryActions.map((action) =>
                                      jsx(
                                          "button",
                                          {
                                              className: STYLES.ghost,
                                              type: "button",
                                              disabled: busy || String(draft.entry.id ?? "").trim() === "" || props.runAction === void 0,
                                              title: action.help,
                                              onClick: () => {
                                                  const run = props.runAction;
                                                  if (run === void 0) return;
                                                  void run(`${String(draft.entry.id ?? "")}/${action.key}`);
                                              },
                                              children: action.label
                                          },
                                          action.key
                                      )
                                  ),
                                  jsx("button", {
                                      className: STYLES.button,
                                      type: "button",
                                      disabled: busy || String(draft.entry.id ?? "").trim() === "",
                                      onClick: saveDraft,
                                      children: t("save")
                                  }),
                                  jsx("button", {
                                      className: STYLES.ghost,
                                      type: "button",
                                      onClick: () => setDraft({ open: "", entry: {} }),
                                      children: t("cancel")
                                  })
                              ]
                          })
                      ]
                  })
                : null
        ]
    });
}
