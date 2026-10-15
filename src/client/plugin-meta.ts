/**
 * Browser half — identity and the services the shell must resolve.
 *
 * The identifiers are contracts with the host half: the profile entry id is the
 * key every read and write goes through (the configuration form's entry and the
 * row the bundle's own patch declares), the locale namespace is the lookup root
 * for every string the card renders, and the npm id tags the DOM this half
 * owns. The browser bundle is emitted on its own, so it cannot import
 * `host/constants.js` and the two values are mirrored here —
 * `test/client.test.mjs` pins the mirror against the host half's export, so a
 * drift fails loudly.
 */

/** Profile entry id the host half serves; the configuration form's key. */
export const ENTRY_ID = "mcp-manager";

/** npm id of the plugin package; tags the DOM this half owns. */
export const PLUGIN_ID = "@comecaramelos/dsh-mcp-manager";

/**
 * npm id of the bundle that stands on this plugin. The manager answers the row's
 * configuration page by the bundle a person installs, not by the package the row
 * runs, so this is what the row key is built from (`bundleId` handed to
 * `mountSettingsCard`).
 */
export const BUNDLE_ID = "@comecaramelos/dsh-mcp-manager-bundle";

/**
 * Key the card registers the row-configuration slot under: `<bundle>#<row id>`, a
 * *derived* key rather than a separate identity — `ENTRY_ID` is what every read
 * and write actually goes through.
 */
export const ROW_CONFIG_KEY = `${BUNDLE_ID}#${ENTRY_ID}`;

/** Locale dictionary namespace this half registers and renders from. */
export const LOCALE_NAMESPACE = "mcpManager";

/** Budget: the most connections one row may register (mirrors the host half). */
export const MAX_SERVERS = 64;

/** Services the shell must resolve before `apply` runs. */
export const inject = ["slots", "locale", "configForms"];
