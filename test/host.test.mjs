/**
 * Host half — the entry model and the kinds registry.
 *
 * The two things the manager's whole shape rests on: every field of a raw row
 * entry answers even when it is missing or malformed, and a connection only
 * ever resolves through a registered kind.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeServer, readServers } from "../lib/host/values.js";
import { builtInKinds, getMcpKind, listMcpKindIds, registerMcpKind, resolveMcpKind } from "../lib/host/kinds/index.js";

test("normalizeServer answers every field from nothing", () => {
    const entry = normalizeServer({ id: " demo " });
    assert.equal(entry.id, "demo");
    assert.equal(entry.kind, "stdio");
    assert.equal(entry.enabled, true);
    assert.deepEqual(entry.args, []);
    assert.equal(entry.stderrMode, "console");
    assert.equal(entry.toolCallTimeoutMs, 60000);
    assert.deepEqual(entry.extra, {});
});

test("normalizeServer collapses a bad type to its default", () => {
    const entry = normalizeServer({ id: 1, args: "not a list", env: "nope", toolCallTimeoutMs: "5000" });
    assert.equal(entry.id, "");
    assert.deepEqual(entry.args, []);
    assert.deepEqual(entry.env, {});
    assert.equal(entry.toolCallTimeoutMs, 60000);
});

test("readServers reads live references and plain values alike", () => {
    const rows = [{ id: "one", kind: "http", url: "http://127.0.0.1:1/mcp" }, { id: "two", command: "echo" }];
    assert.equal(readServers({ servers: rows }).length, 2);
    assert.equal(readServers({ servers: { get: () => rows } }).length, 2);
    assert.equal(readServers({ servers: { get: () => void 0 } }).length, 0);
});

test("the built-ins are registered on import", () => {
    assert.deepEqual([...listMcpKindIds()].sort(), ["http", "stdio"]);
    assert.equal(builtInKinds.length, 2);
    assert.equal(getMcpKind("stdio")?.builtIn, true);
});

test("stdio in log mode runs through the Node wrapper on every platform and says where stderr went", () => {
    const entry = normalizeServer({ id: "demo", command: "npx", args: ["-y", "srv"], stderrMode: "log", stderrLog: "/tmp/demo.log" });
    const resolved = resolveMcpKind(entry, { logger: null });
    assert.equal(resolved.config.command, process.execPath);
    assert.match(resolved.config.args[0], /stderr-wrapper\.js$/u);
    assert.deepEqual(resolved.config.args.slice(1), ["/tmp/demo.log", "demo", "npx", "-y", "srv"]);
    assert.equal(resolved.note, "stderr → /tmp/demo.log");

    const plain = resolveMcpKind(normalizeServer({ id: "demo", command: "npx", args: ["-y", "srv"] }), { logger: null });
    assert.equal(plain.config.command, "npx", "console mode spawns the command as given");
    assert.equal(plain.note, void 0);
});

test("resolveMcpKind answers a reason for a kind nothing registered", () => {
    const resolved = resolveMcpKind({ ...normalizeServer({ id: "x", kind: "chrome-windows" }) }, { logger: null });
    assert.match(String(resolved.error), /not registered/u);
    assert.equal(resolved.config, void 0);
});

test("registerMcpKind replaces, and disposers run in reverse order", () => {
    const resolveNote = (value) => ({ id: `test-kind-${value}`, label: value, transport: "none", resolve: () => ({ note: value }) });
    const first = resolveNote("first");
    const second = resolveNote("second");

    const disposeFirst = registerMcpKind(first);
    const entry = normalizeServer({ id: "a", kind: "test-kind-first" });
    assert.equal(resolveMcpKind(entry, { logger: null }).note, "first");

    const disposeSecond = registerMcpKind(second);
    assert.equal(resolveMcpKind(normalizeServer({ id: "a", kind: "test-kind-second" }), { logger: null }).note, "second");

    // Reverse order, the way effects dispose: the newest answer goes first, the
    // older one is restored under it, then the older one goes too.
    disposeSecond();
    disposeFirst();

    assert.equal(getMcpKind("test-kind-first"), void 0);
    assert.equal(getMcpKind("test-kind-second"), void 0);
});

test("a disposer leaves a newer registration alone", () => {
    const older = { id: "test-kind-older", label: "Older", transport: "none", resolve: () => ({ note: "older" }) };
    const newer = { id: "test-kind-newer", label: "Newer", transport: "none", resolve: () => ({ note: "newer" }) };
    registerMcpKind(older);
    registerMcpKind(newer);
    // Same id, registered later: the older disposer must not erase it.
    const id = "test-kind-newer";
    const disposeOlder = registerMcpKind({ id, label: "Replaced", transport: "none", resolve: () => ({ note: "replaced" }) });
    const disposeLatest = registerMcpKind({ id, label: "Latest", transport: "none", resolve: () => ({ note: "latest" }) });
    assert.equal(getMcpKind(id)?.label, "Latest");
    disposeLatest();
    assert.equal(getMcpKind(id)?.label, "Replaced");
    disposeOlder();
    assert.equal(getMcpKind(id)?.label, "Newer");
});

test("registerMcpKind refuses a kind with no resolve", () => {
    assert.throws(() => registerMcpKind({ id: "broken", label: "x", transport: "none" }), /must be a function/u);
});

test("a select's options are read by the Host at publish time, and a broken answer offers nothing", async () => {
    const { listKindViews } = await import("../lib/host/controller/kinds.js");
    let discovered = [{ value: "default" }];
    const dispose = registerMcpKind({
        id: "test-select-kind",
        label: "Select",
        transport: "none",
        fields: [
            { key: "profile", label: "Profile", type: "select", options: () => discovered },
            { key: "fixed", label: "Fixed", type: "select", options: [{ value: "a", label: "A" }, { value: "" }] },
            { key: "broken", label: "Broken", type: "select", options: () => { throw new Error("no daemon"); } }
        ],
        resolve: () => ({ error: "unused" })
    });
    const view = () => listKindViews().find((kind) => kind.id === "test-select-kind");
    assert.deepEqual(view().fields[0].options, [{ value: "default", label: "default" }], "a label-less option reads as its value");
    assert.deepEqual(view().fields[1].options, [{ value: "a", label: "A" }], "an empty value is no choice");
    assert.deepEqual(view().fields[2].options, [], "a throwing discovery offers nothing instead of taking the mirror down");
    discovered = [{ value: "default" }, { value: "dev", label: "Dev" }];
    assert.deepEqual(view().fields[0].options.map((option) => option.value), ["default", "dev"], "asked again on every read");
    dispose();
});

test("registering, removing and notifying all reach the listeners", async () => {
    const { notifyMcpKindsChanged, onMcpKindsChanged } = await import("../lib/host/kinds/index.js");
    let heard = 0;
    const stop = onMcpKindsChanged(() => { heard++; });
    const dispose = registerMcpKind({ id: "test-notify-kind", label: "N", transport: "none", resolve: () => ({}) });
    assert.equal(heard, 1, "a kind arriving is news");
    notifyMcpKindsChanged();
    assert.equal(heard, 2, "so is a discovery that moved its options");
    dispose();
    dispose();
    assert.equal(heard, 3, "a kind leaving is news, once");
    stop();
    notifyMcpKindsChanged();
    assert.equal(heard, 3, "a stopped listener hears nothing more");
});

/**
 * Phase 3, item 6 — the proposal registry: offers stand keyed by id, a newer
 * offer under the same id replaces the earlier one, and the withdrawer is
 * idempotent and leaves a newer registration alone.
 */
test("the proposal registry replaces by id and a stale disposer leaves the newer offer standing", async () => {
    const { proposeMcpConnection, listMcpProposals, getMcpProposal } = await import("../lib/host/proposals.js");

    const first = proposeMcpConnection({ id: "same", title: "Old", entry: { id: "one", kind: "x" } });
    const second = proposeMcpConnection({ id: "same", title: "New", entry: { id: "two", kind: "x" } });
    assert.equal(listMcpProposals().length, 1, "one offer per id, not a stack");
    assert.equal(getMcpProposal("same").title, "New");

    first();
    assert.equal(getMcpProposal("same").title, "New", "a stale disposer never takes the newer offer down");
    second();
    assert.equal(listMcpProposals().length, 0);

    assert.throws(() => proposeMcpConnection({ id: "", entry: { id: "x", kind: "x" } }), TypeError);
    assert.throws(() => proposeMcpConnection({ id: "x", entry: { id: "", kind: "x" } }), TypeError);
});

/**
 * Phase 3, item 2 — the `mcpConnections` service, the half a companion
 * component injects. Its holes must land on the controller it stands on, so
 * what a component sees is one manager, not a private copy.
 */
test("the service answers through the controller it was stood up on", async () => {
    const { createMcpConnectionsService } = await import("../lib/host/service.js");
    const seen = [];
    const lines = new Map([["one", { id: "one", state: "connected" }]]);
    const fakeController = {
        entries: () => [{ id: "one", kind: "stdio" }],
        live: () => [...lines.values()],
        invalidate: (id) => seen.push(["invalidate", id]),
        updateEntry: async (id) => {
            seen.push(["update", id]);
            return id === "one";
        },
        proposals: () => [],
        refresh: () => seen.push(["refresh"])
    };
    const service = createMcpConnectionsService(fakeController);
    assert.deepEqual(service.entries(), [{ id: "one", kind: "stdio" }]);
    assert.deepEqual(service.line("one"), { id: "one", state: "connected" });
    assert.equal(service.line("nope"), void 0);
    service.invalidate("one");
    assert.deepEqual(await service.update("one", { label: "X" }), true);
    assert.deepEqual(await service.update("nope", { label: "X" }), false);
    assert.ok(seen.some(([what, id]) => what === "invalidate" && id === "one"));

    // `propose` rides the same registry the Host mirrors.
    const { listMcpProposals } = await import("../lib/host/proposals.js");
    const withdraw = service.propose({ id: "svc-offer", title: "T", entry: { id: "svc", kind: "stdio" } });
    assert.equal(listMcpProposals().some((offer) => offer.id === "svc-offer"), true);
    withdraw();
    assert.equal(listMcpProposals().some((offer) => offer.id === "svc-offer"), false);
});
