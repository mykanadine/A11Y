/**
 * StatusBarManager
 *
 * Manages the accessibility badge in the VS Code status bar (bottom-right).
 *
 * States:
 *   • Idle / no issues: $(accessibility) A11y: ✓
 *   • Scanning:         $(sync~spin) A11y: Scanning…
 *   • Issues found:     $(error) A11y: 2 errors, 1 warning
 *   • All clear:        $(pass) A11y: All clear
 */

import * as vscode from "vscode";

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100 // priority — appears near the right end of the status bar
    );
    this.item.command = "a11y.scanFile";
    this.item.tooltip = "Click to run A11y scan on the current file";
    this.update(0, 0);
    this.item.show();
  }

  /** Show a spinning indicator while the scan is in progress. */
  setScanning(): void {
    this.item.text = "$(sync~spin) A11y: Scanning…";
    this.item.backgroundColor = undefined;
  }

  /**
   * Update the badge after a scan completes.
   * @param errors   Number of Error-severity (Level A) issues.
   * @param warnings Number of Warning-severity (Level AA) issues.
   */
  update(errors: number, warnings: number): void {
    const total = errors + warnings;

    if (total === 0) {
      this.item.text = "$(pass) A11y: ✓";
      this.item.backgroundColor = undefined;
    } else if (errors > 0) {
      this.item.text = `$(error) A11y: ${errors} error${errors !== 1 ? "s" : ""}${warnings > 0 ? `, ${warnings} warning${warnings !== 1 ? "s" : ""}` : ""}`;
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else {
      this.item.text = `$(warning) A11y: ${warnings} warning${warnings !== 1 ? "s" : ""}`;
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
