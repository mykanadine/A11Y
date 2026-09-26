"use strict";
/**
 * A11yCodeActionProvider
 *
 * Provides the Quick-Fix lightbulb (Ctrl+. / Cmd+.) for each a11y diagnostic.
 *
 * For each failure three actions are offered:
 *   1. Apply the auto-generated unified diff patch (workspace edit)
 *   2. "Convert to semantic element" — opens diff preview (when available)
 *   3. "View in A11y Sidebar" — focuses the tree view on this issue
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
exports.A11yCodeActionProvider = void 0;
const vscode = __importStar(require("vscode"));
class A11yCodeActionProvider {
    diagnostics;
    constructor(diagnostics) {
        this.diagnostics = diagnostics;
    }
    provideCodeActions(document, range, context) {
        const a11yDiags = context.diagnostics.filter((d) => d.source?.startsWith("A11y Simulator") === true &&
            "a11y" in d);
        if (a11yDiags.length === 0)
            return [];
        const actions = [];
        for (const diag of a11yDiags) {
            const { ruleId, persona, diff, suggestedFix } = diag.a11y;
            // ── Action 1: Apply the diff patch ────────────────────────────────────
            if (diff && diff.trim().length > 0) {
                const applyAction = new vscode.CodeAction(`💡 A11y Fix (WCAG ${ruleId}): ${suggestedFix.slice(0, 70)}${suggestedFix.length > 70 ? "…" : ""}`, vscode.CodeActionKind.QuickFix);
                applyAction.diagnostics = [diag];
                applyAction.isPreferred = true;
                const edit = this.diffToWorkspaceEdit(document, diff);
                if (edit) {
                    applyAction.edit = edit;
                }
                else {
                    // Diff couldn't be parsed — fall back to opening an untitled diff
                    applyAction.command = {
                        command: "a11y.showDiff",
                        title: "Show Diff",
                        arguments: [document.uri, diff],
                    };
                }
                actions.push(applyAction);
            }
            // ── Action 2: Open diff preview ───────────────────────────────────────
            const previewAction = new vscode.CodeAction(`🔍 Preview A11y Patch (WCAG ${ruleId} — ${persona})`, vscode.CodeActionKind.QuickFix);
            previewAction.diagnostics = [diag];
            previewAction.command = {
                command: "a11y.previewDiff",
                title: "Preview Diff",
                arguments: [document.uri, diag],
            };
            actions.push(previewAction);
            // ── Action 3: View in sidebar ─────────────────────────────────────────
            const sidebarAction = new vscode.CodeAction(`📋 View in A11y Sidebar`, vscode.CodeActionKind.Empty);
            sidebarAction.diagnostics = [diag];
            sidebarAction.command = {
                command: "a11y.revealInSidebar",
                title: "Reveal in Sidebar",
                arguments: [diag],
            };
            actions.push(sidebarAction);
        }
        return actions;
    }
    // ─── Unified diff → WorkspaceEdit ─────────────────────────────────────────
    /**
     * Parse a minimal unified diff (as produced by the a11y engine's buildUnifiedDiff)
     * into a VS Code WorkspaceEdit.
     *
     * Diff format expected:
     *   --- a/<file>
     *   +++ b/<file>
     *   @@ -<start>,<count> +<start>,<count> @@
     *   -<removed line>
     *   +<added line>
     *    <context line>
     */
    diffToWorkspaceEdit(document, diff) {
        try {
            const lines = diff.split("\n");
            const hunkHeader = lines.find((l) => l.startsWith("@@"));
            if (!hunkHeader)
                return null;
            // Parse @@ -startLine,count +startLine,count @@
            const m = hunkHeader.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (!m)
                return null;
            const origStart = parseInt(m[1], 10) - 1; // 0-based
            // Collect removed and added lines from the hunk body
            const hunkBody = lines.slice(lines.indexOf(hunkHeader) + 1);
            const removed = [];
            const added = [];
            for (const line of hunkBody) {
                if (line.startsWith("-"))
                    removed.push(line.slice(1));
                else if (line.startsWith("+"))
                    added.push(line.slice(1));
            }
            if (removed.length === 0 && added.length === 0)
                return null;
            const edit = new vscode.WorkspaceEdit();
            // Replace the removed lines with the added lines
            const startPos = new vscode.Position(origStart, 0);
            const endPos = new vscode.Position(origStart + removed.length, 0);
            const replaceRange = new vscode.Range(startPos, endPos);
            edit.replace(document.uri, replaceRange, added.join("\n") + "\n");
            return edit;
        }
        catch {
            return null;
        }
    }
}
exports.A11yCodeActionProvider = A11yCodeActionProvider;
//# sourceMappingURL=codeActions.js.map