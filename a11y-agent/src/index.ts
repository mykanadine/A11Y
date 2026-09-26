#!/usr/bin/env node
/**
 * A11y-Agent — unified entry point for all trigger modes.
 *
 * MODE 1 — GitHub Action (webhook trigger):
 *   Called by `npm start` from the CI workflow.
 *   All inputs come from environment variables injected by the Action runner.
 *
 * MODE 2 — PR scan (local developer self-check):
 *   a11y-agent scan <PR-number> [options]
 *
 *   Options:
 *     --repo   <owner/repo>   Repository to scan (defaults to GITHUB_REPOSITORY env var)
 *     --jira   <TICKET-ID>    Override Jira ticket ID (skips auto-extraction from PR metadata)
 *     --dry-run               Print the report to stdout without posting a PR comment
 *
 *   Examples:
 *     a11y-agent scan 42 --repo acme/frontend
 *     a11y-agent scan 42 --repo acme/frontend --jira FRONT-1234
 *     a11y-agent scan 42 --repo acme/frontend --dry-run
 *
 * MODE 3 — Local file scan (no GitHub required):
 *   a11y-agent local <file-path> [options]
 *
 *   Options:
 *     --jira   <doc-path>   Path to a local Jira Markdown spec (e.g. CHKT-104.md)
 *     --json                Emit results as JSON (used by the IDE extension)
 *
 *   Examples:
 *     a11y-agent local src/CheckoutPage.jsx
 *     a11y-agent local src/CheckoutPage.jsx --jira docs/CHKT-104.md
 *     a11y-agent local src/CheckoutPage.jsx --json
 *
 * Modes 2 & 3 call identical shared sub-engines (rule-engine, personas, debugger).
 */
import { run } from "./agents/orchestrator.js";
import { scanLocalFiles } from "./local-scanner.js";

// Automatically load .env if present
try {
  (process as unknown as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // Ignore when .env doesn't exist
}

// ─── Argument parsing ─────────────────────────────────────────────────────────

interface ParsedArgs {
  prNumber: number;
  repo: string;
  jiraOverride: string | null;
  dryRun: boolean;
}

function parseArgs(): ParsedArgs | null {
  const args = process.argv.slice(2);

  // ── Named flag helpers ─────────────────────────────────────────────────────
  function flag(name: string): string | null {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] ?? null : null;
  }
  function boolFlag(name: string): boolean {
    return args.includes(name);
  }

  // ── PR number: positional after "scan", or PR_NUMBER env var ──────────────
  const scanIdx = args.indexOf("scan");
  const prRaw =
    scanIdx !== -1 && args[scanIdx + 1]
      ? args[scanIdx + 1]
      : process.env.PR_NUMBER ?? "";
  const prNumber = parseInt(prRaw ?? "", 10);

  // ── Repo: --repo flag, or GITHUB_REPOSITORY env var ───────────────────────
  const repo = flag("--repo") ?? process.env.GITHUB_REPOSITORY ?? "";

  // ── Optional flags ─────────────────────────────────────────────────────────
  const jiraOverride = flag("--jira") ?? process.env.A11Y_JIRA_OVERRIDE ?? null;
  const dryRun = boolFlag("--dry-run") || process.env.A11Y_DRY_RUN === "1";

  if (!repo || isNaN(prNumber)) {
    return null;
  }

  return { prNumber, repo, jiraOverride, dryRun };
}

function printUsage(): void {
  console.error(`
A11y-Agent — Shift-Left Accessibility Simulator

Usage:
  a11y-agent scan  <PR-number> --repo <owner/repo> [--jira <TICKET-ID>] [--dry-run]
  a11y-agent local <file-path> [--jira <doc-path>] [--json]

Commands:
  scan   Fetch a GitHub PR, run all checks, and post an accessibility report as a PR comment.
  local  Scan a local source file directly — no GitHub token required.

scan options:
  --repo   <owner/repo>   GitHub repository (e.g. "acme/frontend")
  --jira   <TICKET-ID>    Override Jira ticket ID extracted from PR metadata
  --dry-run               Print the report to stdout, do NOT post a PR comment

local options:
  --jira   <doc-path>     Path to a local Jira Markdown spec (e.g. CHKT-104.md)
  --json                  Emit results as a JSON object (used by the IDE extension)

Environment variables:
  GITHUB_TOKEN            Required for 'scan'. Personal access token with repo + PR scopes.
  GITHUB_REPOSITORY       Repository in "owner/repo" format (set by Actions).
  PR_NUMBER               PR number (set by Actions, overridden by positional arg).
  A11Y_JIRA_OVERRIDE      Same as --jira (scan mode).
  A11Y_DRY_RUN=1          Same as --dry-run.
  JIRA_BASE_URL           Jira instance URL (e.g. https://acme.atlassian.net).
  JIRA_TOKEN              Jira API token.
  JIRA_USER_EMAIL         Email paired with the Jira token.
  DESIGN_SYSTEM_DOCS_URL  URL of the design system JSON manifest.
  WCAG_JSON_URL           URL of a custom WCAG 2.2 JSON index (optional).

See .env.example for a ready-to-copy local setup template.
`.trim());
}

// ─── Local scan handler ────────────────────────────────────────────────────────

async function runLocalScan(): Promise<void> {
  const args = process.argv.slice(2);

  function flag(name: string): string | null {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] ?? null : null;
  }
  function boolFlag(name: string): boolean {
    return args.includes(name);
  }

  // Positional: `local <file-path>`
  const localIdx = args.indexOf("local");
  const filePath = localIdx !== -1 ? args[localIdx + 1] : null;

  if (!filePath || filePath.startsWith("--")) {
    console.error("Error: `local` requires a file path.\n  Usage: a11y-agent local <file-path> [--jira <doc>]");
    process.exit(1);
  }

  const jiraDocPath = flag("--jira") ?? undefined;
  const jsonMode = boolFlag("--json");

  // In JSON mode all progress logs must go to stderr so stdout stays clean JSON
  if (jsonMode) process.env.A11Y_QUIET = "1";

  if (!jsonMode) {
    console.log(`[A11y-Agent] Mode   : Local scan`);
    console.log(`[A11y-Agent] File   : ${filePath}`);
    if (jiraDocPath) console.log(`[A11y-Agent] Jira   : ${jiraDocPath}`);
    console.log("");
  }

  try {
    const result = await scanLocalFiles({ filePaths: [filePath], jiraDocPath });

    if (jsonMode) {
      // Structured output for IDE extension consumption
      process.stdout.write(
        JSON.stringify({
          passCount: result.passCount,
          failCount: result.failCount,
          issues: result.failures.map((f) => ({
            filePath: f.filePath,
            line: f.line,
            ruleId: f.ruleId,
            persona: f.persona,
            issue: f.issue,
            suggestedFix: f.suggestedFix,
            explanation: f.patch.explanation,
            diff: f.patch.diff,
          })),
        }) + "\n"
      );
    } else {
      console.log("─────────────────────────────────────────────────────────");
      console.log(`  Scan complete : ${filePath}`);
      console.log(`  Passed        : ${result.passCount}`);
      console.log(`  Failed        : ${result.failCount}`);
      console.log("─────────────────────────────────────────────────────────");
      console.log("");
      console.log(result.report);
    }

    process.exit(result.failCount > 0 ? 1 : 0);
  } catch (err) {
    console.error("[A11y-Agent] Fatal error:", err);
    process.exit(2);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Route to local scanner if first argument is "local"
  if (args[0] === "local") {
    await runLocalScan();
    return;
  }

  const parsed = parseArgs();

  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { prNumber, repo, jiraOverride, dryRun } = parsed;

  // Forward optional flags as env vars so the Orchestrator can read them
  // without changing its (repo, prNumber) signature.
  if (jiraOverride) process.env.A11Y_JIRA_OVERRIDE = jiraOverride;
  if (dryRun) process.env.A11Y_DRY_RUN = "1";

  if (!process.env.GITHUB_TOKEN) {
    console.error(
      "Error: GITHUB_TOKEN is required.\n" +
      "Set it via: export GITHUB_TOKEN=ghp_..."
    );
    process.exit(1);
  }

  // ── Mode banner ─────────────────────────────────────────────────────────────
  const mode = process.env.CI ? "GitHub Action" : "CLI";
  console.log(`[A11y-Agent] Mode        : ${mode}`);
  console.log(`[A11y-Agent] Repository  : ${repo}`);
  console.log(`[A11y-Agent] PR          : #${prNumber}`);
  if (jiraOverride) console.log(`[A11y-Agent] Jira        : ${jiraOverride} (override)`);
  if (dryRun)       console.log(`[A11y-Agent] Dry-run     : ON (no PR comment will be posted)`);
  console.log("");

  try {
    const result = await run(repo, prNumber);

    // ── Summary output ───────────────────────────────────────────────────────
    console.log("─────────────────────────────────────────────────────────");
    console.log(`  Scan complete : ${repo}#${prNumber}`);
    console.log(`  UI files      : ${result.testedComponents.length} component(s) tested`);
    console.log(`  Passed        : ${result.passCount}`);
    console.log(`  Failed        : ${result.failCount}`);
    console.log("─────────────────────────────────────────────────────────");

    if (dryRun && result.prCommentMarkdown) {
      console.log("\n── Dry-run report (would be posted as PR comment) ────────\n");
      console.log(result.prCommentMarkdown);
      console.log("\n───────────────────────────────────────────────────────────\n");
    }

    // Exit 1 when failures found — lets CI gate the PR merge
    process.exit(result.failCount > 0 ? 1 : 0);
  } catch (err) {
    console.error("[A11y-Agent] Fatal error:", err);
    process.exit(2);
  }
}

main();
