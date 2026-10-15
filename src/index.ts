/**
 * Host half — plugin entry.
 *
 * The loader calls `apply(ctx, config)` once per mount of the `mcp-manager`
 * row, and re-mounts only when the row itself is reconfigured: every field the
 * card edits is `.volatile()`, so an edit **commits without restarting this
 * instance** — the controller picks the change up through the form's commit
 * routing and starts, switches or stops live bridges from there. That is what
 * makes a toggle land on the click instead of behind a reload.
 *
 * Also exported here: the row schema (anything reading the row document uses
 * it) and the extension seam, which companion packages import from
 * `lib/api.js` instead.
 */
export { apply } from "./host/apply.js";
export type { ManagerConfigInput } from "./host/apply.js";
export { inject, name } from "./host/plugin-meta.js";
export { Config } from "./host/schema.js";
export { builtInKinds, getMcpKind, listMcpKindIds, listMcpKinds, notifyMcpKindsChanged, registerMcpKind } from "./host/kinds/index.js";
export { listMcpProposals, notifyMcpProposalsChanged, proposeMcpConnection } from "./host/proposals.js";
export { createMcpConnectionsService } from "./host/service.js";
export type { KindAction, KindActionContext, KindContext, KindField, KindOption, McpConnectionsService, McpKind, McpProposal, ResolvedConnection, ServerEntry, ServerLive } from "./host/types.js";
