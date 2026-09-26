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

import * as vscode from "vscode";
import { DiagnosticsProvider, A11yDiagnostic } from "./diagnostics.js";

export class A11yCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly diagnostics: DiagnosticsProvider) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const a11yDiags = context.diagnostics.filter(
      (d): d is A11yDiagnostic =>
        d.source?.startsWith("A11y Simulator") === true &&
        "a11y" in d
    ) as A11yDiagnostic[];

    if (a11yDiags.length === 0) return [];

    const actions: vscode.CodeAction[] = [];

    for (const diag of a11yDiags) {
      const { ruleId, persona, diff, suggestedFix } = diag.a11y;

      // ── Action 1: Apply the diff patch ────────────────────────────────────
      if (diff && diff.trim().length > 0) {
        const applyAction = new vscode.CodeAction(
          `💡 A11y Fix (WCAG ${ruleId}): ${suggestedFix.slice(0, 70)}${suggestedFix.length > 70 ? "…" : ""}`,
          vscode.CodeActionKind.QuickFix
        );
        applyAction.diagnostics = [diag];
        applyAction.isPreferred = true;

        const edit = this.diffToWorkspaceEdit(document, diff);
        if (edit) {
          applyAction.edit = edit;
        } else {
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
      const previewAction = new vscode.CodeAction(
        `🔍 Preview A11y Patch (WCAG ${ruleId} — ${persona})`,
        vscode.CodeActionKind.QuickFix
      );
      previewAction.diagnostics = [diag];
      previewAction.command = {
        command: "a11y.previewDiff",
        title: "Preview Diff",
        arguments: [document.uri, diag],
      };
      actions.push(previewAction);

      // ── Action 3: View in sidebar ─────────────────────────────────────────
      const sidebarAction = new vscode.CodeAction(
        `📋 View in A11y Sidebar`,
        vscode.CodeActionKind.Empty
      );
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
  private diffToWorkspaceEdit(
    document: vscode.TextDocument,
    diff: string
  ): vscode.WorkspaceEdit | null {
    try {
      const lines = diff.split("\n");
      const hunkHeader = lines.find((l) => l.startsWith("@@"));
      if (!hunkHeader) return null;

      // Parse @@ -startLine,count +startLine,count @@
      const m = hunkHeader.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!m) return null;

      const origStart = parseInt(m[1]!, 10) - 1; // 0-based

      // Collect removed and added lines from the hunk body
      const hunkBody = lines.slice(lines.indexOf(hunkHeader) + 1);
      const removed: string[] = [];
      const added: string[] = [];

      for (const line of hunkBody) {
        if (line.startsWith("-")) removed.push(line.slice(1));
        else if (line.startsWith("+")) added.push(line.slice(1));
      }

      if (removed.length === 0 && added.length === 0) return null;

      const edit = new vscode.WorkspaceEdit();

      // Replace the removed lines with the added lines
      const startPos = new vscode.Position(origStart, 0);
      const endPos = new vscode.Position(origStart + removed.length, 0);
      const replaceRange = new vscode.Range(startPos, endPos);

      edit.replace(document.uri, replaceRange, added.join("\n") + "\n");

      return edit;
    } catch {
      return null;
    }
  }
}
