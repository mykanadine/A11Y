"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const diagnostics_js_1 = require("./diagnostics.js");
const hover_js_1 = require("./hover.js");
const codeActions_js_1 = require("./codeActions.js");
const sidebar_js_1 = require("./sidebar.js");
const statusBar_js_1 = require("./statusBar.js");
// ─── Global providers (reused across commands) ────────────────────────────────
let diagnosticsProvider;
let sidebarProvider;
let statusBar;
// ─── Activation ───────────────────────────────────────────────────────────────
function activate(context) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("a11y-simulator");
    diagnosticsProvider = new diagnostics_js_1.DiagnosticsProvider(diagnosticCollection, context);
    sidebarProvider = new sidebar_js_1.A11ySidebarProvider(context);
    statusBar = new statusBar_js_1.StatusBarManager();
    // ── Sidebar tree view ───────────────────────────────────────────────────────
    const treeView = vscode.window.createTreeView("a11ySimulatorView", {
        treeDataProvider: sidebarProvider,
        showCollapseAll: true,
    });
    // ── Hover provider ──────────────────────────────────────────────────────────
    const hoverProvider = vscode.languages.registerHoverProvider(["html", "javascriptreact", "typescriptreact", "javascript", "typescript", "css", "scss"], new hover_js_1.A11yHoverProvider(diagnosticsProvider));
    // ── Code action (Quick-Fix lightbulb) provider ──────────────────────────────
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(["html", "javascriptreact", "typescriptreact", "javascript", "typescript", "css", "scss"], new codeActions_js_1.A11yCodeActionProvider(diagnosticsProvider), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] });
    // ── Commands ─────────────────────────────────────────────────────────────────
    const scanFileCmd = vscode.commands.registerCommand("a11y.scanFile", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        await runScan(editor.document);
    });
    const scanWithJiraCmd = vscode.commands.registerCommand("a11y.scanFileWithJira", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const jiraPath = await vscode.window.showInputBox({
            prompt: "Path to Jira Markdown spec (e.g. docs/CHKT-104.md)",
            placeHolder: "docs/CHKT-104.md",
        });
        await runScan(editor.document, jiraPath ?? undefined);
    });
    const clearCmd = vscode.commands.registerCommand("a11y.clearDiagnostics", () => {
        diagnosticCollection.clear();
        sidebarProvider.clear();
        statusBar.update(0, 0);
    });
    // ── Auto-scan on save ────────────────────────────────────────────────────────
    const onSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        const cfg = vscode.workspace.getConfiguration("a11ySimulator");
        if (!cfg.get("scanOnSave", true))
            return;
        if (!isUIFile(doc.fileName))
            return;
        await runScan(doc);
    });
    context.subscriptions.push(diagnosticCollection, treeView, hoverProvider, codeActionProvider, scanFileCmd, scanWithJiraCmd, clearCmd, onSave, statusBar);
}
function deactivate() {
    statusBar?.dispose();
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
const UI_FILE_RE = /\.(jsx?|tsx?|html|css|scss|svg)$/i;
function isUIFile(filePath) {
    return UI_FILE_RE.test(filePath);
}
async function runScan(doc, jiraDocPath) {
    statusBar.setScanning();
    try {
        const issues = await diagnosticsProvider.scan(doc.fileName, jiraDocPath);
        sidebarProvider.refresh(doc.fileName, issues);
        statusBar.update(issues.filter((i) => i.severity === vscode.DiagnosticSeverity.Error).length, issues.filter((i) => i.severity === vscode.DiagnosticSeverity.Warning).length);
    }
    catch (err) {
        vscode.window.showErrorMessage(`A11y scan failed: ${err instanceof Error ? err.message : String(err)}`);
        statusBar.update(0, 0);
    }
}
//# sourceMappingURL=extension.js.map