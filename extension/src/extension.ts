/**
 * A11y Agent — VS Code / IBM Bob IDE Extension
 *
 * Provides four integration points:
 *   1. DiagnosticCollection  — yellow/red squiggly lines at each failure location
 *   2. HoverProvider         — markdown tooltip with WCAG rule + persona context
 *   3. CodeActionProvider    — Quick Fix lightbulb that applies the debugger patch
 *   4. StatusBarItem         — "$(accessibility) A11y: N issues" in the bottom bar
 *
 * The extension shells out to `node dist/index.js local <file> --json`
 * so the core engine stays in one place and the extension is purely a thin UI layer.
 */

import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";

// ─── Wire-format from `node dist/index.js local --json` ──────────────────────

interface A11yIssue {
  filePath: string;
  line: number | null;
  ruleId: string;
  persona: string;
  issue: string;
  suggestedFix: string;
  explanation: string;
  diff: string;
}

interface A11yScanOutput {
  passCount: number;
  failCount: number;
  issues: A11yIssue[];
}

// ─── Extension state ──────────────────────────────────────────────────────────

let diagnostics: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;

// filePath → issues cache (populated after each scan)
const issueCache = new Map<string, A11yIssue[]>();

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("a11y-agent");
  context.subscriptions.push(diagnostics);

  // Status bar
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = "workbench.action.problems.focus";
  statusBar.text = "$(accessibility) A11y";
  statusBar.tooltip = "A11y Agent — click to open Problems panel";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Hover provider
  const hover = vscode.languages.registerHoverProvider(UI_SELECTOR, {
    provideHover,
  });
  context.subscriptions.push(hover);

  // Code action (Quick Fix) provider
  const codeAction = vscode.languages.registerCodeActionsProvider(
    UI_SELECTOR,
    { provideCodeActions },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  context.subscriptions.push(codeAction);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("a11yAgent.scanFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) scanDocument(editor.document);
    }),
    vscode.commands.registerCommand(
      "a11yAgent.scanFileWithJira",
      scanWithJiraPicker
    ),
    vscode.commands.registerCommand(
      "a11yAgent._applyPatch",
      applyPatchCommand
    )
  );

  // Auto-scan on open / save
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isUIFile(doc) && config().scanOnSave) scanDocument(doc);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isUIFile(doc) && config().scanOnSave) scanDocument(doc);
    })
  );

  // Scan the active file immediately on activation
  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (isUIFile(doc)) scanDocument(doc);
  }
}

export function deactivate(): void {
  diagnostics.dispose();
  statusBar.dispose();
}

// ─── Language selector ────────────────────────────────────────────────────────

const UI_SELECTOR: vscode.DocumentSelector = [
  { language: "javascriptreact" },
  { language: "typescriptreact" },
  { language: "javascript" },
  { language: "typescript" },
  { language: "html" },
  { language: "vue" },
];

function isUIFile(doc: vscode.TextDocument): boolean {
  return (UI_SELECTOR as Array<{ language: string }>).some(
    (s) => s.language === doc.languageId
  );
}

// ─── Configuration ────────────────────────────────────────────────────────────

function config(): { enginePath: string; scanOnSave: boolean; jiraDocGlob: string } {
  const cfg = vscode.workspace.getConfiguration("a11yAgent");
  return {
    enginePath: cfg.get<string>("enginePath") ?? "",
    scanOnSave: cfg.get<boolean>("scanOnSave") ?? true,
    jiraDocGlob: cfg.get<string>("jiraDocGlob") ?? "**/*.md",
  };
}

// ─── Engine path resolution ───────────────────────────────────────────────────

function resolveEnginePath(): string | null {
  const manual = config().enginePath;
  if (manual && fs.existsSync(manual)) return manual;

  // Auto-detect: look for a11y-agent/dist/index.js relative to workspace root
  const roots = vscode.workspace.workspaceFolders ?? [];
  for (const root of roots) {
    const candidate = path.join(root.uri.fsPath, "a11y-agent", "dist", "index.js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

async function scanDocument(
  doc: vscode.TextDocument,
  jiraDocPath?: string
): Promise<void> {
  const enginePath = resolveEnginePath();
  if (!enginePath) {
    vscode.window.showWarningMessage(
      "A11y Agent: engine not found. Set a11yAgent.enginePath in settings."
    );
    return;
  }

  const filePath = doc.uri.fsPath;
  const args = ["local", filePath, "--json"];
  if (jiraDocPath) args.push("--jira", jiraDocPath);

  let stdout = "";
  let stderr = "";

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = cp.spawn("node", [enginePath, ...args], {
        env: { ...process.env },
      });
      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("close", () => resolve());
      proc.on("error", reject);
    });
  } catch (err) {
    vscode.window.showErrorMessage(`A11y Agent: failed to run engine — ${err}`);
    return;
  }

  let output: A11yScanOutput;
  try {
    output = JSON.parse(stdout) as A11yScanOutput;
  } catch {
    // Engine wrote to stderr (e.g. missing env) — show warning but don't crash
    if (stderr) console.warn("[A11y Extension]", stderr);
    return;
  }

  applyDiagnostics(doc, output.issues);
  updateStatusBar();
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

function applyDiagnostics(
  doc: vscode.TextDocument,
  issues: A11yIssue[]
): void {
  issueCache.set(doc.uri.fsPath, issues);

  const diags: vscode.Diagnostic[] = issues.map((issue) => {
    const lineIndex = issue.line != null ? issue.line - 1 : 0;
    const line = doc.lineAt(Math.min(lineIndex, doc.lineCount - 1));
    const range = new vscode.Range(
      lineIndex,
      line.firstNonWhitespaceCharacterIndex,
      lineIndex,
      line.range.end.character
    );

    const diag = new vscode.Diagnostic(
      range,
      `[A11y ${issue.persona}] ${issue.issue}`,
      // Errors for Motor/Visual (directly blocks user tasks), warnings for Vestibular
      issue.persona === "Vestibular/Cognitive"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error
    );
    diag.source = "A11y Agent";
    diag.code = `WCAG ${issue.ruleId}`;
    return diag;
  });

  diagnostics.set(doc.uri, diags);
}

function updateStatusBar(): void {
  let total = 0;
  issueCache.forEach((issues) => (total += issues.length));
  if (total === 0) {
    statusBar.text = "$(pass) A11y: OK";
    statusBar.backgroundColor = undefined;
  } else {
    statusBar.text = `$(warning) A11y: ${total} issue${total !== 1 ? "s" : ""}`;
    statusBar.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }
}

// ─── Hover Provider ───────────────────────────────────────────────────────────

function provideHover(
  doc: vscode.TextDocument,
  position: vscode.Position
): vscode.Hover | null {
  const issues = issueCache.get(doc.uri.fsPath) ?? [];
  const issue = issues.find(
    (i) => i.line != null && i.line - 1 === position.line
  );
  if (!issue) return null;

  const md = new vscode.MarkdownString(
    [
      `**A11y Agent** — ${issue.persona} Persona`,
      "",
      `**WCAG ${issue.ruleId}**: ${issue.issue}`,
      "",
      `> ${issue.explanation}`,
      "",
      `**Suggested fix:** ${issue.suggestedFix}`,
    ].join("\n")
  );
  md.isTrusted = true;
  return new vscode.Hover(md);
}

// ─── Code Action Provider ─────────────────────────────────────────────────────

function provideCodeActions(
  doc: vscode.TextDocument,
  range: vscode.Range
): vscode.CodeAction[] {
  const issues = issueCache.get(doc.uri.fsPath) ?? [];
  const actions: vscode.CodeAction[] = [];

  for (const issue of issues) {
    if (issue.line == null) continue;
    const issueLine = issue.line - 1;
    if (issueLine < range.start.line || issueLine > range.end.line) continue;

    // ── Quick Fix: apply the patch inline ──────────────────────────────────
    const applyAction = new vscode.CodeAction(
      `Fix with A11y Agent (WCAG ${issue.ruleId}): ${issue.suggestedFix.slice(0, 55)}…`,
      vscode.CodeActionKind.QuickFix
    );
    applyAction.command = {
      command: "a11yAgent._applyPatch",
      title: "Apply A11y patch",
      arguments: [doc.uri, issue],
    };
    applyAction.isPreferred = true;
    actions.push(applyAction);

    // ── Secondary: open side-by-side diff viewer ───────────────────────────
    const diffAction = new vscode.CodeAction(
      `Preview diff — WCAG ${issue.ruleId} (${issue.persona})`,
      vscode.CodeActionKind.QuickFix
    );
    diffAction.command = {
      command: "a11yAgent._applyPatch",
      title: "Preview diff",
      arguments: [doc.uri, issue, /* preview */ true],
    };
    actions.push(diffAction);
  }

  return actions;
}

// ─── Patch application command ────────────────────────────────────────────────

async function applyPatchCommand(
  uri: vscode.Uri,
  issue: A11yIssue,
  previewOnly = false
): Promise<void> {
  if (!issue.diff) {
    vscode.window.showInformationMessage("A11y Agent: no diff available for this issue.");
    return;
  }

  if (previewOnly) {
    // Write patched version to a temp file and open a diff view
    await openDiffViewer(uri, issue);
    return;
  }

  // Apply the unified diff by rewriting lines directly in the document
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = buildWorkspaceEdit(doc, issue);
  if (edit) {
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage(
      `A11y Agent: patch applied for WCAG ${issue.ruleId}.`
    );
  }
}

/**
 * Build a WorkspaceEdit that replaces the original snippet with the patched
 * snippet. Parses the unified diff to find the exact lines to replace.
 */
function buildWorkspaceEdit(
  doc: vscode.TextDocument,
  issue: A11yIssue
): vscode.WorkspaceEdit | null {
  if (!issue.line) return null;

  const lines = doc.getText().split("\n");
  const zeroLine = issue.line - 1;

  // Extract removed (-) and added (+) lines from the diff hunk
  const diffLines = issue.diff.split("\n");
  const removed = diffLines
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1));
  const added = diffLines
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

  if (!removed.length || !added.length) return null;

  // Find the start of the removed block in the document
  let startLine = zeroLine;
  for (let i = Math.max(0, zeroLine - 5); i < Math.min(lines.length, zeroLine + 5); i++) {
    if (lines[i]?.trim() === removed[0]?.trim()) {
      startLine = i;
      break;
    }
  }

  const endLine = startLine + removed.length - 1;
  const range = new vscode.Range(startLine, 0, endLine, lines[endLine]?.length ?? 0);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, range, added.join("\n"));
  return edit;
}

/**
 * Open Bob/VS Code's native diff viewer with the patched content on the right.
 * The user can review the red/green diff and click "Accept Changes" (native UX).
 */
async function openDiffViewer(
  uri: vscode.Uri,
  issue: A11yIssue
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const original = doc.getText();

  // Apply the patch to produce the "after" content
  const lines = original.split("\n");
  const diffLines = issue.diff.split("\n");
  const removed = diffLines
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1));
  const added = diffLines
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

  const patchedLines = [...lines];
  if (issue.line && removed.length && added.length) {
    const zeroLine = issue.line - 1;
    patchedLines.splice(zeroLine, removed.length, ...added);
  }
  const patched = patchedLines.join("\n");

  // Write patched content to an in-memory doc via the `untitled:` scheme
  const patchedUri = uri.with({
    scheme: "untitled",
    path: uri.path.replace(/(\.[^.]+)$/, `.a11y-fixed$1`),
  });
  const patchedDoc = await vscode.workspace.openTextDocument(patchedUri);
  const initEdit = new vscode.WorkspaceEdit();
  initEdit.insert(patchedUri, new vscode.Position(0, 0), patched);
  await vscode.workspace.applyEdit(initEdit);

  // Open the native diff viewer: original (left) vs patched (right)
  await vscode.commands.executeCommand(
    "vscode.diff",
    uri,
    patchedDoc.uri,
    `A11y Fix — WCAG ${issue.ruleId}: ${issue.persona}`
  );
}

// ─── Jira picker command ──────────────────────────────────────────────────────

async function scanWithJiraPicker(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const jiraFiles = await vscode.workspace.findFiles(
    config().jiraDocGlob,
    "**/node_modules/**",
    20
  );

  const picked = await vscode.window.showQuickPick(
    jiraFiles.map((f) => ({
      label: path.basename(f.fsPath),
      description: vscode.workspace.asRelativePath(f),
      uri: f,
    })),
    { placeHolder: "Select a Jira spec Markdown file…" }
  );

  if (picked) {
    await scanDocument(editor.document, picked.uri.fsPath);
  }
}
