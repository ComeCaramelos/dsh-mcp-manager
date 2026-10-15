/**
 * Host-half plugin identity.
 *
 * `name` is what the cordis loader reports for diagnostics; `inject` stays
 * empty on purpose. The tools a live connection registers come from the nested
 * `dsh-mcp-client` row, and the configuration form reaches its service from
 * inside the shared form attachment — neither needs a service of our own.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "mcp-manager";

/** No host services of our own: the nested bridge declares `tools`, and the
 * settings service is reached from inside the shared form attachment. */
export const inject: string[] = [];
