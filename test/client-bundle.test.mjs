/**
 * The emitted Web bundle, against the loader contract.
 *
 * A browser bundle is only worth shipping if it arrives as one script that
 * registers under this package's id, declares the services the shell must have
 * ready, and — applied against stand-ins for those services — registers the
 * row's configuration slot under exactly `<package>#<entryId>`. Everything the
 * GUI would supply is stood in for structurally; nothing here is DOM.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUNDLE = fileURLToPath(new URL("../lib/client.js", import.meta.url));
const SOURCE = readFileSync(BUNDLE, "utf8");

/** Evaluate one bundle's source, with nothing served behind it. Re-evaluated by
 * every harness, so a cached copy can never hide what it registers. */
function evaluate() {
    new Function("require", "module", "exports", SOURCE)(() => undefined, { exports: {} }, {});
}

/** What the shell serves before any bundle runs. */
const SHELL_MODULES = {
    react: () => ({
        useState: (initial) => [initial, () => void 0],
        useCallback: (callback) => callback,
        useEffect: () => void 0,
        useMemo: (factory) => factory(),
        createElement: (type, props, ...children) => ({ type, props, children })
    }),
    "react/jsx-runtime": () => ({
        jsx: (type, props) => ({ type, props, children: props?.children }),
        jsxs: (type, props) => ({ type, props, children: props?.children }),
        Fragment: "Fragment"
    }),
    "react-dom/client": () => ({ createRoot: () => ({ render: () => void 0 }) }),
    "@deepseek-ai/dsh-client-ui-primitives": () => ({
        Button: (props) => props, Input: (props) => props, Select: (props) => props, Textarea: (props) => props
    }),
    "@deepseek-ai/dsh-client-store": () => ({
        createSnapshotStore: (initial) => {
            let current = initial;
            const listeners = new Set();
            return {
                getSnapshot: () => current,
                set: (next) => { current = next; for (const notify of listeners) notify(); },
                subscribe: (notify) => { listeners.add(notify); return () => listeners.delete(notify); }
            };
        }
    })
};

/** Stand the shell's world up and run one bundle against it. */
function harness(value = { servers: [], live: [], kinds: [] }) {
    const table = new Map(Object.entries(SHELL_MODULES));
    const registered = [];
    const locales = [];
    /** Every `style` element the apply reached for — what pins one sheet per id. */
    const sheets = [];

    globalThis.window = globalThis;
    globalThis.document = {
        /** One `<style>` per sheet id stands in for the page's head. */
        styleTags: sheets,
        querySelector: (selector) => {
            const wanted = /^style\[data-plugin-css="(.+)"\]$/.exec(selector);
            if (wanted === null) return null;
            return sheets.find((tag) => tag.dataset.pluginCss === wanted[1]) ?? null;
        },
        /** The shared injector's lookup: a sheet is keyed by its **content**. */
        querySelectorAll: (selector) => {
            const wanted = /^style\[data-dsh-ancesters-css="(.+)"\]$/.exec(selector);
            if (wanted === null) return [];
            return sheets.filter((tag) => tag.dataset.dshAncestersCss === wanted[1]);
        },
        createElement: () => ({ dataset: {}, textContent: "", appendChild: () => void 0 }),
        head: {
            appendChild: (tag) => {
                sheets.push(tag);
            }
        }
    };
    globalThis.__ModuleLoader__ = {
        load: ({ id, factory }) => table.set(id, factory),
        resolve: (id) => {
            if (!table.has(id)) throw new Error(`the shell never served module "${id}"`);
            return table.get(id)((dependency) => globalThis.__ModuleLoader__.resolve(dependency));
        }
    };

    evaluate();
    const mod = globalThis.__ModuleLoader__.resolve("@comecaramelos/dsh-mcp-manager");

    const ctx = {
        effect: (setup) => { setup(); },
        locale: {
            register: (namespace, dictionaries) => locales.push({ namespace, dictionaries }),
            /** Real copy, not an echo: a card that renders keys instead of the
             * dictionary's strings fails here instead of passing. */
            bind: (namespace) => (key) => {
                const registered = locales.find((entry) => entry.namespace === namespace);
                return registered?.dictionaries?.en?.[key] ?? key;
            }
        },
        configForms: {
            get: () => ({
                getSnapshot: () => ({ status: "ready", value, revision: 1, writable: true, mode: "host" }),
                subscribe: () => () => void 0,
                mutate: async () => true
            })
        },
        slots: {
            inject: (_slot, register) => register(),
            register: (spec, Body) => registered.push({ spec, Body })
        }
    };

    return { table, mod, ctx, locales, registered, sheets };
}

/** Every node a rendered tree holds, flattened. */
function walk(node, into = []) {
    if (node === null || node === void 0) return into;
    if (typeof node !== "object") return into;
    if (Array.isArray(node)) {
        for (const item of node) walk(item, into);
        return into;
    }
    into.push(node);
    if (Array.isArray(node.children)) for (const child of node.children) walk(child, into);
    else if (node.props?.children !== void 0) walk(node.props.children, into);
    return into;
}

test("the bundle arrives as one script registered under the package id", () => {
    const { table } = harness();
    assert.ok(table.has("@comecaramelos/dsh-mcp-manager"));
});

test("applying registers the locale namespace and this row's config slot", () => {
    const { mod, ctx, locales, registered } = harness();
    assert.deepEqual([...mod.inject].sort(), ["configForms", "locale", "remote", "remote.settings", "slots"]);

    mod.apply(ctx);

    assert.deepEqual(locales.map((entry) => entry.namespace), ["mcpManager"]);
    // Two slots: the row's configuration page, and the composer pill (R6),
    // whose bind answers nothing until an enabled entry carries a composer
    // field — standing empty is drawing nothing in the input row.
    assert.equal(registered.length, 2);
    const config = registered.find((entry) => entry.spec.name === "plugins.bundle.config");
    const composer = registered.find((entry) => entry.spec.name === "conversation.input.left");
    assert.ok(config !== undefined && composer !== undefined);
    // The bundle's own page, keyed by the **bundle** the person installs: the
    // Plugins list opens it directly, with no step into the component row.
    assert.equal(config.spec.key, "@comecaramelos/dsh-mcp-manager-bundle");
});

/** The locale ids the browser client actually declares — every other id is
 * unreachable through the shell's fallback chain, which closes on `en`. */
const DECLARED_LOCALE_IDS = ["zh", "en"];

test("every dictionary this card owns is registered under an id the shell declares", () => {
    const { mod, ctx, locales } = harness();
    mod.apply(ctx);

    // The merge carries the shared `dshAncesters` dictionaries in too, and what
    // a shared key contributes is not this bundle's business. What is, is the
    // dictionary this bundle registers on its own: a key the shell never
    // declares is a key that comes back as a key, and the whole card would
    // echo — exactly what the GUI showed while the copy lived under `en-US`.
    const own = locales[0].dictionaries;
    const declared = Object.keys(own).filter((id) => DECLARED_LOCALE_IDS.includes(id));
    assert.deepEqual(declared, ["en"]);
    assert.equal(own.en.addConnection, "Add connection");
});

test("the bundle puts its own stylesheet on the page, once", () => {
    const { mod, ctx, sheets } = harness();
    mod.apply(ctx);
    mod.apply(ctx);

    // The shared sheet arrives first (the shared blocks' class names mean what it
    // says), then this card's own. Idempotency is keyed by **content**, not by
    // the plugin id: two applies leave exactly one copy of each.
    assert.equal(new Set(sheets.map((tag) => String(tag.dataset.dshAncestersCss ?? ""))).size, sheets.length);
    assert.ok(sheets.length >= 2, "the shared sheet plus this card's own");
    const ours = sheets.filter((tag) => /_identity\b/u.test(String(tag.textContent ?? "")));
    assert.equal(ours.length, 1);
    // Scoped rules must be the ones the render actually names.
    assert.match(ours[0].textContent, /_card\b/u);
});

test("a row that answers nothing renders the empty state and the add control", () => {
    const { mod, ctx, registered } = harness();
    mod.apply(ctx);

    registered[0].Body({ view: "summary" });
    const text = JSON.stringify(walk(registered[0].Body({ view: "page" })));

    // The stubbed locale resolves the real dictionary, so a card that renders
    // keys instead of copy fails here — the bug `card/summary` fixed.
    assert.match(text, /No MCP connections yet/u);
    assert.match(text, /Add connection/u);
    assert.doesNotMatch(text, /noConnections/u);
});

test("the collapsed row answers from the live mirror, not from what was typed", () => {
    const nothing = harness();
    nothing.mod.apply(nothing.ctx);
    let text = JSON.stringify(walk(nothing.registered[0].Body({ view: "summary" })));
    assert.match(text, /no MCP connections/u);
    assert.doesNotMatch(text, /summaryNone/u);

    const half = harness({
        servers: [
            { id: "one", kind: "stdio", enabled: true, command: "x", args: [] },
            { id: "two", kind: "stdio", enabled: true, command: "y", args: [] }
        ],
        live: [{ id: "one", state: "connected", error: "", tools: [], note: "" }, { id: "two", state: "off", error: "", tools: [], note: "" }],
        kinds: []
    });
    half.mod.apply(half.ctx);
    text = JSON.stringify(walk(half.registered[0].Body({ view: "summary" })));
    assert.match(text, /"data-total":"2"/u);
    assert.match(text, /"data-live":"1"/u);
    assert.match(text, /some MCP connections are not running/u);
    assert.doesNotMatch(text, /summaryPartial/u);
});

test("a row that answers renders what it answers", () => {
    const { mod, ctx, registered } = harness({
        servers: [{ id: "fs", kind: "stdio", enabled: true, command: "npx", args: ["-y", "s", "/tmp"] }],
        live: [{ id: "fs", state: "connected", error: "", tools: ["mcp__fs__read_file"], note: "" }],
        kinds: [{ id: "stdio", label: "Local command (stdio)", transport: "stdio", fields: [] }]
    });
    mod.apply(ctx);

    const text = JSON.stringify(walk(registered[0].Body({ view: "page" })));
    assert.match(text, /"data-id":"fs"/u);
    assert.match(text, /Start this connection|Stop this connection/u);
    assert.doesNotMatch(text, /noConnections/u);
});
