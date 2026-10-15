/**
 * The two packages the manager reads, and the one rule that says why they are
 * two.
 *
 * The plugin manager lists what a bundle is off its own package manifest and
 * what it *contributes* off the rows its patch inserts — it reads the rows'
 * `name`s and drops the ones it cannot find (dsh-plugin-manager's
 * `bundleComponentManifests`). So a bundle whose patch inserts a row named after
 * its own package is listed twice inside its own page: once as the entry, once
 * as the component that answers the same switch. The official
 * `@deepseek-ai/dsh-experimental-voice-input-bundle` never repeats because the
 * rows it inserts are other packages. This is what the split keeps that way, so
 * the two manifests are checked against each other here.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = new URL("../", import.meta.url);
const pluginManifest = JSON.parse(readFileSync(new URL("package.json", PLUGIN_ROOT), "utf8"));
const bundleDir = new URL("bundle/", PLUGIN_ROOT);
const bundleManifest = JSON.parse(readFileSync(new URL("package.json", bundleDir), "utf8"));

/** The plugin package's npm id — the host half is what answers it. */
const PLUGIN_ID = pluginManifest.name;
const BUNDLE_ID = bundleManifest.name;

/**
 * The chrome package rides as a component of this bundle's page — its row is
 * inserted here, not by a bundle layer of chrome's own (plan Fase 6).
 */
const CHROME_ID = "@comecaramelos/dsh-chrome-mcp";

/** The docker package rides the same way, registering its kind over `mcpConnections`. */
const DOCKER_ID = "@comecaramelos/dsh-docker-desktop-mcp";

/**
 * The rows a patch declares, read off its `insert:` block. Only the two keys the
 * manager and the loader care about are picked up; a patch this side of the
 * bundle layer never nests a group.
 */
function insertedRows(patchPath) {
    const text = readFileSync(patchPath, "utf8");
    const rows = [];
    let id;
    for (const line of text.split(/\r?\n/)) {
        const asId = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
        if (asId !== null) {
            id = asId[1];
            continue;
        }
        const asName = line.match(/^\s*name:\s*'?([^']+)'?\s*$/);
        if (asName !== null && id !== void 0) {
            rows.push({ id, name: asName[1] });
            id = void 0;
        }
    }
    return rows;
}

test("the plugin is a plugin: it declares no bundle of its own", () => {
    assert.equal(pluginManifest.dsh?.bundle, void 0, "a package that both runs the row and names it repeats itself as a component");
    assert.equal(existsSync(new URL("cordis.patch.yml", PLUGIN_ROOT)), false, "the patch that declares the row belongs to the bundle, not to the plugin that is inserted");
});

test("the bundle declares the patch and is nothing but the patch", () => {
    assert.equal(bundleManifest.dsh?.bundle?.patch, "./cordis.patch.yml");
    assert.equal(existsSync(fileURLToPath(new URL("cordis.patch.yml", bundleDir))), true);
    assert.equal(bundleManifest.dependencies[PLUGIN_ID], `^${pluginManifest.version}`,
        "a published bundle has to answer its plugin's version — installing the bundle is what installs the plugin");
    assert.equal(bundleManifest.version, pluginManifest.version, "the two packages are published together");
});

test("the rows the bundle contributes are its plugins, and never the bundle", () => {
    const rows = insertedRows(fileURLToPath(new URL("cordis.patch.yml", bundleDir)));
    assert.ok(rows.length > 0, "an empty patch leaves the bundle with nothing to run");
    assert.deepEqual(rows.map((row) => row.name), [PLUGIN_ID, CHROME_ID, DOCKER_ID]);
    assert.equal(rows[0].id, "mcp-manager", "the row id is the key the configuration form reads by (host/constants.js)");
    assert.equal(rows[1].id, "mcp-chrome", "the chrome component keeps the row id it shipped with");
    assert.equal(rows[2].id, "mcp-docker", "the docker component keeps the row id it shipped with");
    assert.equal(rows.some((row) => row.name === BUNDLE_ID), false, "a row named after the bundle is the entry repeated as a component");
});

test("the bundle answers its display copy, because its id alone is noise", () => {
    for (const language of ["en", "zh"]) {
        const dictionary = JSON.parse(readFileSync(fileURLToPath(new URL(`locale/${language}.json`, bundleDir)), "utf8"));
        assert.equal(typeof dictionary.meta?.title, "string");
        assert.ok(dictionary.meta.title.length > 0);
        assert.equal(typeof dictionary.meta?.description, "string");
        assert.ok(dictionary.meta.description.length > 0);
    }
});

test("every package the patch inserts is a dependency of the bundle", () => {
    // Installing the bundle is what installs its components: a row whose
    // package the bundle does not depend on is a row that never loads.
    const rows = insertedRows(fileURLToPath(new URL("cordis.patch.yml", bundleDir)));
    for (const row of rows) {
        assert.equal(typeof bundleManifest.dependencies[row.name], "string", `${row.name} (row ${row.id}) must be a dependency of ${BUNDLE_ID}`);
    }
});
