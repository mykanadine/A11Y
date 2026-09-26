"use strict";
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
exports.DiagnosticsProvider = void 0;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class DiagnosticsProvider {
    collection;
    context;
    // Map filePath → A11yDiagnostic[] for hover / code-action lookup
    issueMap = new Map();
    constructor(collection, context) {
        this.collection = collection;
        this.context = context;
    }
    /** Run the engine and return the populated diagnostics for this file. */
    async scan(filePath, jiraDocPath) {
        const enginePath = this.resolveEnginePath();
        const args = ["local", filePath, "--json"];
        if (jiraDocPath)
            args.push("--jira", jiraDocPath);
        const output = await this.spawnEngine(enginePath, args, path.dirname(filePath));
        const diagnostics = this.toDiagnostics(output, filePath);
        this.issueMap.set(filePath, diagnostics);
        this.collection.set(vscode.Uri.file(filePath), diagnostics);
        return diagnostics;
    }
    /** Retrieve cached diagnostics for a file (used by hover + code-action providers). */
    getIssues(filePath) {
        return this.issueMap.get(filePath) ?? [];
    }
    /** Find the first A11yDiagnostic whose range contains `position`. */
    getIssueAt(filePath, position) {
        return this.getIssues(filePath).find((d) => d.range.contains(position));
    }
    // ─── Private helpers ────────────────────────────────────────────────────────
    resolveEnginePath() {
        const cfg = vscode.workspace.getConfiguration("a11ySimulator");
        const custom = cfg.get("enginePath", "");
        if (custom && fs.existsSync(custom))
            return custom;
        // Default: sibling a11y-agent package relative to this extension's location
        const extensionRoot = this.context.extensionPath;
        const sibling = path.resolve(extensionRoot, "..", "..", "dist", "index.js");
        if (fs.existsSync(sibling))
            return sibling;
        throw new Error("a11y-agent engine not found. Set a11ySimulator.enginePath in settings, " +
            "or ensure a11y-agent/dist/index.js exists alongside the extension.");
    }
    spawnEngine(enginePath, args, cwd) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            const errChunks = [];
            const child = cp.spawn(process.execPath, [enginePath, ...args], {
                cwd,
                env: { ...process.env },
            });
            child.stdout.on("data", (d) => chunks.push(d));
            child.stderr.on("data", (d) => errChunks.push(d));
            child.on("close", (code) => {
                const raw = Buffer.concat(chunks).toString("utf8").trim();
                if (!raw) {
                    // Engine exited without JSON — surface stderr for diagnosis
                    const err = Buffer.concat(errChunks).toString("utf8").trim();
                    reject(new Error(`Engine produced no output (exit ${code}): ${err}`));
                    return;
                }
                try {
                    resolve(JSON.parse(raw));
                }
                catch {
                    reject(new Error(`Engine output is not valid JSON: ${raw.slice(0, 200)}`));
                }
            });
            child.on("error", reject);
        });
    }
    toDiagnostics(output, filePath) {
        return output.issues.map((issue) => {
            // Convert 1-based line to 0-based VS Code range
            const line = Math.max(0, (issue.line ?? 1) - 1);
            const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
            // Level A rules → Error severity; AA → Warning
            const severity = issue.ruleId.startsWith("1.") || ["2.1.1", "2.4.3", "4.1.2"].includes(issue.ruleId)
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning;
            const personaEmoji = issue.persona === "Motor" ? "♿" :
                issue.persona === "Visual" ? "👁️" : "🌀";
            const diag = new vscode.Diagnostic(range, `${personaEmoji} ${issue.persona} — WCAG ${issue.ruleId}: ${issue.issue}`, severity);
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
exports.DiagnosticsProvider = DiagnosticsProvider;
//# sourceMappingURL=diagnostics.js.map