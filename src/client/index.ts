/**
 * Browser half — the plugin body.
 *
 * Built from the shared card machinery
 * (`@comecaramelos/dsh-ancesters/client`'s `mountSettingsCard`), so what is
 * declared here is the descriptor and the one block this plugin owns: styles,
 * locales, the controller over this row's configuration form, and the
 * `plugins.bundle.config` registration keyed by the bundle package all come
 * from the shared half.
 *
 * Three fields describe the whole body:
 *
 *   * `servers` — the list itself, written **immediately**: a connection that
 *     is added, edited or turned off has to take effect on the click that asked
 *     for it, not behind an apply button;
 *   * `live` — the Host's per-connection answers, read-only;
 *   * `kinds` — every registered kind, including the ones only a companion
 *     package registered, so the picker and the extra fields come from the Host
 *     rather than from a copy the browser bundle would have to keep.
 */
import { mountSettingsCard } from "@comecaramelos/dsh-ancesters/client";

import { ConnectionsBlock } from "./card/connections.js";
import { SummaryLine } from "./card/summary.js";
import { composerDeclarations, normalizeList, summarize } from "./catalog.js";
import { DICTIONARIES } from "./locales/index.js";
import { ENTRY_ID, LOCALE_NAMESPACE, BUNDLE_ID, PLUGIN_ID } from "./plugin-meta.js";
import { injectCardStyles } from "./styles/index.js";

/** The descriptor that makes this plugin's card. */
export const card = mountSettingsCard({
    entryId: ENTRY_ID,
    pluginId: PLUGIN_ID,
    bundleId: BUNDLE_ID,
    localeNamespace: LOCALE_NAMESPACE,
    locale: DICTIONARIES,
    // The bundle's own page (`plugins.bundle.config`, keyed by `BUNDLE_ID`), the
    // way dsh-web-search-searxng stands: clicking the plugin in the Plugins list
    // opens the list and its editor directly, with no step into the
    // `mcp-manager` component (its row still lists below, with no page of its own).
    placement: "bundle",
    fields: {
        immediate: ["servers"],
        liveKeys: ["live", "kinds", "proposals"]
    },
    blocks: [
        {
            block: ConnectionsBlock as never,
            liveKeys: ["live", "kinds", "proposals"],
            bind: (snapshot: any, controller: any) => ({
                servers: snapshot.values.servers,
                live: snapshot.values.live,
                kinds: snapshot.values.kinds,
                proposals: snapshot.values.proposals,
                available: snapshot.available === true,
                writable: snapshot.writable === true,
                saving: snapshot.saving === true,
                write: (value: unknown): Promise<boolean> => controller.writeField("servers", value),
                /** A saved entry's kind button — the keyed trigger, so only the
                 * entry it names fires (the `entryActions` idiom). */
                runAction: (key: string): Promise<boolean> => controller.writeEntryTrigger("actions", key),
                /** A proposal the person said no to. */
                dismissProposal: (id: string): Promise<boolean> => controller.writeEntryTrigger("dismissals", id)
            })
        }
    ],
    /**
     * The composer's pills (R6): one per enabled entry whose kind marks a field
     * for the composer. The pick writes the same list the card edits, so the
     * live fiber switches in place and the card follows without a reload.
     */
    composer: {
        id: "mcp-manager.composer",
        bind: (snapshot: any, controller: any) =>
            composerDeclarations(
                normalizeList(snapshot.values.servers),
                snapshot.values.kinds,
                (next: readonly Record<string, unknown>[]) => controller.writeField("servers", next)
            )
    },
    /**
     * What the collapsed row says — the count of what is running and what is
     * broken. The whole point of the collapsed state is knowing whether to open
     * the card, and the live mirror already answers that.
     *
     * The copy arrives as `t`: the shared machinery binds this card's locale
     * namespace and hands the summary line a translator, so the line binds
     * nothing itself and, once it has one, never renders a bare key.
     */
    renderSummary: (snapshot: any, t: ((key: string) => string) | undefined) => {
        const { total, live, failed } = summarize(snapshot.values);
        return SummaryLine({ total, live, failed, t });
    }
});

/** Services the shell must resolve before `apply` runs. */
export const inject = card.inject;

/**
 * The loader entry.
 *
 * Own stylesheet first — the shared machinery injects only its own — then the
 * card's own `apply`, which stands up locales, the controller and the row's
 * config slot.
 */
export function apply(ctx: Parameters<typeof card.apply>[0]): void {
    injectCardStyles();
    card.apply(ctx);
}
