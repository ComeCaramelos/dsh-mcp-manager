/**
 * The `mcpConnections` service — the seam a companion component talks to.
 *
 * The global kind registry is how two trees of this package find each other,
 * but it is not what a component imports: a component **injects** this service
 * (`inject: ["mcpConnections"]`, provided by the manager's `apply`), so the
 * component only runs while the manager runs and everything it registers is
 * withdrawn with the manager's own effect. A component registered by hand
 * through the module-level API still works — the registry is the same map — but
 * the lifecycle rides the injector's effect from here on.
 *
 * What the service adds over the bare registry is the **live** half: the
 * entries as the row names them now, one entry's live line, a way to make an
 * entry prepare again, and a write channel for the entry itself — what a slash
 * command or a component tool needs to do without the card.
 */
import type { Controller } from "./controller/index.js";
import { notifyMcpKindsChanged, registerMcpKind } from "./kinds/index.js";
import { proposeMcpConnection } from "./proposals.js";
import type { McpConnectionsService, ServerLive } from "./types.js";

/** Stand the service up over one live controller. */
export function createMcpConnectionsService(controller: Controller): McpConnectionsService {
    const service: McpConnectionsService = {
        registerKind: (kind) => registerMcpKind(kind),
        notifyKindsChanged: () => {
            notifyMcpKindsChanged();
        },
        propose: (proposal) => proposeMcpConnection(proposal),
        entries: () => controller.entries(),
        line(id: string): ServerLive | undefined {
            return controller.live().find((line) => line.id === id);
        },
        invalidate(id: string): void {
            controller.invalidate(id);
        },
        update(id, patch) {
            return controller.updateEntry(id, patch);
        }
    };
    return service;
}
