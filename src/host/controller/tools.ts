/**
 * What each live connection actually published.
 *
 * The card's line says "3 tools", not "connected" — the model-facing names are
 * the only proof that a server is really answering, and they come off the
 * harness registry through `toolNamesByNamespace`
 * (`@comecaramelos/dsh-ancesters/host`): every MCP tool registers under
 * `mcp__<id>__<name>`, so the registry answers the question without the manager
 * ever talking to the bridge.
 *
 * What is left here is only the fold: read what one live key publishes and land
 * it on that key's line. Deciding the diff, publishing and the ordering belong
 * to the pool and the controller, not to this module.
 */
import { sameValue, toolNamesByNamespace } from "@comecaramelos/dsh-ancesters/host";

import type { Controller } from "./index.js";

/** Fold every live connection's published tool names into its line. */
export function refreshLiveTools(controller: Controller): void {
    for (const line of controller.lines()) {
        if (line.state !== "connected") continue;
        const names = toolNamesByNamespace(controller.ctx as never, line.id);
        const published = (line.extras?.tools as string[] | undefined) ?? [];
        // The same names are not a change: re-publishing what the card already
        // shows is a revision nothing asked for.
        if (sameValue(published, names)) continue;
        controller.markTools(line.id, names);
    }
}
