/**
 * The controller's own answers — the two rules the pool cannot derive.
 *
 * Everything the diff used to do here (start, switch in place, stop, keep a
 * failed answer on its own line) is now
 * `@comecaramelos/dsh-ancesters`'s `test/pool.test.mjs`. What this checkout
 * still owes a proof is its own half: what a `kind` that resolves to nothing
 * answers, and what a namespace claimed twice answers.
 *
 * The same fake fiber stands in for the loader child, so a first connect can
 * be settled by hand when the answer is supposed to have landed.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createManagerController } from "../lib/host/controller/index.js";

/** Stand a fake host context up over a list of entries. */
function fakeContext(rows) {
    const started = [];
    const logs = [];
    const ctx = {
        logger: {
            info: (line) => logs.push(["info", String(line)]),
            warn: (line) => logs.push(["warn", String(line)]),
            error: (line) => logs.push(["error", String(line)])
        },
        get: () => ({ schemas: () => [] }),
        plugin(_client, config) {
            let answer = () => void 0;
            let refuse = () => void 0;
            const first = new Promise((resolve, reject) => {
                answer = resolve;
                refuse = reject;
            });
            const record = { config, updates: [], disposed: 0, settle: answer, fail: refuse };
            started.push(record);
            return {
                update: (next) => {
                    record.updates.push(next);
                    return Promise.resolve();
                },
                dispose: () => {
                    record.disposed++;
                    return Promise.resolve();
                },
                then: (onResolve, onReject) => first.then(onResolve, onReject)
            };
        }
    };
    const controller = createManagerController(ctx);
    controller.state.config = { servers: rows };
    return { controller, started, logs };
}

/** One stdio entry with nothing else set. */
function stdio(id, extra = {}) {
    return { id, kind: "stdio", enabled: true, command: "server", args: [], env: {}, ...extra };
}

function settle(started) {
    for (const record of started) record.settle();
}

async function idle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test("an unregistered kind answers a reason and keeps the rest live", async () => {
    const rows = [stdio("good"), stdio("bad", { kind: "no-such-kind" })];
    const { controller, logs, started } = fakeContext(rows);
    controller.refresh();
    settle(started);
    await idle();

    const lines = controller.live();
    assert.equal(lines.find((line) => line.id === "good").state, "connected");
    assert.equal(lines.find((line) => line.id === "bad").state, "failed");
    assert.match(lines.find((line) => line.id === "bad").error, /not registered/u);
    assert.ok(logs.some(([level]) => level === "warn"));

    controller.dispose();
});

/**
 * One namespace claimed twice — what the manager layer still owes.
 *
 * The pool owns the conflict answer itself (`../dsh-ancesters/test/pool.test.mjs`
 * proves it: the live claimant keeps its fiber and its line, and a claim with no
 * live fiber behind it answers `conflict`). What is owed here is that a duplicate
 * in the row is the second entry's problem: one line for the namespace, not two,
 * and the fiber that already stands is never taken down for it.
 */
test("one namespace claimed twice leaves one line and keeps the claimant live", async () => {
    const { controller, started, logs } = fakeContext([stdio("same"), stdio("same")]);
    controller.refresh();
    await idle();

    const lines = controller.live().filter((line) => line.id === "same");
    assert.equal(lines.length, 1, "one line for the namespace, not one per entry");
    assert.equal(started.length, 1, "the duplicate stands up no second fiber");
    assert.equal(lines[0].state === "failed", false, "a duplicate is never a reason to go dark");
    assert.ok(
        logs.some(([level, line]) => level === "warn" && /already claimed/u.test(String(line))),
        "the duplicate answers the person, not only the log's silence"
    );

    controller.dispose();
});

test("an id that is not a legal namespace answers before anything else", async () => {
    const { controller, started } = fakeContext([stdio("nope!!"), stdio("fine")]);
    controller.refresh();
    settle(started);
    await idle();

    const bad = controller.live().find((line) => line.id === "nope!!");
    assert.equal(bad.state, "failed");
    assert.match(bad.error, /invalid id/u);
    assert.equal(controller.live().find((line) => line.id === "fine").state, "connected");

    controller.dispose();
});

test("the live mirror is stood up on the first publish", async () => {
    const { controller } = fakeContext([stdio("one")]);
    controller.refresh();
    await idle();

    assert.equal(controller.state.mirror === void 0, false, "publishing is what stands up the mirror");
    assert.ok(Array.isArray(controller.live()));

    controller.dispose();
});

test("a kinds change republishes the mirror while the controller lives, and never after", async () => {
    const { notifyMcpKindsChanged } = await import("../lib/host/kinds/index.js");
    const { controller } = fakeContext([stdio("one")]);
    notifyMcpKindsChanged();
    assert.equal(controller.state.mirror, void 0, "before the first publish there is nothing to move");
    controller.refresh();
    await idle();
    let published = 0;
    const original = controller.state.mirror.publish;
    controller.state.mirror.publish = () => {
        published++;
        return original();
    };
    notifyMcpKindsChanged();
    assert.equal(published, 1);
    controller.dispose();
    const afterDispose = published;
    notifyMcpKindsChanged();
    assert.equal(published, afterDispose, "a disposed controller stops listening");
});

/**
 * Phase 3, item 4 — a namespace live **outside** the list.
 *
 * A bare `dsh-mcp-client` row the person still has, or a component bridge from
 * before this release, already registers `mcp__<id>__*` tools. The second claim
 * would connect nothing: the manager answers `conflict` with the reason rather
 * than letting `dsh-mcp-client` refuse the start as an opaque connect error.
 * The entry standing behind its own live connection is not a conflict — its
 * own tools are the registry's answer for itself.
 */
test("a namespace already registered outside the list answers conflict, not a start", async () => {
    const rows = [stdio("dup")];
    const { controller } = fakeContext(rows);
    controller.state.config = { servers: rows };
    controller.ctx.get = () => ({ schemas: () => [{ name: "mcp__dup__tool" }] });
    controller.refresh();
    await idle();

    const line = controller.live().find((entry) => entry.id === "dup");
    assert.equal(line.state, "conflict");
    assert.match(line.error, /outside this list/u);

    controller.dispose();
});

/**
 * Phase 3, item 8 — a kind's cap. The extras answer `conflict` and start
 * nothing; the entries that were standing first keep their fibers untouched.
 */
test("a kind at its cap answers the extra entries conflict and starts nothing for them", async () => {
    const { registerMcpKind } = await import("../lib/host/kinds/index.js");
    const dispose = registerMcpKind({
        id: "capped",
        label: "Capped",
        transport: "none",
        maxEntries: 1,
        resolve: (entry) => ({ config: { serverName: entry.id, transport: "stdio", command: "server", args: [] } })
    });
    const rows = [stdio("one", { kind: "capped" }), stdio("two", { kind: "capped" })];
    const { controller, started } = fakeContext(rows);
    controller.refresh();
    settle(started);
    await idle();

    assert.equal(controller.live().find((line) => line.id === "one").state, "connected", "the first stands");
    const extra = controller.live().find((line) => line.id === "two");
    assert.equal(extra.state, "conflict");
    assert.match(extra.error, /at most 1 connection/u);
    assert.equal(started.length, 1, "the extra starts nothing");

    controller.dispose();
    dispose();
});

/**
 * Phase 3, item 6 — the proposals field. A standing offer disappears the
 * moment an entry of its kind exists, so *Create connection* going in lands the
 * notice gone with the write.
 */
test("a standing proposal reads until an entry of its kind exists, then goes away", async () => {
    const { proposeMcpConnection } = await import("../lib/host/proposals.js");
    const withdraw = proposeMcpConnection({
        id: "chrome",
        title: "Chrome Desktop",
        entry: { id: "chrome", kind: "chrome-desktop" }
    });
    const { controller } = fakeContext([]);
    controller.refresh();
    await idle();

    let views = controller.proposals();
    assert.equal(views.length, 1);
    assert.equal(views[0].id, "chrome");
    assert.equal(views[0].entry.command, "", "the entry arrives normalized");

    controller.state.config = { servers: [stdio("chrome", { kind: "chrome-desktop" })] };
    views = controller.proposals();
    assert.equal(views.length, 0, "the offer is gone the moment an entry of that kind exists");

    controller.dispose();
    withdraw();
});

/** *Dismiss* runs the offer's own memory of the answer. */
test("dismissing a proposal runs its onDismiss and withdraws the offer", async () => {
    const { proposeMcpConnection, listMcpProposals } = await import("../lib/host/proposals.js");
    let dismissed = 0;
    const dispose = proposeMcpConnection({
        id: "docker",
        title: "Docker Desktop",
        entry: { id: "docker", kind: "docker-profile" },
        onDismiss: () => {
            dismissed++;
        }
    });
    const { controller } = fakeContext([]);
    controller.dismissProposal("docker");

    assert.equal(dismissed, 1);
    assert.equal(listMcpProposals().length, 0);

    controller.dispose();
    dispose();
});

/** Phase 3, item 3 — an asynchronous `resolve` reads `starting` meanwhile. */
test("a kind that prepares asynchronously keeps the entry starting until the answer lands", async () => {
    const { registerMcpKind } = await import("../lib/host/kinds/index.js");
    let settleResolve = () => void 0;
    const dispose = registerMcpKind({
        id: "dial",
        label: "Dial",
        transport: "http",
        resolve: (entry) =>
            new Promise((resolve) => {
                settleResolve = () => resolve({ config: { serverName: entry.id, transport: "streamable-http", url: "http://127.0.0.1:1/mcp" } });
            })
    });
    const { controller, started } = fakeContext([stdio("slow", { kind: "dial" })]);
    controller.refresh();

    const starting = controller.live().find((line) => line.id === "slow");
    assert.equal(starting.state, "starting", "preparing reads as starting, never failed");
    assert.equal(started.length, 0, "nothing stands up while the answer is still moving");

    // The answer landing is what stands the fiber up — settle the fiber that
    // was only born after it.
    settleResolve();
    await idle();
    settle(started);
    await idle();
    assert.equal(controller.live().find((line) => line.id === "slow").state, "connected");

    controller.dispose();
    dispose();
});

/** Phase 3, item 3 — kind actions: the run lands on the entry it names, and a
 * run that fails says so on that entry's note — the connection it belongs to
 * stays as live as it was. */
test("a kind action runs for the entry its trigger names, and its failure never takes the connection down", async () => {
    const { registerMcpKind } = await import("../lib/host/kinds/index.js");
    const runs = [];
    const dispose = registerMcpKind({
        id: "fetching",
        label: "Fetching",
        transport: "none",
        actions: [
            {
                key: "fetch",
                label: "Fetch",
                run: (entry) => {
                    runs.push(entry.id);
                    if (entry.id === "bad") return { error: "the daemon refused" };
                    if (entry.id === "throws") throw new Error("no daemon at all");
                    return { note: "refreshed" };
                }
            }
        ],
        resolve: (entry) => ({ config: { serverName: entry.id, transport: "streamable-http", url: "http://127.0.0.1:1/mcp" } })
    });
    const { controller, started } = fakeContext([
        stdio("good", { kind: "fetching" }),
        stdio("bad", { kind: "fetching" }),
        stdio("throws", { kind: "fetching" })
    ]);
    controller.refresh();
    await idle();
    settle(started);
    await idle();

    controller.runAction("good/fetch");
    await idle();
    assert.deepEqual(runs, ["good"]);
    assert.equal(controller.line("good").note, "refreshed");

    controller.runAction("bad/fetch");
    controller.runAction("throws/fetch");
    await idle();
    assert.equal(controller.line("bad").state, "connected", "a failed action is not a failed connection");
    assert.match(controller.line("bad").note, /Fetch: the daemon refused/u);
    assert.equal(controller.line("throws").state, "connected");
    assert.match(controller.line("throws").note, /Fetch: no daemon at all/u);

    controller.runAction("good/nope");
    await idle();
    assert.equal(controller.line("good").state, "connected");
    assert.match(controller.line("good").note, /answers no action "nope"/u);

    controller.runAction("gone/fetch");
    await idle();
    assert.deepEqual(runs, ["good", "bad", "throws"], "a trigger for a row that is gone answers nothing");

    controller.dispose();
    dispose();
});

test("a dismissal that cannot be recorded still withdraws the offer, and says so", async () => {
    const { proposeMcpConnection, listMcpProposals } = await import("../lib/host/proposals.js");
    const thrown = proposeMcpConnection({
        id: "throws",
        title: "Throws",
        entry: { id: "a", kind: "k-throws" },
        onDismiss: () => {
            throw new Error("row is read-only");
        }
    });
    const rejected = proposeMcpConnection({
        id: "rejects",
        title: "Rejects",
        entry: { id: "b", kind: "k-rejects" },
        onDismiss: () => Promise.reject(new Error("write refused"))
    });
    const { controller, logs } = fakeContext([]);
    controller.dismissProposal("throws");
    controller.dismissProposal("rejects");
    await idle();
    assert.equal(listMcpProposals().some((proposal) => proposal.id === "throws" || proposal.id === "rejects"), false, "the person said no: the offer is gone");
    assert.ok(logs.some(([level, line]) => level === "warn" && /"throws" was dismissed but could not record it: row is read-only/u.test(line)));
    assert.ok(logs.some(([level, line]) => level === "warn" && /"rejects" was dismissed but could not record it: write refused/u.test(line)));
    controller.dispose();
    thrown();
    rejected();
});

test("a kind that registers after the first reconcile starts its entries, and one that leaves stops them", async () => {
    const { registerMcpKind } = await import("../lib/host/kinds/index.js");
    const { controller, started } = fakeContext([stdio("late", { kind: "late-kind" })]);
    controller.refresh();
    await idle();
    assert.match(controller.line("late").error, /not registered/u);

    const dispose = registerMcpKind({
        id: "late-kind",
        label: "Late",
        transport: "none",
        // Asynchronous on purpose: the prepared answer is what must not
        // outlive the kind that prepared it.
        resolve: async (entry) => ({ config: { serverName: entry.id, transport: "streamable-http", url: "http://127.0.0.1:1/mcp" } })
    });
    await idle();
    assert.equal(started.length, 1, "the late kind's entry starts without any row edit");
    settle(started);
    await idle();
    assert.equal(controller.line("late").state, "connected");

    dispose();
    await idle();
    assert.equal(started[0].disposed, 1, "its kind left: the connection stops");
    assert.match(controller.line("late").error, /not registered/u);
    controller.dispose();
});
