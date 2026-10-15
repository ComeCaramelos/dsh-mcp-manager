/**
 * Browser half — the view model, and the two identities it must agree on.
 *
 * The browser bundle is emitted on its own, so the row id and the budget it
 * renders from cannot import the host half's constants; they are mirrored, and
 * this test is what makes a drift loud rather than a card that reads the wrong
 * row. The pure view model is checked alongside it, because it is what decides
 * what the editor shows for a kind that only a companion package registered.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ENTRY_ID, MAX_SERVERS, PLUGIN_ID, BUNDLE_ID } from "../lib/host/constants.js";
import { blankEntry, composerDeclarations, describeState, entryLabel, kindsOf, kindActionsOf, kindIds, kindChoices, kindLabel, kindFieldsOf, normalizeList, proposalsOf, transportsFor } from "../lib/client/catalog.js";

test("the mirrored identities are the host half's own values", () => {
    const meta = {
        ENTRY_ID: "mcp-manager",
        PLUGIN_ID: "@comecaramelos/dsh-mcp-manager",
        BUNDLE_ID: "@comecaramelos/dsh-mcp-manager-bundle",
        MAX_SERVERS: 64
    };
    assert.equal(ENTRY_ID, meta.ENTRY_ID);
    assert.equal(PLUGIN_ID, meta.PLUGIN_ID);
    assert.equal(BUNDLE_ID, meta.BUNDLE_ID);
    assert.equal(MAX_SERVERS, meta.MAX_SERVERS);
});

test("the row key is answered by the bundle the person installs, not the row's own package", async () => {
    const meta = await import("../lib/client/plugin-meta.js");
    assert.equal(meta.ENTRY_ID, ENTRY_ID);
    assert.equal(meta.PLUGIN_ID, PLUGIN_ID);
    assert.equal(meta.BUNDLE_ID, BUNDLE_ID);
    assert.equal(meta.ROW_CONFIG_KEY, `${BUNDLE_ID}#${ENTRY_ID}`);
});

test("kinds come from the Host, and fall back to the two built-ins", () => {
    assert.deepEqual(kindIds(void 0), ["stdio", "http"]);
    assert.equal(kindLabel("stdio", void 0), "Local command (stdio)");
    const answered = [
        { id: "stdio", label: "Local command (stdio)", transport: "stdio", fields: [] },
        { id: "chrome-windows", label: "Windows Chrome", transport: "http", fields: [{ key: "debugPort", label: "Debugging port" }] }
    ];
    assert.deepEqual(kindIds(answered), ["stdio", "chrome-windows"]);
    assert.equal(transportsFor("chrome-windows", answered), "http");
});

test("an unknown kind reads as none, not stdio", () => {
    assert.equal(transportsFor("mystery", [{ id: "mystery", label: "Mystery", transport: "none" }]), "none");
    assert.equal(transportsFor("mystery"), "none");
});

test("extra fields come off the answered kind", () => {
    const answered = [{ id: "docker-profile", transport: "none", fields: [{ key: "profile", label: "Profile", type: "string" }] }];
    assert.equal(kindFieldsOf("docker-profile", answered).length, 1);
    assert.equal(kindFieldsOf(void 0, answered).length, 0);
    const served = [{ id: "docker-profile", transport: "none", fields: [{ key: "profile", label: "Profile", type: "select", options: [{ value: "default", label: "Default" }] }] }];
    assert.deepEqual(kindFieldsOf("docker-profile", served)[0].options, [{ value: "default", label: "Default" }], "a select's served choices reach the editor untouched");
});

test("state lines describe what the card draws", () => {
    assert.equal(describeState("connected", "").dot, "ok");
    assert.equal(describeState("failed", "ENOENT: no such file").text, "ENOENT: no such file");
    assert.equal(describeState("off", "").target, "off");
    assert.equal(describeState("starting", "").target, "starting");
    // The model answers the **key**, never the copy: resolving copy is `t`'s
    // job, which is what keeps a string out of the component (`AGENTS.md`).
    assert.equal(describeState("connected", "").text, "stateConnected");
    assert.equal(describeState("starting", "", (key) => `«${key}»`).text, "«stateConnecting»");
});

test("a new entry starts blank rather than invented", () => {
    const entry = blankEntry((key) => key);
    assert.equal(entry.id, "");
    assert.equal(entry.enabled, false);
    assert.equal(entry.kind, "stdio");
    assert.equal(entry.stderrMode, "console");
});

test("a list normalizes without touching the row's own objects", () => {
    const rows = [{ id: "one", command: "x" }];
    const list = normalizeList(rows);
    list[0].command = "changed";
    assert.equal(rows[0].command, "x");
    assert.deepEqual(normalizeList("nope"), []);
});

test("labels fall back to the id when nothing is set", () => {
    assert.equal(entryLabel({ id: "one", label: "" }), "one");
    assert.equal(entryLabel({ id: "one", label: "GitHub" }), "GitHub · one");
});

/**
 * Phase 3, item 9 — the editor shows the fields and the buttons of the kind the
 * entry *is*, and the picker stops offering a kind that stands at its cap.
 */
test("fields and actions come only from the entry's own kind", () => {
    const answered = [
        {
            id: "stdio",
            label: "Stdio",
            transport: "stdio",
            fields: [],
            actions: []
        },
        {
            id: "docker-profile",
            label: "Docker Desktop",
            transport: "none",
            fields: [{ key: "profile", label: "Profile", type: "select" }],
            actions: [{ key: "fetch", label: "Fetch", help: "Ask the Toolkit again" }]
        }
    ];
    assert.deepEqual(kindActionsOf("docker-profile", answered).map((a) => a.key), ["fetch"]);
    assert.deepEqual(kindActionsOf("stdio", answered), [], "another kind's buttons never ride along");
    assert.deepEqual(kindActionsOf(void 0, answered), []);
    assert.equal(kindFieldsOf("stdio", answered).length, 0);
    assert.equal(kindFieldsOf("docker-profile", answered).length, 1);
});

test("a kind at its cap leaves the picker, except for the entry that already is it", () => {
    const answered = [
        { id: "stdio", label: "S", transport: "stdio" },
        { id: "docker-profile", label: "D", transport: "none", maxEntries: 1 }
    ];
    const rows = [{ id: "d1", kind: "docker-profile", enabled: true }];
    assert.deepEqual(kindChoices(answered, rows), ["stdio"]);
    assert.deepEqual(kindChoices(answered, rows, "docker-profile"), ["stdio", "docker-profile"], "the saved kind is never dropped under the editor's feet");
    assert.deepEqual(kindChoices(answered, []), ["stdio", "docker-profile"]);
});

/**
 * Phase 3, item 6 — what the card renders off a proposal: an entry with no id
 * or no kind is not offered (creating it would only refuse it back).
 */
test("proposals normalize away what creating could not accept", () => {
    const offered = [
        { id: "chrome", title: "Chrome Desktop", entry: { id: "chrome", kind: "chrome-desktop", enabled: true } },
        { id: "", entry: { id: "no", kind: "http" } },
        { id: "broken", entry: { kind: "http" } },
        { id: "kindless", entry: { id: "kindless" } },
        { id: "gone" }
    ];
    const out = proposalsOf(offered);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "chrome");
    assert.equal(proposalsOf(void 0).length, 0);
    assert.equal(proposalsOf("nope").length, 0);
});

/**
 * Phase 3, item 7 — what the composer hole draws: one pill per *enabled* entry
 * whose kind marks a field for it, standing the current pick and leaving every
 * other entry alone when a pick lands.
 */
test("composer pills stand only for enabled entries, and a pick rewrites just that entry", async () => {
    const kinds = [
        {
            id: "docker-profile",
            label: "Docker Desktop",
            transport: "none",
            icon: ["M1 12h11", "M6 8h7"],
            fields: [{
                key: "profile",
                label: "Profile",
                type: "select",
                composer: true,
                options: [{ value: "default", label: "Default" }, { value: "dev", label: "Dev" }]
            }]
        },
        { id: "stdio", label: "Stdio", transport: "stdio", fields: [{ key: "command", label: "Command" }] }
    ];
    const entries = [
        { id: "d1", kind: "docker-profile", enabled: true, extra: { profile: "dev" } },
        { id: "d2", kind: "docker-profile", enabled: false, extra: { profile: "stale" } },
        { id: "s1", kind: "stdio", enabled: true, extra: {} }
    ];
    let written;
    const pills = composerDeclarations(entries, kinds, async (next) => {
        written = next;
        return true;
    });
    assert.equal(pills.length, 1, "one per enabled entry carrying a composer field — and only the kinds that mark one");
    assert.equal(pills[0].key, "d1/profile");
    assert.equal(pills[0].selectedId, "dev");
    assert.deepEqual(pills[0].options.map((o) => o.id), ["default", "dev"]);

    await pills[0].onSelect("default");
    assert.equal(written[1].extra.profile, "stale", "the disabled entry keeps what it had");
    assert.equal(written[0].extra.profile, "default");

    // A stored pick the choices stopped carrying stays selectable.
    const stray = [{ id: "d1", kind: "docker-profile", enabled: true, extra: { profile: "ghost" } }];
    const [strayPill] = composerDeclarations(stray, kinds, async () => true);
    assert.equal(strayPill.selectedId, "ghost");
    assert.ok(strayPill.options.some((option) => option.id === "ghost"), "a selection never silently becomes another one");
});

test("a kind's lines field round-trips through extra as one item per line", async () => {
    const { extraFieldChecked, extraFieldLines, extraFieldText, extraFieldType, transportLabel } = await import("../lib/client/catalog.js");
    assert.equal(extraFieldType("lines"), "lines");
    assert.equal(extraFieldChecked("false", "true"), false, "what is stored wins over the declared default");
    assert.equal(extraFieldChecked("", "true"), true, "unset reads as the kind's declared default");
    assert.equal(extraFieldChecked("log", "true"), true, "a value from before the toggle reads as the default too");
    assert.equal(extraFieldChecked(undefined, undefined), false, "no default reads off");
    assert.deepEqual(extraFieldLines("--a\n\n --b=x y\n"), ["--a", " --b=x y"], "one row per item, blank lines dropped, spaces kept");
    assert.deepEqual(extraFieldLines(undefined), []);
    assert.equal(extraFieldType("secret"), "secret");
    assert.equal(extraFieldType("weird"), "string");
    assert.equal(extraFieldText("lines", ["--a", "--b=x,y"]), "--a\n--b=x,y", "never joined with commas");
    assert.equal(extraFieldText("boolean", true), "true");
    assert.equal(transportLabel("docker-profile", [{ id: "docker-profile", label: "Docker MCP Toolkit", transport: "none" }]), "Docker MCP Toolkit");
});
