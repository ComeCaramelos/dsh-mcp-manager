/**
 * Host half — the mount.
 *
 * The order the two kinds of work happen in is the part that cannot be
 * reshuffled:
 *
 * 1. stand the controller up (the live bridges + the mirror);
 * 2. provide the `mcpConnections` service so a companion component that
 *    injects it registers against **this** instance's live half;
 * 3. attach the configuration form, so a commit can reach the controller;
 * 4. reconcile the row config into live bridges **once the form is attached**.
 *
 * Step 4 comes last because a bridge started before the row's own layer has
 * resolved would run whatever the patch carried at load time, and the first
 * user edit would then read as a change against a stale reference.
 *
 * `ctx.effect` disposes every live bridge with the instance, so an HMR reload
 * leaves no orphaned connection holding a server namespace.
 */
import { createManagerController } from "./controller/index.js";
import { createMcpConnectionsService } from "./service.js";
import { installManagerForm } from "./settings.js";
import type { PluginContext } from "./types.js";

/** The row config as `apply` hands it: live references for the volatile fields. */
export interface ManagerConfigInput {
    /** Every registered connection — the field the card edits. */
    servers?: unknown;
    /** The Host's live answers (never user-authored). */
    live?: unknown;
    /** Keyed nonce map `{ "<entry id>/<action key>": stamp }` — a moved stamp
     * runs that kind action once (user-authored). */
    actions?: unknown;
    /** Keyed nonce map `{ "<proposal id>": stamp }` — a moved stamp withdraws
     * that proposed connection (user-authored). */
    dismissals?: unknown;
}

/**
 * Mount the manager.
 * @param ctx - plugin context.
 * @param config - the row config, whose volatile fields are live references.
 */
export function apply(ctx: PluginContext, config: ManagerConfigInput = {}): void {
    const controller = createManagerController(ctx);
    controller.state.config = { servers: config.servers, live: config.live, actions: config.actions, dismissals: config.dismissals };

    // The extension seam itself. Provided **before** the first reconcile and
    // withdrawn with the instance: a component injecting it registers its
    // kinds and offers against this live half, and everything it registered
    // leaves when this instance does (a hot reload never double-registers).
    if (typeof (ctx as unknown as { provide?: unknown }).provide === "function") {
        // Cordis ties a provided service to this fiber's effect scope, so the
        // service leaves with the instance, and a component that injects it is
        // ordered to run only after the manager is standing.
        (ctx as unknown as { provide: (name: string, value: unknown) => void }).provide("mcpConnections", createMcpConnectionsService(controller));
    } else {
        // A context without the service channel still registers the kinds (the
        // global registry is what the controller reads anyway); loud once.
        (ctx.logger?.warn ?? (() => void 0))("dsh-mcp-manager: this dsh build cannot provide services — companion components must register kinds through `@comecaramelos/dsh-mcp-manager/api`");
    }

    // Disposing this half stops every live bridge; nothing may start after.
    ctx.effect(() => () => controller.dispose(), "dsh-mcp-manager: live bridges");

    installManagerForm(ctx, controller);

    // First fold of the row into live bridges — after the form is attached.
    controller.refresh();
}
