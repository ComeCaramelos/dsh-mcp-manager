/**
 * Browser half — what the collapsed row says.
 * 
 * A collapsed card answers one question: does this row need opening? So the
 * line is the live mirror read back — how many connections there are, how many
 * are answering, how many are not — and nothing else. It is drawn from the same
 * served values the expanded card reads, never from a second source.
 */
/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";

import STYLES from "../styles/McpManagerCard.module.css";
import { summarize } from "../catalog.js";

/** Props the shared card machinery hands a rendered summary. */
export interface SummaryLineProps {
    total: number;
    live: number;
    failed: number;
    t?: (key: string) => string;
}

/**
 * Render one summary line for the collapsed state.
 *
 * @param props - what the live mirror answers, already counted.
 */
export function SummaryLine(props: SummaryLineProps): any {
    const counts = props.total === void 0 ? summarize({}) : props;
    const key =
        counts.total === 0
            ? "summaryNone"
            : counts.failed > 0
                ? "summaryBroken"
                : counts.live < counts.total
                    ? "summaryPartial"
                    : "summaryAll";
    // The copy arrives as `t`: the shared machinery binds this card's locale
    // namespace and hands it to `renderSummary` (gap **H7**, closed here), so
    // this line binds nothing itself and falls back to the key only if the shell
    // never served a locale service at all.
    const text = (props.t ?? ((wanted: string) => wanted))(key);
    return jsxs("div", {
        className: STYLES.summary,
        "data-total": String(counts.total),
        "data-live": String(counts.live),
        "data-failed": String(counts.failed),
        children: [
            jsx("span", { className: counts.failed > 0 ? STYLES.dotError : STYLES.dot }),
            jsx("span", { className: STYLES.liveText, children: text })
        ]
    });
}
