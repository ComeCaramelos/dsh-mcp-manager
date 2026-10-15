/**
 * Ambient modules the shell seeds into `window.__ModuleLoader__` before this
 * bundle runs. The build keeps them external, so source-level imports must be
 * declared here for `tsc -p tsconfig.client.json` to typecheck the browser
 * half without a copy of the shell in `node_modules`.
 */
declare module "react" {
    const react: any;
    export default react;
    export const useState: any;
    export const useCallback: any;
    export const useEffect: any;
    export const useMemo: any;
    export const createElement: any;
}
declare module "react/jsx-runtime" {
    export const jsx: any;
    export const jsxs: any;
    export const Fragment: any;
}
declare module "@deepseek-ai/dsh-client-store" {
    export const createStore: any;
    export const useStore: any;
}
declare module "@deepseek-ai/dsh-client-ui-primitives" {
    export const Button: any;
    export const Input: any;
    export const Select: any;
    export const Textarea: any;
}
