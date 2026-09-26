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

import * as vscode from "vscode";
import { DiagnosticsProvider } from "./diagnostics.js";

// Maps WCAG rule IDs to their official documentation URLs
const WCAG_DOC_URLS: Record<string, string> = {
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

export class A11yHoverProvider implements vscode.HoverProvider {
  constructor(private readonly diagnostics: DiagnosticsProvider) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const issue = this.diagnostics.getIssueAt(document.fileName, position);
    if (!issue) return undefined;

    const { ruleId, persona, explanation, suggestedFix } = issue.a11y;

    const personaEmoji =
      persona === "Motor" ? "♿" : persona === "Visual" ? "👁️" : "🌀";
    const severityLabel = issue.severity === 0 ? "Error" : "Warning";
    const docUrl = WCAG_DOC_URLS[ruleId];

    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.supportHtml = false;

    md.appendMarkdown(
      `**${personaEmoji} ${persona} Persona ${severityLabel} — WCAG ${ruleId}**\n\n`
    );
    md.appendMarkdown("---\n\n");
    md.appendMarkdown(`${explanation}\n\n`);
    md.appendMarkdown(`**Suggested fix:** ${suggestedFix}\n\n`);

    if (docUrl) {
      md.appendMarkdown(`📖 [WCAG ${ruleId} Documentation](${docUrl})\n`);
    }

    return new vscode.Hover(md, issue.range);
  }
}
