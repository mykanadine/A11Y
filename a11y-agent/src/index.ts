#!/usr/bin/env node
/**
 * A11y-Agent — unified entry point for both trigger modes.
 *
 * MODE 1 — GitHub Action (webhook trigger):
 *   Called by `npm start` from the CI workflow.
 *   All inputs come from environment variables injected by the Action runner.
 *
 * MODE 2 — CLI (local developer self-check):
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
 * Both modes call the identical run() function from the Orchestrator.
 * The --jira and --dry-run flags are forwarded via environment variables so
 * the Orchestrator signature stays stable (repo: string, prNumber: number).
 */
import { run } from "./agents/orchestrator.js";

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
  a11y-agent scan <PR-number> --repo <owner/repo> [--jira <TICKET-ID>] [--dry-run]

Options:
  --repo   <owner/repo>   GitHub repository (e.g. "acme/frontend")
  --jira   <TICKET-ID>    Override Jira ticket ID extracted from PR metadata
                          (e.g. "FRONT-1234"). Useful when the ticket ID is not
                          in the PR title, branch name, or body.
  --dry-run               Run all checks and print the report to stdout, but do
                          NOT post a comment on the PR. Safe for local testing.

Environment variables (alternative to flags):
  GITHUB_TOKEN            Required. Personal access token with repo + PR scopes.
  GITHUB_REPOSITORY       Repository in "owner/repo" format (set by Actions).
  PR_NUMBER               PR number (set by Actions, overridden by positional arg).
  A11Y_JIRA_OVERRIDE      Same as --jira.
  A11Y_DRY_RUN=1          Same as --dry-run.
  JIRA_BASE_URL           Jira instance base URL (e.g. https://acme.atlassian.net).
  JIRA_TOKEN              Jira API token.
  JIRA_USER_EMAIL         Email paired with the Jira token.
  DESIGN_SYSTEM_DOCS_URL  URL of the design system JSON manifest.
  WCAG_JSON_URL           URL of a custom WCAG 2.2 JSON index (optional).

See .env.example for a ready-to-copy local setup template.
`.trim());
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
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
