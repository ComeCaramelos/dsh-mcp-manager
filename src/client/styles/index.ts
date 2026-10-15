/**
 * Browser half — the card's own stylesheet surface.
 *
 * The rules and class names live in `McpManagerCard.module.css`; the build's
 * CSS-modules step (`scripts/build-client.mjs`) compiles it — minified, names
 * scoped `hash_local` — and the card imports that map for its class names.
 *
 * Putting the sheet on the page is the shared machinery's job now:
 * `injectCardStyles` from `@comecaramelos/dsh-ancesters/client` appends the
 * shared sheet plus whatever a plugin passes, idempotently by content. All that
 * is left here is the plugin's own sheet and the step that hands it over.
 *
 * It is called from `apply`, never from a module body, so importing a module for
 * its class names cannot have DOM side effects.
 */
import { injectCardStyles as injectSharedStyles } from "@comecaramelos/dsh-ancesters/client";

import { cssText } from "./McpManagerCard.module.css";

/**
 * Append this card's stylesheet once — after the shared machinery's, on top of
 * it, so the shared rules answer a card's defaults and this one's answer the
 * manager's layout.
 */
export function injectCardStyles(): void {
    injectSharedStyles([cssText]);
}
