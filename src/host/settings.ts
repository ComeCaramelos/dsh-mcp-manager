/**
 * Host half — the configuration form.
 *
 * The machinery is `@comecaramelos/dsh-ancesters/host`'s `attachSettingsForm`:
 * identity off the fiber's own loader entry, the generated page kept off while
 * this card owns the row's page, and commit routing filtered by field. What is
 * left for this module is the holes the manager fills:
 *
 *   * **Which paths route.** `servers` is the list the card edits;
 *     `actions`/`dismissals` are keyed nonce triggers the same card stamps to
 *     ask for a run (a kind action, a proposal dismissal). A commit naming
 *     only `live`/`kinds`/`proposals` names no running behavior, and routing
 *     it would churn the revision every fenced card write fences against —
 *     the mirror is the Host's own answer, never an edit.
 *   * **What a routed commit means.** `servers` means one reconcile: fold the
 *     row into the live bridges — the diff *is* the meaning. The keyed triggers
 *     mean one run per moved key, answered by `controller.runAction` /
 *     `controller.dismissProposal` (the first read folds in silently, so a
 *     stored trigger standing at boot fires nothing).
 *   * **What the row is for logs.** `ENTRY_ID`.
 *
 * Registration rides one fiber effect (the shared half opens it there), so an
 * HMR reload never leaves a prior instance still configuring the row.
 */
import { attachSettingsForm, readVolatile } from "@comecaramelos/dsh-ancesters/host";

import { ENTRY_ID } from "./constants.js";
import type { Controller } from "./controller/index.js";
import type { PluginContext } from "./types.js";

/** The fields the card edits, including the keyed triggers that ask a run.
 * Everything else a commit could name is the Host's own live mirror. */
export const USER_FIELDS = ["servers", "actions", "dismissals"] as const;

/** Live-mirror keys — re-asserted on both sides of a persisted write, so a
 * live answer never rides back into the profile patch. `kinds` belongs here for
 * the same reason: it answers what is registered, never what the user wrote. */
export const LIVE_KEYS = ["live", "kinds", "proposals"] as const;

/**
 * Attach the row's configuration form to one controller.
 *
 * @param ctx - plugin context.
 * @param controller - the live state the form drives.
 */
export function installManagerForm(ctx: PluginContext, controller: Controller): void {
    const form = attachSettingsForm(ctx as never, {
        name: ENTRY_ID,
        userFields: USER_FIELDS,
        liveKeys: LIVE_KEYS,
        readValue: (field) => {
            if (field === "servers") return controller.entries();
            const holder = (controller.state.config as Record<string, unknown>)[field];
            return readVolatile(holder, {});
        },
        actions: {
            // `<entry id>/<action key>` — the run is answered by the kind, on
            // that entry (see `Controller.runAction`).
            actions: (key) => {
                if (key !== undefined) controller.runAction(key);
            },
            // The offer id the card said no to (D4).
            dismissals: (key) => {
                if (key !== undefined) controller.dismissProposal(key);
            }
        },
        onCommit: ({ paths }) => {
            // A trigger-only commit asks for no reconcile; the runners already
            // ran through the keyed diff.
            if (paths.some((path) => String(path[0]) === "servers")) controller.refresh();
        }
    });
    controller.state.form = form;
}
