"use strict";
/**
 * A11yHoverProvider
 *
 * Shows a rich WCAG tooltip when the cursor hovers over a squiggly line.
 *
 * Card layout:
 *   ⚠️ Motor Persona Failure — WCAG 4.1.2 Name, Role, Value
 *   ─────────────────────────────────────────────
 *   Elements with an onClick handler must be reachable via keyboard…
 *
 *   **Suggested fix:** Add role="button" tabIndex={0} and onKeyDown handler
 *
 *   📖 WCAG 4.1.2 Documentation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.A11yHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
// Maps WCAG rule IDs to their official documentation URLs
const WCAG_DOC_URLS = {
    "1.1.1": "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content",
    "1.4.1": "https://www.w3.org/WAI/WCAG22/Understanding/use-of-color",
    "1.4.3": "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum",
    "2.1.1": "https://www.w3.org/WAI/WCAG22/Understanding/keyboard",
    "2.2.2": "https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide",
    "2.3.1": "https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold",
    "2.3.3": "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions",
    "2.4.3": "https://www.w3.org/WAI/WCAG22/Understanding/focus-order",
    "2.4.7": "https://www.w3.org/WAI/WCAG22/Understanding/focus-visible",
    "4.1.2": "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value",
};
class A11yHoverProvider {
    diagnostics;
    constructor(diagnostics) {
        this.diagnostics = diagnostics;
    }
    provideHover(document, position) {
        const issue = this.diagnostics.getIssueAt(document.fileName, position);
        if (!issue)
            return undefined;
        const { ruleId, persona, explanation, suggestedFix } = issue.a11y;
        const personaEmoji = persona === "Motor" ? "♿" : persona === "Visual" ? "👁️" : "🌀";
        const severityLabel = issue.severity === 0 ? "Error" : "Warning";
        const docUrl = WCAG_DOC_URLS[ruleId];
        const md = new vscode.MarkdownString("", true);
        md.isTrusted = true;
        md.supportHtml = false;
        md.appendMarkdown(`**${personaEmoji} ${persona} Persona ${severityLabel} — WCAG ${ruleId}**\n\n`);
        md.appendMarkdown("---\n\n");
        md.appendMarkdown(`${explanation}\n\n`);
        md.appendMarkdown(`**Suggested fix:** ${suggestedFix}\n\n`);
        if (docUrl) {
            md.appendMarkdown(`📖 [WCAG ${ruleId} Documentation](${docUrl})\n`);
        }
        return new vscode.Hover(md, issue.range);
    }
}
exports.A11yHoverProvider = A11yHoverProvider;
//# sourceMappingURL=hover.js.map