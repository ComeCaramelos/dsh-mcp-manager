/**
 * Ambient shape of the build's CSS-modules step (see scripts/build-client.mjs).
 *
 * A `*.module.css` import resolves inside the bundle to the compiled module:
 * the minified, class-scoped stylesheet text plus the default map from the
 * source's local class names to their scoped form.
 */
declare module "*.module.css" {
    const styles: Record<string, string>;
    export default styles;
    export const cssText: string;
}
