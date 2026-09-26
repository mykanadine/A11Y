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

import * as vscode from "vscode";
import { A11yDiagnostic } from "./diagnostics.js";

// ─── Tree item types ──────────────────────────────────────────────────────────

type PersonaLabel = "♿ Motor Impairment" | "👁️ Visual Impairment" | "🌀 Vestibular / Cognitive";

const PERSONA_ORDER: PersonaLabel[] = [
  "♿ Motor Impairment",
  "👁️ Visual Impairment",
  "🌀 Vestibular / Cognitive",
];

const PERSONA_MAP: Record<string, PersonaLabel> = {
  "Motor":               "♿ Motor Impairment",
  "Visual":              "👁️ Visual Impairment",
  "Vestibular/Cognitive": "🌀 Vestibular / Cognitive",
};

class PersonaGroupItem extends vscode.TreeItem {
  constructor(
    public readonly label: PersonaLabel,
    public readonly issues: IssueItem[],
  ) {
    super(
      `${label} (${issues.length})`,
      issues.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.contextValue = "personaGroup";
    this.iconPath = new vscode.ThemeIcon(
      issues.length > 0 ? "warning" : "pass"
    );
  }
}

class IssueItem extends vscode.TreeItem {
  constructor(
    public readonly diag: A11yDiagnostic,
    filePath: string
  ) {
    const line = diag.range.start.line + 1; // back to 1-based for display
    const short = diag.message.replace(/^[♿👁️🌀]\s.*?—\s*WCAG \S+:\s*/, "").slice(0, 60);
    super(`${filePath}:${line} — ${short}`, vscode.TreeItemCollapsibleState.None);

    this.tooltip = diag.message;
    this.contextValue = "a11yIssue";
    this.iconPath = new vscode.ThemeIcon(
      diag.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning"
    );

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

export class A11ySidebarProvider
  implements vscode.TreeDataProvider<PersonaGroupItem | IssueItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<PersonaGroupItem | IssueItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private groups: PersonaGroupItem[] = this.emptyGroups();
  private currentFilePath = "";

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  refresh(filePath: string, issues: A11yDiagnostic[]): void {
    this.currentFilePath = filePath;
    const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;

    // Group by persona
    const byPersona = new Map<PersonaLabel, IssueItem[]>(
      PERSONA_ORDER.map((p) => [p, []])
    );

    for (const diag of issues) {
      const personaLabel = PERSONA_MAP[diag.a11y.persona];
      if (personaLabel) {
        byPersona.get(personaLabel)!.push(new IssueItem(diag, fileName));
      }
    }

    this.groups = PERSONA_ORDER.map(
      (p) => new PersonaGroupItem(p, byPersona.get(p) ?? [])
    );

    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.groups = this.emptyGroups();
    this.currentFilePath = "";
    this._onDidChangeTreeData.fire(undefined);
  }

  // ── TreeDataProvider ────────────────────────────────────────────────────────

  getTreeItem(element: PersonaGroupItem | IssueItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: PersonaGroupItem | IssueItem
  ): (PersonaGroupItem | IssueItem)[] {
    if (!element) return this.groups;
    if (element instanceof PersonaGroupItem) return element.issues;
    return [];
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private emptyGroups(): PersonaGroupItem[] {
    return PERSONA_ORDER.map((p) => new PersonaGroupItem(p, []));
  }
}
