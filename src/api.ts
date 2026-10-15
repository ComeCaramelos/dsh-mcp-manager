/**
 * Extension API — what a companion package imports.
 *
 * A package that adds a transport shape (a Windows Chrome reached over a
 * debugging port from WSL, a Docker Desktop profile picked from the Toolkit)
 * imports exactly this module and nothing else from the manager:
 *
 * ```ts
 * import { registerMcpKind } from "@comecaramelos/dsh-mcp-manager/api";
 *
 * export function apply(ctx) {
 *     // Effect-scoped: a hot reload never leaves two kinds registered.
 *     ctx.effect(() => registerMcpKind({
 *         id: "chrome-windows",
 *         label: "Windows Chrome (WSL debug port)",
 *         transport: "none",
 *         fields: [{ key: "debugPort", label: "Debugging port", type: "string", required: true }],
 *         resolve(entry) {
 *             const port = Number(entry.extra.debugPort);
 *             if (!Number.isInteger(port) || port <= 0) return { error: "set a debugging port" };
 *             // The debugging port speaks CDP, not MCP: the MCP server is a
 *             // local chrome-devtools-mcp that connects to it.
 *             return { config: { serverName: entry.id, transport: "stdio", command: "npx",
 *                 args: ["-y", "chrome-devtools-mcp@latest", `--browserUrl=http://127.0.0.1:${port}`] } };
 *         }
 *     }));
 * }
 * ```
 *
 * Registration goes into one global registry every controller reads, so the
 * manager carries no knowledge of any package: the picker, the extra fields and
 * the live answers all come from whatever is registered at the moment an entry
 * resolves.
 *
 * @module lib/api
 */
export { builtInKinds, getMcpKind, listMcpKindIds, listMcpKinds, notifyMcpKindsChanged, registerMcpKind } from "./host/kinds/index.js";
export { listMcpProposals, notifyMcpProposalsChanged, proposeMcpConnection } from "./host/proposals.js";
export type { KindAction, KindActionContext, KindContext, KindField, KindOption, McpConnectionsService, McpKind, McpProposal, ResolvedConnection, ServerEntry, ServerLive } from "./host/types.js";
