/**
 * Build the browser half with esbuild.
 *
 * The shell's client manifest fetches exactly ONE script per bundle
 * (`/plugins/<id>/client.js`), loaded as a plain `<script>` — no import graph,
 * no `type="module"`, nothing behind a second URL. So the browser half can be
 * ordinary modules at source level but must collapse into one CJS-shaped
 * factory body at emit time, requiring only the ids the shell seeds into its
 * module table.
 *
 * Two steps, mirroring the host half's separation of check and emit:
 *
 *   1. `tsc -p tsconfig.client.json` typechecks the browser modules (no emit) —
 *      their imports resolve against the structural views in
 *      `src/client/shell-modules.d.ts` and the ambient CSS-modules shape;
 *   2. this script runs esbuild over `src/client/index.ts`: bundle, CJS output,
 *      `platform: "neutral"`, the baseline ids kept external, an external source
 *      map, and CSS Modules for every `*.module.css` the card imports.
 *
 * The bundle's shape is the loader's contract:
 * `window.__ModuleLoader__.load({ id, factory: (require) => … })`, supplied
 * through esbuild's `banner`/`footer`.
 */
import { build } from "esbuild";
import postcss from "postcss";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ROOT = new URL("../", import.meta.url);
const ROOT_FS = fileURLToPath(ROOT);
const pkg = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));

/**
 * Modules the shell seeds into `window.__ModuleLoader__` before this bundle
 * runs. Keep external: bundling them would duplicate the shell's own copies
 * (two Reacts) or resolve ids that exist only inside the running GUI.
 */
const BASELINE_MODULES = [
    "react",
    "react/jsx-runtime",
    "react-dom/client",
    "@deepseek-ai/dsh-client-store",
    "@deepseek-ai/dsh-client-ui-primitives"
];

/**
 * CSS Modules — each `<Component>.module.css` source compiles into one inlined
 * module: minified CSS text plus a class map keyed by the source's local class
 * names, every name scoped `<prefix>_<local>`. The validation step is postcss,
 * so invalid syntax fails `build:client` at the exact source line.
 */
const cssModules = {
    name: "dsh-css-modules",
    setup(api) {
        api.onResolve({ filter: /\.module\.css$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path),
            namespace: "dsh-css"
        }));
        api.onLoad({ filter: /.*/, namespace: "dsh-css" }, async (args) => {
            const source = await readFile(args.path, "utf8");
            try {
                postcss.parse(source, { from: args.path });
            } catch (failure) {
                const line = failure.line ?? 1;
                return {
                    errors: [{
                        text: failure.reason ?? String(failure),
                        location: {
                            file: args.path,
                            line,
                            column: failure.column ?? 1,
                            lineText: String(source.split(/\r?\n/)[line - 1] ?? "").trimEnd()
                        }
                    }]
                };
            }
            let minified;
            try {
                const result = await build({
                    stdin: {
                        contents: source,
                        sourcefile: basename(args.path),
                        loader: "css",
                        resolveDir: dirname(args.path)
                    },
                    bundle: true,
                    minify: true,
                    platform: "neutral",
                    logLevel: "silent",
                    write: false
                });
                minified = String(result.outputFiles[0].text);
            } catch (failure) {
                return { errors: failure.errors ?? [{ text: String(failure) }] };
            }
            const prefix = scopedName(relative(ROOT_FS, args.path).replace(/\\/g, "/"));
            const locals = [];
            const scoped = minified.replace(/\.([a-zA-Z_][\w-]*)/g, (_match, local) => {
                if (!locals.includes(local)) locals.push(local);
                return "." + prefix + "_" + local;
            });
            const styles = {};
            for (const local of locals) styles[local] = prefix + "_" + local;
            return {
                contents: [
                    "export const cssText = " + JSON.stringify(scoped) + ";",
                    "export default " + JSON.stringify(styles) + ";"
                ].join("\n"),
                loader: "js"
            };
        });
    }
};

/**
 * The stable 6-character scope of one stylesheet, derived from the
 * repo-relative source path so class names never drift with checkout location.
 */
function scopedName(sourcePath) {
    let hash = 0x811c9dc5 >>> 0;
    for (let index = 0; index < sourcePath.length; index++) {
        hash ^= sourcePath.charCodeAt(index);
        hash = Math.imul(hash, 0x011c9dc5 >>> 0);
    }
    return hash.toString(36).padStart(6, "0").slice(0, 6);
}

/**
 * Where the shared card machinery resolves to.
 *
 * `@comecaramelos/dsh-ancesters/client` answers through its *export map*, which
 * points at `lib/client.js` — that file is a loader registration, not a module
 * surface: esbuild would bundle it and find nothing to import. The shared half
 * is meant to be bundled **into** the consumer's own bundle, so the alias sends
 * the specifier to `./client/source`: the same surface emitted as plain ESM
 * (CSS Modules already compiled in), present in a published copy and in a
 * linked checkout alike. When it is missing the build fails here with the
 * reason stated rather than emitting a bundle whose card renders nothing.
 */
const ancestorsClient = resolveAncestorsClient();

function resolveAncestorsClient() {
    let entry;
    try {
        entry = require.resolve("@comecaramelos/dsh-ancesters/client/source");
    } catch (error) {
        throw new Error(`build-client: @comecaramelos/dsh-ancesters/client/source did not resolve (${String(error)}) — install or build dsh-ancesters first`);
    }
    if (!existsSync(entry)) {
        throw new Error(`build-client: the shared card machinery was not found at ${entry} — build dsh-ancesters first`);
    }
    return entry;
}

await build({
    entryPoints: ["src/client/index.ts"],
    outfile: "lib/client.js",
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "es2022",
    plugins: [cssModules],
    external: BASELINE_MODULES,
    alias: { "@comecaramelos/dsh-ancesters/client": ancestorsClient },
    sourcemap: "linked",
    sourcesContent: true,
    // Strictness is a property of THIS bundle, not of whichever config the
    // editor happens to read.
    tsconfigRaw: { compilerOptions: { strict: true } },
    banner: {
        js: [
            "window.__ModuleLoader__.load({",
            `\tid: ${JSON.stringify(pkg.name)},`,
            "\tfactory: (require) => {",
            "\t\tvar module = { exports: {} };",
            "\t\tvar exports = module.exports;",
            '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });'
        ].join("\n")
    },
    footer: {
        js: ["\treturn module.exports;", "\t}", "});"].join("\n")
    }
});
