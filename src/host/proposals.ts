/**
 * Connection proposals — what a component offers to create (D4).
 *
 * A companion component that finds a standalone config in its own row does not
 * write the manager's `servers` list behind the user's back: it **offers** the
 * entry through the service (`propose`) and the manager reflects the offer on
 * the live mirror, where the card says *Create connection* / *Dismiss*. Nothing
 * lands in `servers` before a click.
 *
 * The registry is global (`globalThis` under one `Symbol.for(...)`), the same
 * idiom as the kind registry: the component that offers and the manager that
 * publishes may have resolved separate copies of this package, and an offer
 * held in module scope would never reach the controller that mirrors it.
 *
 * Registration is keyed by `proposal.id`: registering the same id again
 * **replaces** the earlier offer — that is how a component refreshes a proposal
 * after another commit of its row, without a flicker between disposer and
 * register. The returned disposer withdraws the offer (and only its own: a
 * newer registration stands).
 *
 * @module
 */
import { createGlobalRegistry, type GlobalRegistry } from "@comecaramelos/dsh-ancesters/host";

import type { McpProposal } from "./types.js";

/** The one global proposal registry, keyed by this package's own symbol. */
const REGISTRY: GlobalRegistry<McpProposal> = createGlobalRegistry<McpProposal>(
    Symbol.for("@comecaramelos/dsh-mcp-manager/proposals")
);

/** Who wants to know that the standing offers moved — every live controller. */
const LISTENERS_KEY = Symbol.for("@comecaramelos/dsh-mcp-manager/proposals-changed");
const LISTENERS: Set<() => void> = ((globalThis as Record<symbol, unknown>)[LISTENERS_KEY] ??= new Set<() => void>()) as Set<() => void>;

/**
 * Say that the standing proposals moved. Same rules as the kinds' notification:
 * cheap to fire, a listener that throws never stops the others.
 */
export function notifyMcpProposalsChanged(): void {
    for (const listener of [...LISTENERS]) {
        try {
            listener();
        } catch {
            // A controller that cannot republish is its own problem.
        }
    }
}

/**
 * Hear every {@link notifyMcpProposalsChanged}.
 * @returns a disposer; idempotent.
 */
export function onMcpProposalsChanged(listener: () => void): () => void {
    LISTENERS.add(listener);
    return () => {
        LISTENERS.delete(listener);
    };
}

/**
 * Offer one connection to create.
 *
 * @param proposal - the translated entry on offer; its `id` is the key.
 * @returns a disposer withdrawing this offer (a newer one under the same `id`
 * stands untouched).
 */
export function proposeMcpConnection(proposal: McpProposal): () => void {
    if (proposal === null || typeof proposal !== "object" || typeof proposal.id !== "string" || proposal.id === "") {
        throw new TypeError("proposeMcpConnection: `proposal.id` must be a non-empty string");
    }
    if (typeof proposal.entry !== "object" || proposal.entry === null || typeof proposal.entry.id !== "string" || proposal.entry.id === "") {
        throw new TypeError(`proposeMcpConnection(${proposal.id}): \`proposal.entry.id\` must be a non-empty string`);
    }
    const dispose = REGISTRY.register(proposal.id, proposal);
    notifyMcpProposalsChanged();
    let disposed = false;
    const withdrawn = (): void => {
        if (disposed) return;
        disposed = true;
        if (DISPOSERS.get(proposal.id) === withdrawn) DISPOSERS.delete(proposal.id);
        dispose();
        notifyMcpProposalsChanged();
    };
    DISPOSERS.set(proposal.id, withdrawn);
    return withdrawn;
}

/** Every standing offer, in registration order. */
export function listMcpProposals(): readonly McpProposal[] {
    return REGISTRY.list();
}

/** The offer registered under `id`, or undefined. */
export function getMcpProposal(id: string): McpProposal | undefined {
    return REGISTRY.get(id);
}

/**
 * Every standing offer's disposer, keyed by id — the way to withdraw a proposal
 * from whoever did not call `proposeMcpConnection` (a *Dismiss* the Host routes
 * through `dismissMcpProposal`). Global for the same reason the registry is.
 */
const DISPOSERS_KEY = Symbol.for("@comecaramelos/dsh-mcp-manager/proposals-disposers");
const DISPOSERS: Map<string, () => void> = ((globalThis as Record<symbol, unknown>)[DISPOSERS_KEY] ??= new Map<string, () => void>()) as Map<string, () => void>;

/**
 * Withdraw one offer by id — what *Dismiss* lands as. The offer is gone first,
 * then the proposal's own `onDismiss` runs (the component records
 * `migrationDismissed` in its own row so it stops re-offering). A failing
 * `onDismiss` — thrown or rejected — still leaves the offer withdrawn: the
 * person said no. The failure goes to `onError`.
 *
 * @param onError - where a failure to record the dismissal is reported.
 * @returns whether an offer stood under that id.
 */
export function dismissMcpProposal(id: string, onError?: (line: string) => void): boolean {
    const proposal = REGISTRY.get(id);
    const dispose = DISPOSERS.get(id);
    if (proposal === undefined && dispose === undefined) return false;
    // The offer leaves first, whatever `onDismiss` does: the person said no,
    // and a component that fails to remember it must not get the card to offer
    // it again within this session. A failure to record it — thrown, or a
    // promise that rejects (persisting into the row is a write) — is reported,
    // never swallowed.
    if (dispose !== undefined) {
        DISPOSERS.delete(id);
        dispose();
    }
    notifyMcpProposalsChanged();
    const report = (error: unknown): void => {
        onError?.(`proposal "${id}" was dismissed but could not record it: ${error instanceof Error ? error.message : String(error)}`);
    };
    try {
        const recorded = proposal?.onDismiss?.();
        if (recorded !== null && typeof recorded === "object" && typeof (recorded as PromiseLike<unknown>).then === "function") {
            (recorded as PromiseLike<unknown>).then(void 0, report);
        }
    } catch (error) {
        report(error);
    }
    return true;
}
