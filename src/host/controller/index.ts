/**
 * Controller — the live half of the manager, standing on
 * `@comecaramelos/dsh-ancesters`'s fiber pool.
 *
 * What used to live here — the bridge map, the diff that starts / switches /
 * stops fibers, the volatile commit that turns them into lines the card reads —
 * is one keyed list reconciled against live fibers, which is exactly what
 * `createFiberPool` is. What is left is three holes and one rule:
 *
 *   * `entries()` — what the row names, read **live**: cordis starts the
 *     `settings` injection callback after `apply` returns, so a value captured
 *     here would pin every consumer to the config at load time and no GUI edit
 *     would ever reach a running fiber;
 *   * `resolve(entry)` — what a `kind` answers, through `resolveMcpKind`: an
 *     entry that resolves to nothing starts nothing and answers why;
 *   * `start(config)` — the nested `dsh-mcp-client` fiber itself;
 *   * `validate(entry)` — the rule the pool cannot derive: the id **is** the
 *     namespace every tool registers under, so it must be well-formed. A second
 *     entry claiming one namespace the pool answers as `conflict` on its own,
 *     because `dsh-mcp-client` refuses it.
 *
 * Nothing here diffs, starts, stops, guards a delayed answer or mirrors. The
 * only thing kept for this plugin is publishing the mirror, and folding back
 * what each live connection actually published.
 */
import { createFiberPool, createLiveMirror, createPersister, toolNamesByNamespace, type LiveMirror, type PersistUser, type PoolLine } from "@comecaramelos/dsh-ancesters/host";
import type { SettingsFormHandle, UserFields } from "@comecaramelos/dsh-ancesters/host";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";

import { ENTRY_ID, MAX_SERVERS, SERVER_NAME_PATTERN } from "../constants.js";
import { getMcpKind, onMcpKindsChanged, resolveMcpKind } from "../kinds/index.js";
import { dismissMcpProposal, listMcpProposals, onMcpProposalsChanged } from "../proposals.js";
import { LIVE_KEYS } from "../settings.js";
import type { KindActionContext, PluginContext, ServerEntry, ServerLive } from "../types.js";
import { normalizeServer, readServers } from "../values.js";
import { listKindViews } from "./kinds.js";
import { refreshLiveTools } from "./tools.js";

/** The controller's live state. */
export interface ControllerState {
    /** The row config, kept **by reference** — volatile fields read live. */
    config: { servers: unknown; live: unknown; actions?: unknown; dismissals?: unknown };
    /** The attached configuration form; the mirror reads settings through it. */
    form?: SettingsFormHandle;
    /** The live mirror, stood up on first publish. */
    mirror?: LiveMirror;
}

/** The controller surface the rest of the host half reads. */
export interface Controller {
    /** The plugin context. */
    ctx: PluginContext;
    state: ControllerState;
    /** The row's registered entries, read live. */
    entries(): ServerEntry[];
    /** One mirror line per registered entry, in entry order. */
    live(): ServerLive[];
    /** One entry's live line, when it has one. */
    line(id: string): ServerLive | undefined;
    /** The pool's own lines, when a consumer needs the whole answer. */
    lines(): readonly PoolLine<ServerEntry>[];
    /** Fold what one live connection published into its line. */
    markTools(id: string, tools: readonly string[]): void;
    /** Make one entry prepare again — the run behind a kind's action. */
    invalidate(id: string): void;
    /** Run one kind action named by a trigger key `<id>/<action key>`. */
    runAction(key: string): void;
    /** Withdraw one proposed connection (the card's *Dismiss*). */
    dismissProposal(id: string): void;
    /** Rewrite one entry through the row's own write channel. */
    updateEntry(id: string, patch: Partial<ServerEntry>): Promise<boolean>;
    /** Re-read the row and fold it — what a form commit fires. */
    refresh(): void;
    /** Standing proposals as the mirror answers them. */
    proposals(): unknown[];
    /** Publish the live mirror. */
    publish(): void;
    /** Tear down every live fiber. Goes in the effect's disposer. */
    dispose(): void;
}

/** Stand up one controller's live half. */
export function createManagerController(ctx: PluginContext): Controller {
    const state: ControllerState = { config: { servers: void 0, live: void 0 } };
    /** Publishing folds the tool names in, and folding answers one line. */
    let folding = false;
    /** The host-side write channel, stood up on the first `updateEntry`. */
    let persist: PersistUser | undefined;

    /** Publish the mirror — stood up once, on the first answer. */
    function publishLive(): void {
        if (state.mirror === void 0) {
            state.mirror = createLiveMirror(ctx as never, {
                name: ENTRY_ID,
                read: () => ({ live: controller.live(), kinds: listKindViews(), proposals: controller.proposals() }),
                settings: () => state.form?.current()?.settings
            });
        }
        state.mirror.publish();
    }

    const pool = createFiberPool<ServerEntry>(ctx as never, {
        prefix: "dsh-mcp-manager",
        cap: MAX_SERVERS,

        entries: () => readServers(state.config),
        id: (entry) => entry.id,
        enabled: (entry) => entry.enabled,
        resolve: (entry) => resolveMcpKind(entry, { logger: ctx.logger }),

        // Identity first, because everything below a key that cannot exist is
        // built on it: an unusable key answers a line and starts nothing.
        validate: (entry) => {
            if (entry.id === "") {
                return { error: "connection has no id (the namespace its tools register under)", state: "failed" as const };
            }
            if (!SERVER_NAME_PATTERN.test(entry.id)) {
                return { error: `invalid id "${entry.id}" — use 1 to 32 of A–Z, a–z, 0–9, "_" or "-"`, state: "failed" as const };
            }

            // A kind that caps how many entries it may have answers the ones
            // past the limit as `conflict` — the list is what it is, and the
            // extra entry starts nothing rather than displacing the first.
            const maxEntries = getMcpKind(entry.kind)?.maxEntries ?? 0;
            if (maxEntries > 0) {
                const same = readServers(state.config).filter((row) => row.kind === entry.kind);
                const position = same.findIndex((row) => row.id === entry.id);
                if (position >= maxEntries) {
                    return {
                        error: `kind "${entry.kind}" allows at most ${maxEntries} connection${maxEntries === 1 ? "" : "s"} — this one starts nothing`,
                        state: "conflict" as const
                    };
                }
            }

            // A namespace already claimed **outside** this list — a bare
            // `dsh-mcp-client` row the user still has, a component bridge from
            // before this release — refuses the second registration just as a
            // duplicate inside the list does. Skip the check while this very
            // entry stands live behind its own connection: its tools are the
            // registry's answer for itself, not someone else's claim.
            const mine = controller.live().find((line) => line.id === entry.id);
            if (mine === undefined || (mine.state !== "connected" && mine.state !== "starting")) {
                if (toolNamesByNamespace(ctx as never, entry.id).length > 0) {
                    return {
                        error: `"${entry.id}" already has tools registered outside this list — pick a different id or retire the other server`,
                        state: "conflict" as const
                    };
                }
            }
            return void 0;
        },

        start: (config) => ctx.plugin(McpClient as never, config as never) as never,

        log: (level, message) => {
            const logger = ctx.logger as unknown as Record<"info" | "warn", ((line: string) => void) | undefined>;
            logger[level]?.(message);
        },

        publish: () => {
            // What the lines now are is read from the pool, so publishing them
            // means publishing the mirror they land in.
            publishLive();
            // A line that just became live has not answered what it publishes.
            if (folding) return;
            folding = true;
            try {
                refreshLiveTools(controller);
            } finally {
                folding = false;
            }
        }
    });

    // What the kinds answer moved (one registered late, a discovery landed):
    // the picker and the choices follow without a restart. Before the first
    // publish there is no mirror to move, and that publish reads them anyway.
    const stopHearingKinds = onMcpKindsChanged(() => {
        if (state.mirror === void 0) return;
        // A kind that arrived (or left) changes what an entry **resolves** to,
        // not only what the picker offers: an entry that answered "kind … is not
        // registered" before its component registered must now start, and one
        // whose kind left must stop. Reconciling does both, and it is cheap —
        // an unchanged entry is a no-op and a prepared answer is kept. The
        // reconcile publishes the mirror itself.
        //
        // A prepared (asynchronous) answer is kept per entry state, so an entry
        // whose kind just left would keep running what its departed kind
        // prepared: forget those first, so the reconcile asks again and gets
        // the "not registered" line.
        for (const entry of readServers(state.config)) {
            if (getMcpKind(entry.kind) === void 0) pool.invalidate(entry.id);
        }
        pool.refresh();
    });

    // The offers a component stands up (a config its own row still carries,
    // translated) move the mirror's `proposals` without a restart.
    const stopHearingProposals = onMcpProposalsChanged(() => {
        if (state.mirror !== void 0) state.mirror.publish();
    });

    const controller: Controller = {
        ctx,
        state,

        entries: () => readServers(state.config),

        live(): ServerLive[] {
            return pool.live().map((line) => ({
                id: line.id,
                state: line.state,
                error: line.error,
                note: line.note,
                tools: (line.extras?.tools as string[] | undefined) ?? []
            }));
        },

        lines: () => pool.live(),

        proposals(): unknown[] {
            // The offers with no entry of that kind already registered (the
            // card's *Create connection* is what withdraws one — the filtering
            // is what makes the notice go quiet the moment that write lands).
            const taken = new Set(controller.entries().map((entry) => entry.kind));
            return listMcpProposals()
                .filter((proposal) => !taken.has(proposal.entry.kind))
                .map((proposal) => ({
                    id: proposal.id,
                    title: proposal.title,
                    entry: normalizeServer(proposal.entry as never)
                }));
        },

        line(id: string): ServerLive | undefined {
            return controller.live().find((line) => line.id === id);
        },

        markTools(id: string, tools: readonly string[]): void {
            pool.mark(id, { extras: { tools: [...tools] } });
        },

        invalidate(id: string): void {
            pool.invalidate(id);
        },

        /**
         * Run one kind action the card asked for, named by `<id>/<action key>`.
         * A row that no longer exists answers nothing (the trigger map's diff is
         * what fires this, and the row it stood for may be gone by the time the
         * commit lands); a kind or action that stopped being registered answers
         * the same, with a line rather than a crash.
         */
        runAction(key: string): void {
            const split = key.lastIndexOf("/");
            const id = split < 0 ? "" : key.slice(0, split);
            const actionKey = split < 0 ? "" : key.slice(split + 1);
            const entry = controller.entries().find((row) => row.id === id);
            if (entry === undefined) return;
            // An action is not the connection: a Fetch that fails says so on the
            // line's note, and a connection that is live stays live. Only what
            // the connection itself answers (its first connect, a resolve) may
            // turn the line `failed`.
            const say = (note: string): void => {
                pool.mark(id, { note });
                (ctx.logger as unknown as { warn?(line: string): void })?.warn?.(`dsh-mcp-manager(${id}): ${note}`);
            };
            const action = (getMcpKind(entry.kind)?.actions ?? []).find((item) => item.key === actionKey);
            if (action === undefined) {
                say(`kind "${entry.kind}" answers no action "${actionKey}"`);
                return;
            }
            const context: KindActionContext = { logger: ctx.logger, invalidate: () => pool.invalidate(id) };
            void Promise.resolve()
                .then(() => action.run(entry, context))
                .then((answer: unknown) => {
                    // A kind may answer `{ error }`, `{ note }` or nothing; a
                    // thrown failure reads the same as a returned error.
                    if (answer !== null && typeof answer === "object") {
                        const { error, note } = answer as { error?: unknown; note?: unknown };
                        if (typeof error === "string" && error !== "") say(`${action.label}: ${error}`);
                        else if (typeof note === "string") pool.mark(id, { note });
                    }
                })
                .catch((error: unknown) => {
                    say(`${action.label}: ${error instanceof Error ? error.message : String(error)}`);
                });
        },

        dismissProposal(id: string): void {
            dismissMcpProposal(id, (line) => (ctx.logger as unknown as { warn?(line: string): void })?.warn?.(`dsh-mcp-manager: ${line}`));
        },

        /**
         * Fold one entry's patch into `servers` and write it back through the
         * row's own channel — what a slash command or a component tool does for
         * a person without the card. A row that is not there answers `false`;
         * so does a write the running document refuses.
         */
        async updateEntry(id: string, patch: Partial<ServerEntry>): Promise<boolean> {
            const rows = controller.entries();
            const index = rows.findIndex((row) => row.id === id);
            if (index < 0) return false;
            const merged: Record<string, unknown> = { ...rows[index], ...patch, extra: { ...rows[index].extra, ...(patch.extra ?? {}) } };
            const next = rows.map((row, position) => (position === index ? merged : row));
            if (persist === void 0) {
                if (state.form === undefined) return false;
                persist = createPersister(ctx as never, {
                    form: state.form,
                    liveKeys: LIVE_KEYS,
                    publishLive,
                    name: ENTRY_ID
                });
            }
            try {
                await persist({ servers: next } as UserFields, `connection "${id}" updated`);
            } catch (error) {
                (ctx.logger as unknown as { warn?(line: string): void })?.warn?.(`update "${id}": ${String(error)}`);
                return false;
            }
            controller.refresh();
            return true;
        },

        refresh(): void {
            pool.refresh();
        },

        publish: publishLive,

        dispose(): void {
            stopHearingKinds();
            stopHearingProposals();
            pool.dispose();
            publishLive();
        }
    };

    return controller;
}
