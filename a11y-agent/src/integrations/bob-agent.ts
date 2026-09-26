/**
 * IBM Bob 2.0 Agent Integration
 *
 * Exposes the A11y engine as a Bob tool that can be invoked:
 *   - Conversationally: "@a11y audit CheckoutPage.jsx"
 *   - Via slash command:  "/a11y-scan"
 *
 * Bob calls runBobA11yTool() with the parsed arguments.
 * The function returns a BobToolResponse whose `diffBlocks` array drives
 * Bob's native Review Mode (red/green diff viewer with Accept/Reject buttons).
 *
 * Document Understanding integration:
 *   Pass the raw Jira markdown text Bob already read from disk as
 *   `jiraMarkdown`. The local scanner will parse acceptance criteria
 *   from it without making a network call.
 */

import { scanLocalFiles } from "../local-scanner.js";
import { FailureWithPatch } from "../types/index.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BobToolInput {
  /** Path to the UI source file to audit (relative to workspace root). */
  filePath: string;
  /**
   * Raw Jira ticket Markdown — populated by Bob's Document Understanding
   * when the user has a spec doc open or referenced in the conversation.
   */
  jiraMarkdown?: string;
  /**
   * Path to a Jira Markdown spec file on disk.
   * Used when jiraMarkdown is not already available in context.
   */
  jiraTicketPath?: string;
}

/**
 * A single colored diff block surfaced to Bob's Review Mode.
 * Bob renders `diff` as a side-by-side red/green viewer with
 * [Accept] and [Reject] buttons.
 */
export interface BobDiffBlock {
  /** Workspace-relative file path. */
  filePath: string;
  /** Source line number where the issue starts. */
  line: number | null;
  /** WCAG rule ID, e.g. "4.1.2" */
  ruleId: string;
  /** Human-readable persona label. */
  persona: string;
  /** One-sentence plain-English explanation (teaches the WCAG rule). */
  explanation: string;
  /** Unified diff ready for `git apply` and Bob's diff viewer. */
  diff: string;
  /** Short label for the Accept button. */
  acceptLabel: string;
}

export interface BobToolResponse {
  /** Markdown summary streamed into the Bob chat panel. */
  summary: string;
  /** Diff blocks for Bob's Review Mode — one per failure. */
  diffBlocks: BobDiffBlock[];
  /** Raw pass/fail counts. */
  passCount: number;
  failCount: number;
}

// ─── Formatter ────────────────────────────────────────────────────────────────

function formatSummary(
  filePath: string,
  passCount: number,
  failures: FailureWithPatch[]
): string {
  if (failures.length === 0) {
    return [
      `## ✅ A11y Audit: \`${filePath}\` — All Clear`,
      "",
      `Ran **${passCount + failures.length}** checks across Motor, Visual, and Vestibular/Cognitive personas.`,
      "No accessibility issues found.",
    ].join("\n");
  }

  const issueList = failures
    .map(
      (f, i) =>
        `${i + 1}. **${f.persona}** — ${f.issue}  \n` +
        `   \`${f.filePath}${f.line ? `:${f.line}` : ""}\`  \n` +
        `   > ${f.patch.explanation}`
    )
    .join("\n\n");

  return [
    `## ⚠️ A11y Audit: \`${filePath}\` — ${failures.length} Issue${failures.length !== 1 ? "s" : ""} Found`,
    "",
    `Checked **${passCount + failures.length}** rules (${passCount} passed, **${failures.length} failed**).`,
    "Bob has prepared a colored diff for each issue below.",
    "Use **[Accept]** to apply the patch, or **[Reject]** to dismiss.",
    "",
    "### Issues",
    "",
    issueList,
  ].join("\n");
}

function toDiffBlock(failure: FailureWithPatch): BobDiffBlock {
  return {
    filePath: failure.filePath,
    line: failure.line,
    ruleId: failure.ruleId,
    persona: failure.persona,
    explanation: failure.patch.explanation,
    diff: failure.patch.diff,
    acceptLabel: `Fix WCAG ${failure.ruleId}: ${failure.suggestedFix.slice(0, 60)}${failure.suggestedFix.length > 60 ? "…" : ""}`,
  };
}

// ─── Main tool entry point ────────────────────────────────────────────────────

/**
 * Called by Bob Agent Mode when the user runs `@a11y audit <file>` or `/a11y-scan`.
 *
 * Bob streams progress messages by awaiting this function — the console.log
 * calls below map to Bob's streaming output panel in the order they appear.
 */
export async function runBobA11yTool(
  input: BobToolInput
): Promise<BobToolResponse> {
  const { filePath, jiraMarkdown, jiraTicketPath } = input;

  console.log(`[A11y Bob Tool] Scanning: ${filePath}`);
  if (jiraMarkdown || jiraTicketPath) {
    console.log(
      `[A11y Bob Tool] Jira context: ${jiraTicketPath ?? "(inline markdown)"}`
    );
  }
  console.log(
    "[A11y Bob Tool] Spinning up Motor, Visual, and Vestibular/Cognitive subagents…"
  );

  const result = await scanLocalFiles({
    filePaths: [filePath],
    jiraDocPath: jiraTicketPath,
    jiraMarkdown,
  });

  console.log(
    `[A11y Bob Tool] Complete — ${result.passCount} passed, ${result.failCount} failed.`
  );

  const summary = formatSummary(filePath, result.passCount, result.failures);
  const diffBlocks = result.failures.map(toDiffBlock);

  return {
    summary,
    diffBlocks,
    passCount: result.passCount,
    failCount: result.failCount,
  };
}
