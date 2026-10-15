/**
 * Reading the row config the way cordis hands it.
 *
 * The reading half used to be this module's own: a live reference had to be
 * told apart from a plain value, and the array had to come back as a copy
 * because the diff sorts, filters and reads it. Both belong to
 * `@comecaramelos/dsh-ancesters` now — `readVolatile` is one rule for both
 * shapes, and the ceiling on live keys is the pool's `cap`, not a slice here.
 *
 * What stays is the manager's own answer: **which field exists, what its
 * default is, and how a wrong type falls back** — every field answers, so
 * nothing downstream guards against a missing key, and a bad type collapses to
 * its default rather than throwing.
 *
 * Note what is *not* filtered here: an id that cannot be a namespace, or two
 * entries claiming one, is not dropped. The live half answers them as their own
 * lines (`failed`, `conflict`), because a card that showed only what is running
 * hides exactly the case the user has to fix.
 */
import { readVolatile } from "@comecaramelos/dsh-ancesters/host";

import type { ServerEntry } from "./types.js";

/** Every registered connection, in registration order. */
export function readServers(config: { servers?: unknown }): ServerEntry[] {
    const raw = readVolatile<unknown[]>(config.servers, []);
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
        .map(normalizeServer);
}

/** One raw entry, normalized to what the whole host half speaks. */
export function normalizeServer(raw: Record<string, unknown>): ServerEntry {
    return {
        id: typeof raw.id === "string" ? raw.id.trim() : "",
        kind: typeof raw.kind === "string" && raw.kind !== "" ? raw.kind.trim() : "stdio",
        enabled: raw.enabled !== false,
        label: typeof raw.label === "string" ? raw.label : "",
        command: typeof raw.command === "string" ? raw.command : "",
        args: Array.isArray(raw.args) ? raw.args.filter((item): item is string => typeof item === "string") : [],
        env: stringMap(raw.env),
        cwd: typeof raw.cwd === "string" ? raw.cwd : "",
        stderrMode: raw.stderrMode === "log" ? "log" : "console",
        stderrLog: typeof raw.stderrLog === "string" ? raw.stderrLog : "",
        url: typeof raw.url === "string" ? raw.url.trim() : "",
        headers: stringMap(raw.headers),
        toolCallTimeoutMs: numberOr(raw.toolCallTimeoutMs, 60000),
        maxInstructionBytes: numberOr(raw.maxInstructionBytes, 32768),
        failOnStartupError: raw.failOnStartupError === true,
        reconnect: raw.reconnect !== null && typeof raw.reconnect === "object" ? (raw.reconnect as Record<string, unknown>) : {},
        extra: stringMap(raw.extra)
    };
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringMap(value: unknown): Record<string, string> {
    if (value === null || typeof value !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof item === "string") out[key] = item;
    }
    return out;
}
