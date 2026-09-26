/**
 * VS Code A11y Simulator Extension — Entry Point
 *
 * Activates on UI source file languages and wires together:
 *   • DiagnosticsProvider  — runs the a11y engine, populates the Problems panel
 *   • HoverProvider        — rich WCAG tooltips on squigglies
 *   • CodeActionProvider   — Quick-Fix lightbulb actions (apply patch / convert element)
 *   • SidebarProvider      — tree view grouped by persona in the Explorer panel
 *   • StatusBarItem        — badge in the bottom-right showing issue count
 *
 * The extension delegates all analysis to the sibling a11y-agent engine
 * by spawning `node <enginePath> local <filePath> --json` and parsing stdout.
 */

import * as vscode from "vscode";
import { DiagnosticsProvider } from "./diagnostics.js";
import { A11yHoverProvider } from "./hover.js";
import { A11yCodeActionProvider } from "./codeActions.js";
import { A11ySidebarProvider } from "./sidebar.js";
import { StatusBarManager } from "./statusBar.js";

// ─── Global providers (reused across commands) ────────────────────────────────

let diagnosticsProvider: DiagnosticsProvider;
let sidebarProvider: A11ySidebarProvider;
let statusBar: StatusBarManager;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("a11y-simulator");

  diagnosticsProvider = new DiagnosticsProvider(diagnosticCollection, context);
  sidebarProvider = new A11ySidebarProvider(context);
  statusBar = new StatusBarManager();

  // ── Sidebar tree view ───────────────────────────────────────────────────────
  const treeView = vscode.window.createTreeView("a11ySimulatorView", {
    treeDataProvider: sidebarProvider,
    showCollapseAll: true,
  });

  // ── Hover provider ──────────────────────────────────────────────────────────
  const hoverProvider = vscode.languages.registerHoverProvider(
    ["html", "javascriptreact", "typescriptreact", "javascript", "typescript", "css", "scss"],
    new A11yHoverProvider(diagnosticsProvider)
  );

  // ── Code action (Quick-Fix lightbulb) provider ──────────────────────────────
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    ["html", "javascriptreact", "typescriptreact", "javascript", "typescript", "css", "scss"],
    new A11yCodeActionProvider(diagnosticsProvider),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  // ── Commands ─────────────────────────────────────────────────────────────────
  const scanFileCmd = vscode.commands.registerCommand("a11y.scanFile", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    await runScan(editor.document);
  });

  const scanWithJiraCmd = vscode.commands.registerCommand(
    "a11y.scanFileWithJira",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const jiraPath = await vscode.window.showInputBox({
        prompt: "Path to Jira Markdown spec (e.g. docs/CHKT-104.md)",
        placeHolder: "docs/CHKT-104.md",
      });

      await runScan(editor.document, jiraPath ?? undefined);
    }
  );

  const clearCmd = vscode.commands.registerCommand("a11y.clearDiagnostics", () => {
    diagnosticCollection.clear();
    sidebarProvider.clear();
    statusBar.update(0, 0);
  });

  // ── Missing commands referenced by codeActions.ts ────────────────────────────
  const previewDiffCmd = vscode.commands.registerCommand(
    "a11y.previewDiff",
    async (uri: vscode.Uri, diag: { a11y: { diff: string; ruleId: string; persona: string } }) => {
      if (!diag?.a11y?.diff) return;
      const doc = await vscode.workspace.openTextDocument(uri);
      const original = doc.getText();
      const lines = original.split("\n");
      const diffLines = diag.a11y.diff.split("\n");
      const removed = diffLines.filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1));
      const added = diffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
      const hunkMatch = diag.a11y.diff.match(/@@ -(\d+)/);
      const startLine = hunkMatch ? parseInt(hunkMatch[1]!, 10) - 1 : 0;
      const patched = [...lines];
      if (removed.length && added.length) patched.splice(startLine, removed.length, ...added);
      const patchedUri = uri.with({ scheme: "untitled", path: uri.path.replace(/(\.[^.]+)$/, `.a11y-fixed$1`) });
      const patchedDoc = await vscode.workspace.openTextDocument(patchedUri);
      const initEdit = new vscode.WorkspaceEdit();
      initEdit.insert(patchedUri, new vscode.Position(0, 0), patched.join("\n"));
      await vscode.workspace.applyEdit(initEdit);
      await vscode.commands.executeCommand("vscode.diff", uri, patchedDoc.uri, `A11y Fix — WCAG ${diag.a11y.ruleId}: ${diag.a11y.persona}`);
    }
  );

  const revealInSidebarCmd = vscode.commands.registerCommand(
    "a11y.revealInSidebar",
    () => {
      vscode.commands.executeCommand("a11ySimulatorView.focus");
    }
  );

  // ── Auto-scan on open ────────────────────────────────────────────────────────
  const onOpen = vscode.workspace.onDidOpenTextDocument(async (doc) => {
    if (!isUIFile(doc.fileName)) return;
    await runScan(doc);
  });

  // ── Auto-scan on save ────────────────────────────────────────────────────────
  const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
    const cfg = vscode.workspace.getConfiguration("a11ySimulator");
    if (!cfg.get<boolean>("scanOnSave", true)) return;
    if (!isUIFile(doc.fileName)) return;
    await runScan(doc);
  });

  context.subscriptions.push(
    diagnosticCollection,
    treeView,
    hoverProvider,
    codeActionProvider,
    scanFileCmd,
    scanWithJiraCmd,
    clearCmd,
    previewDiffCmd,
    revealInSidebarCmd,
    onOpen,
    onSave,
    statusBar
  );

  // ── Scan whatever is already open at activation time ─────────────────────────
  const activeDoc = vscode.window.activeTextEditor?.document;
  if (activeDoc && isUIFile(activeDoc.fileName)) {
    void runScan(activeDoc);
  }
}

export function deactivate(): void {
  statusBar?.dispose();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UI_FILE_RE = /\.(jsx?|tsx?|html|css|scss|svg)$/i;

function isUIFile(filePath: string): boolean {
  return UI_FILE_RE.test(filePath);
}

async function runScan(
  doc: vscode.TextDocument,
  jiraDocPath?: string
): Promise<void> {
  statusBar.setScanning();
  try {
    const issues = await diagnosticsProvider.scan(doc.fileName, jiraDocPath);
    sidebarProvider.refresh(doc.fileName, issues);
    statusBar.update(
      issues.filter((i) => i.severity === vscode.DiagnosticSeverity.Error).length,
      issues.filter((i) => i.severity === vscode.DiagnosticSeverity.Warning).length
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `A11y scan failed: ${err instanceof Error ? err.message : String(err)}`
    );
    statusBar.update(0, 0);
  }
}
