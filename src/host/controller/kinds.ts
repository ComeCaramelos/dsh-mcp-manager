/**
 * Publishing the registered kinds.
 *
 * The card's kind picker and its extra fields cannot import a companion
 * package: that package may not be installed, and the browser half has no way
 * to reach Node. So the **Host** answers what is registered, through the same
 * mirror that carries the live status — one channel, one source of truth, and
 * a kind that is not loaded simply does not appear.
 *
 * Re-read on every publish rather than cached. A package registering a kind
 * mid-session is the case that makes caching wrong: the card must be able to
 * pick the new shape without the manager being restarted.
 */
import { listMcpKinds } from "../kinds/index.js";
import type { KindField } from "../types.js";

/** One registered kind, projected for the card. */
export interface KindView {
    id: string;
    label: string;
    summary: string;
    /** Which transport fields the card keeps visible for this kind. */
    transport: "stdio" | "http" | "none";
    /** The kind's extra fields. */
    fields: {
        key: string;
        label: string;
        type: string;
        help: string;
        placeholder: string;
        required: boolean;
        options: { value: string; label: string }[];
        /** A `select` marked for the composer — the manager draws a pill. */
        composer: boolean;
    }[];
    /** Buttons the editor offers on a saved entry of this kind. */
    actions: { key: string; label: string; help: string }[];
    /** How many entries of this kind may exist; 0 = no limit. */
    maxEntries: number;
    /** Stroke paths for the composer pill's mark, on a 24×24 box. */
    icon: string[];
    /** Whether the core registered it (false = an integration). */
    builtIn: boolean;
}

/**
 * A field's choices as the card reads them, asked **now**. A function the kind
 * answers with is the kind's discovery; one that throws, or answers something
 * that is not a list, offers nothing rather than taking the mirror down — the
 * card still keeps the stored value selectable.
 */
function optionsOf(field: KindField): { value: string; label: string }[] {
    let answer: unknown;
    try {
        answer = typeof field.options === "function" ? field.options() : field.options;
    } catch {
        return [];
    }
    if (!Array.isArray(answer)) return [];
    return answer
        .filter((option): option is { value: unknown; label?: unknown } => option !== null && typeof option === "object")
        .map((option) => {
            const value = typeof option.value === "string" ? option.value : String(option.value ?? "");
            const label = typeof option.label === "string" && option.label !== "" ? option.label : value;
            return { value, label };
        })
        .filter((option) => option.value !== "");
}

/** Every registered kind, in registration order. */
export function listKindViews(): KindView[] {
    return listMcpKinds().map((kind) => ({
        id: kind.id,
        label: kind.label,
        summary: kind.summary ?? "",
        transport: kind.transport === "stdio" || kind.transport === "http" ? kind.transport : "none",
        fields: (kind.fields ?? []).map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type ?? "string",
            help: field.help ?? "",
            placeholder: field.placeholder ?? "",
            required: field.required === true,
            options: optionsOf(field),
            composer: field.composer === true
        })),
        actions: (kind.actions ?? []).map((action) => ({
            key: action.key,
            label: action.label,
            help: action.help ?? ""
        })),
        maxEntries: typeof kind.maxEntries === "number" && kind.maxEntries > 0 ? kind.maxEntries : 0,
        icon: (kind.icon ?? []).map((path) => String(path)),
        builtIn: kind.builtIn === true
    }));
}
