/**
 * Link this checkout into a profile (default: `plugin-dev`).
 *
 * Two packages ship from this checkout, and only one of them is a bundle:
 *
 *   * `@comecaramelos/dsh-mcp-manager-bundle` (./bundle) is what a person
 *     installs and what the plugin manager lists — the entry, with the row it
 *     contributes listed under it as a component;
 *   * `@comecaramelos/dsh-mcp-manager` (.) is the plugin that row runs. It is
 *     reached through the bundle's own dependency, so it is linked as a
 *     dependency and is deliberately NOT registered as a bundle: a source that
 *     is both the entry and the component is the same plugin shown twice (the
 *     shape the official bundles do not have, and `test/bundle.test.mjs` pins).
 *
 * The bundle also inserts the `mcp-chrome` and `mcp-docker` component rows, run
 * by `@comecaramelos/dsh-chrome-mcp` and `@comecaramelos/dsh-docker-desktop-mcp`.
 * Their sibling checkouts (`../dsh-chrome-mcp`, `../dsh-docker-desktop-mcp`) are
 * linked as dependencies too when they are there — otherwise the bundle's own
 * dependency on them would be fetched from the registry.
 *
 * So this script links the bundle source, links the plugin sources, and
 * registers only the bundle id. It is idempotent, and it never writes over a row
 * or a config: it only touches the dependencies and the bundles list.
 *
 *     node scripts/link-profile.mjs [profile-name]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE = process.argv[2] ?? "plugin-dev";
const PLUGIN = "@comecaramelos/dsh-mcp-manager";
const BUNDLE = "@comecaramelos/dsh-mcp-manager-bundle";
/** The component packages the bundle inserts rows for, by sibling checkout. */
const COMPONENTS = [
    ["@comecaramelos/dsh-chrome-mcp", "dsh-chrome-mcp"],
    ["@comecaramelos/dsh-docker-desktop-mcp", "dsh-docker-desktop-mcp"]
];

// `URL.pathname` would read `/C:/…` on Windows and drop the host of a
// `\\wsl.localhost\…` checkout; `fileURLToPath` answers both.
const root = fileURLToPath(new URL("..", import.meta.url));
const bundleDir = resolve(root, "bundle");
const home = process.env.DSH_HOME ?? resolve(homedir(), ".dsh");
const profileDir = resolve(home, "profiles", PROFILE);
const manifest = resolve(profileDir, "package.json");

if (!existsSync(manifest)) {
    console.error(`link-profile: no profile named "${PROFILE}" at ${manifest}`);
    process.exit(1);
}

const doc = JSON.parse(readFileSync(manifest, "utf8"));
doc.dsh ??= {};
doc.dsh.profile ??= {};
doc.dsh.profile.bundles ??= [];
doc.dependencies ??= {};

let changed = false;

/** Link one source, or report that a different one is already there. */
function link(name, target) {
    const current = doc.dependencies[name];
    if (current === void 0) {
        doc.dependencies[name] = `link:${target}`;
        changed = true;
        console.log(`link-profile: linked ${name} -> ${target}`);
        return;
    }
    if (current !== `link:${target}`) {
        console.error(`link-profile: ${name} is already installed as "${current}" — reconcile it by hand`);
        process.exit(1);
    }
    console.log(`link-profile: already linked (${name})`);
}

link(PLUGIN, root);
link(BUNDLE, bundleDir);
for (const [name, dir] of COMPONENTS) {
    const target = resolve(root, "..", dir);
    if (existsSync(resolve(target, "package.json"))) link(name, target);
    else console.log(`link-profile: no checkout at ${target} — ${name} comes from the bundle's dependency`);
}

// Only the bundle registers: the plugin source carries no patch, and dsh says so
// at startup ("declares no dsh.bundle in its package.json") for every id here
// that is not a bundle.
const before = doc.dsh.profile.bundles.length;
doc.dsh.profile.bundles = doc.dsh.profile.bundles.filter((id) => id !== PLUGIN);
if (!doc.dsh.profile.bundles.includes(BUNDLE)) {
    doc.dsh.profile.bundles.push(BUNDLE);
}
if (doc.dsh.profile.bundles.length !== before || !doc.dsh.profile.bundles.includes(BUNDLE)) {
    changed = true;
    console.log(`link-profile: bundles -> ${doc.dsh.profile.bundles.join(", ")}`);
}

if (changed) {
    writeFileSync(manifest, `${JSON.stringify(doc, null, 2)}\n`);
}

// The bundle source is what `dsh plugin` activates; the plugin source arrives as
// its dependency.
try {
    // On Windows `dsh` is a `dsh.cmd` shim, which only a shell can run.
    execFileSync("dsh", ["plugin", "--profile", PROFILE, "add", `link:${bundleDir}`], {
        stdio: "inherit",
        shell: process.platform === "win32"
    });
} catch (error) {
    console.error(`link-profile: dsh plugin failed — ${String(error)}`);
    process.exit(1);
}

console.log(`link-profile: ${BUNDLE} active in profile "${PROFILE}"`);
