"use strict";
/**
 * A11ySidebarProvider
 *
 * Drives the "A11Y Simulator" tree view in the VS Code Explorer panel.
 *
 * Tree structure:
 *   ▼ A11Y SIMULATOR (3 issues)
 *     ▼ ♿ Motor Impairment (2)
 *       • CheckoutPage.jsx:15 — Missing button semantics [WCAG 4.1.2]
 *       • CheckoutPage.jsx:24 — Positive tabindex [WCAG 2.4.3]
 *     ▼ 👁️ Visual Impairment (1)
 *       • CheckoutPage.jsx:5  — Low contrast #aaa on #fff [WCAG 1.4.3]
 *     ▶ 🌀 Vestibular / Cognitive (0)
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
exports.A11ySidebarProvider = void 0;
const vscode = __importStar(require("vscode"));
const PERSONA_ORDER = [
    "♿ Motor Impairment",
    "👁️ Visual Impairment",
    "🌀 Vestibular / Cognitive",
];
const PERSONA_MAP = {
    "Motor": "♿ Motor Impairment",
    "Visual": "👁️ Visual Impairment",
    "Vestibular/Cognitive": "🌀 Vestibular / Cognitive",
};
class PersonaGroupItem extends vscode.TreeItem {
    label;
    issues;
    constructor(label, issues) {
        super(`${label} (${issues.length})`, issues.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed);
        this.label = label;
        this.issues = issues;
        this.contextValue = "personaGroup";
        this.iconPath = new vscode.ThemeIcon(issues.length > 0 ? "warning" : "pass");
    }
}
class IssueItem extends vscode.TreeItem {
    diag;
    constructor(diag, filePath) {
        const line = diag.range.start.line + 1; // back to 1-based for display
        const short = diag.message.replace(/^[♿👁️🌀]\s.*?—\s*WCAG \S+:\s*/, "").slice(0, 60);
        super(`${filePath}:${line} — ${short}`, vscode.TreeItemCollapsibleState.None);
        this.diag = diag;
        this.tooltip = diag.message;
        this.contextValue = "a11yIssue";
        this.iconPath = new vscode.ThemeIcon(diag.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning");
        // Clicking the item navigates to the line in the editor
        this.command = {
            command: "vscode.open",
            title: "Go to Issue",
            arguments: [
                vscode.Uri.file(diag.a11y.ruleId ? filePath : filePath),
                {
                    selection: diag.range,
                    preserveFocus: true,
                },
            ],
        };
        this.description = `WCAG ${diag.a11y.ruleId}`;
    }
}
// ─── Provider ─────────────────────────────────────────────────────────────────
class A11ySidebarProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    groups = this.emptyGroups();
    currentFilePath = "";
    constructor(context) {
        this.context = context;
    }
    // ── Public API ──────────────────────────────────────────────────────────────
    refresh(filePath, issues) {
        this.currentFilePath = filePath;
        const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
        // Group by persona
        const byPersona = new Map(PERSONA_ORDER.map((p) => [p, []]));
        for (const diag of issues) {
            const personaLabel = PERSONA_MAP[diag.a11y.persona];
            if (personaLabel) {
                byPersona.get(personaLabel).push(new IssueItem(diag, fileName));
            }
        }
        this.groups = PERSONA_ORDER.map((p) => new PersonaGroupItem(p, byPersona.get(p) ?? []));
        this._onDidChangeTreeData.fire(undefined);
    }
    clear() {
        this.groups = this.emptyGroups();
        this.currentFilePath = "";
        this._onDidChangeTreeData.fire(undefined);
    }
    // ── TreeDataProvider ────────────────────────────────────────────────────────
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element)
            return this.groups;
        if (element instanceof PersonaGroupItem)
            return element.issues;
        return [];
    }
    // ─── Private ────────────────────────────────────────────────────────────────
    emptyGroups() {
        return PERSONA_ORDER.map((p) => new PersonaGroupItem(p, []));
    }
}
exports.A11ySidebarProvider = A11ySidebarProvider;
//# sourceMappingURL=sidebar.js.map