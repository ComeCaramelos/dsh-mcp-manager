/**
 * Host-half fixed identifiers, budgets and validation patterns.
 *
 * The strings are a public contract: the profile entry id is both the
 * persistence key and the Web card's configuration-form key, so it lives here
 * once and every module imports rather than repeats it. The shared row-key
 * derivation itself lives in `@comecaramelos/dsh-ancesters`.
 */

/** The profile entry id the bundle patch inserts (`cordis.patch.yml`). */
export const ENTRY_ID = "mcp-manager";

/** Cordis plugin name used by loader diagnostics. */
export const PLUGIN_NAME = "mcp-manager";

/** npm identity, tagged onto the DOM the browser half owns. */
export const PLUGIN_ID = "@comecaramelos/dsh-mcp-manager";

/**
 * npm identity of the bundle that stands on this plugin and whose patch declares
 * the row (`bundle/cordis.patch.yml`). The plugin manager answers the row's
 * configuration page under `<bundle>#<row id>` — the bundle the person installed,
 * not the package the row runs — so the browser half keys the slot by this and
 * never by `PLUGIN_ID`.
 */
export const BUNDLE_ID = "@comecaramelos/dsh-mcp-manager-bundle";

/** Locale dictionary namespace the card registers. */
export const LOCALE_NAMESPACE = "mcpManager";

/**
 * The namespace segment every live connection must match. Mirrors
 * `dsh-mcp-client`'s own `serverName` rule (`[A-Za-z0-9_-]{1,32}`) so the card
 * refuses locally what the bridge would refuse on connect.
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Budget: at most this many connections registered in one row. */
export const MAX_SERVERS = 64;

/**
 * `args` entries reach the server through a direct execve (no shell), so shell
 * metacharacters cannot execute here. What must never reach argv is a control
 * character — it corrupts the argument framing. The field's own pattern is what
 * refuses them, so the gate runs Host-side on every layer.
 */
export const ARG_PATTERN = /^(?:[^\x00-\x1f\x7f]+)$/u;

/** Where one server's stderr goes. `console` inherits it; `log` redirects it. */
export const STDERR_MODE_PATTERN = /^(?:console|log)$/u;
