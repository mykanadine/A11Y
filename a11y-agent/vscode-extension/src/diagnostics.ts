/**
 * DiagnosticsProvider
 *
 * Shells out to `node <enginePath> local <filePath> --json`, parses the
 * JSON output, and populates VS Code's diagnostic collection (Problems panel).
 *
 * Each a11y failure becomes a Diagnostic with:
 *   - severity: Error for WCAG Level A failures, Warning for AA
 *   - code:     WCAG rule ID (e.g. "4.1.2")
 *   - source:   persona label (e.g. "Motor")
 *   - message:  full issue description
 *   - relatedInformation: the unified diff as a linked message
 */

import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";

// ─── Engine JSON output shape (mirrors LocalScanResult + BobToolResponse) ─────

export interface EngineIssue {
  filePath: string;
  line: number | null;
  ruleId: string;
  persona: string;
  issue: string;
  suggestedFix: string;
  explanation: string;
  diff: string;
}

interface EngineOutput {
  passCount: number;
  failCount: number;
  issues: EngineIssue[];
}

// ─── Diagnostic metadata stored on each diagnostic for use by hover/actions ───

export interface A11yDiagnostic extends vscode.Diagnostic {
  a11y: {
    ruleId: string;
    persona: string;
    explanation: string;
    diff: string;
    suggestedFix: string;
  };
}

export class DiagnosticsProvider {
  // Map filePath → A11yDiagnostic[] for hover / code-action lookup
  private issueMap = new Map<string, A11yDiagnostic[]>();

  constructor(
    private readonly collection: vscode.DiagnosticCollection,
    private readonly context: vscode.ExtensionContext
  ) {}

  /** Run the engine and return the populated diagnostics for this file. */
  async scan(filePath: string, jiraDocPath?: string): Promise<A11yDiagnostic[]> {
    const enginePath = this.resolveEnginePath();
    const args = ["local", filePath, "--json"];
    if (jiraDocPath) args.push("--jira", jiraDocPath);

    const output = await this.spawnEngine(enginePath, args, path.dirname(filePath));
    const diagnostics = this.toDiagnostics(output, filePath);

    this.issueMap.set(filePath, diagnostics);
    this.collection.set(vscode.Uri.file(filePath), diagnostics);

    return diagnostics;
  }

  /** Retrieve cached diagnostics for a file (used by hover + code-action providers). */
  getIssues(filePath: string): A11yDiagnostic[] {
    return this.issueMap.get(filePath) ?? [];
  }

  /** Find the first A11yDiagnostic whose range contains `position`. */
  getIssueAt(filePath: string, position: vscode.Position): A11yDiagnostic | undefined {
    return this.getIssues(filePath).find((d) => d.range.contains(position));
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private resolveEnginePath(): string {
    const cfg = vscode.workspace.getConfiguration("a11ySimulator");
    const custom = cfg.get<string>("enginePath", "");
    if (custom) {
      if (fs.existsSync(custom)) return custom;
      // Custom path was set but doesn't exist — warn loudly rather than silently falling back
      throw new Error(
        `a11ySimulator.enginePath is set to "${custom}" but that file does not exist. ` +
        `Clear the setting to use the bundled engine.`
      );
    }

    // Default: bundled engine shipped inside the installed extension
    const extensionRoot = this.context.extensionPath;
    const bundled = path.join(extensionRoot, "engine", "index.cjs");
    if (fs.existsSync(bundled)) return bundled;

    // Development fallback: sibling dist/ when running via F5 in the repo
    const devSibling = path.resolve(extensionRoot, "..", "dist", "index.js");
    if (fs.existsSync(devSibling)) return devSibling;

    throw new Error(
      "A11y Simulator engine is missing from this extension installation. " +
      "Reinstall the extension or rebuild the extension package. " +
      "(Expected: engine/index.cjs inside the extension folder)"
    );
  }

  private spawnEngine(
    enginePath: string,
    args: string[],
    cwd: string
  ): Promise<EngineOutput> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      const child = cp.spawn(process.execPath, [enginePath, ...args], {
        cwd,
        env: { ...process.env },
      });

      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.stderr.on("data", (d: Buffer) => errChunks.push(d));

      child.on("close", (code) => {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) {
          // Engine exited without JSON — surface stderr for diagnosis
          const err = Buffer.concat(errChunks).toString("utf8").trim();
          reject(new Error(`Engine produced no output (exit ${code}): ${err}`));
          return;
        }
        try {
          resolve(JSON.parse(raw) as EngineOutput);
        } catch {
          reject(new Error(`Engine output is not valid JSON: ${raw.slice(0, 200)}`));
        }
      });

      child.on("error", reject);
    });
  }

  private toDiagnostics(output: EngineOutput, filePath: string): A11yDiagnostic[] {
    return output.issues.map((issue) => {
      // Convert 1-based line to 0-based VS Code range
      const line = Math.max(0, (issue.line ?? 1) - 1);
      const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

      // Level A rules → Error severity; AA → Warning
      const severity =
        issue.ruleId.startsWith("1.") || ["2.1.1", "2.4.3", "4.1.2"].includes(issue.ruleId)
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;

      const personaEmoji =
        issue.persona === "Motor" ? "♿" :
        issue.persona === "Visual" ? "👁️" : "🌀";

      const diag = new vscode.Diagnostic(
        range,
        `${personaEmoji} ${issue.persona} — WCAG ${issue.ruleId}: ${issue.issue}`,
        severity
      ) as A11yDiagnostic;

      diag.source = `A11y Simulator (${issue.persona})`;
      diag.code = issue.ruleId;

      diag.a11y = {
        ruleId: issue.ruleId,
        persona: issue.persona,
        explanation: issue.explanation,
        diff: issue.diff,
        suggestedFix: issue.suggestedFix,
      };

      return diag;
    });
  }
}
