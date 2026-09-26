/**
 * Local File Scanner — scan files on disk without a GitHub PR context.
 *
 * Used by:
 *   - CLI:  `node dist/index.js local <file> [--jira <doc>]`
 *   - Bob Agent tool (bob-agent.ts)
 *   - IDE extension (extension/src/scanner.ts)
 *
 * Jira acceptance criteria can be supplied either as:
 *   - A plain Markdown file on disk (jiraDocPath)
 *   - An inline string (jiraMarkdown) — used by the Bob agent when it
 *     passes the document text it already read via Document Understanding.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  UIComponent,
  FailureWithPatch,
  PersonaReport,
  PersonaType,
  TestResult,
} from "./types/index.js";
import { runRuleEngine } from "./agents/rule-engine.js";
import { runPersona } from "./agents/persona.js";
import { runDebugger } from "./agents/debugger.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LocalScanOptions {
  /** Absolute or relative paths to the UI source files to audit. */
  filePaths: string[];
  /** Path to a local Jira Markdown spec (e.g. CHKT-104.md). Optional. */
  jiraDocPath?: string;
  /**
   * Raw Jira Markdown content — alternative to jiraDocPath.
   * When both are provided, jiraMarkdown takes precedence.
   */
  jiraMarkdown?: string;
}

export interface LocalScanResult {
  testedComponents: string[];
  failures: FailureWithPatch[];
  passCount: number;
  failCount: number;
  /** Formatted terminal/markdown report (same structure as PR comment). */
  report: string;
}

// ─── Jira markdown parser ─────────────────────────────────────────────────────

/**
 * Extract acceptance criteria from a Markdown Jira spec.
 * Looks for an "Acceptance Criteria" heading and collects bullet lines below it.
 */
function parseJiraMarkdown(markdown: string): {
  ticketId: string | null;
  acceptanceCriteria: string[];
  summary: string;
} {
  const ticketMatch = markdown.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  const ticketId = ticketMatch?.[1] ?? null;

  // Extract h1/h2 title as summary (first non-empty heading line)
  const summaryMatch = markdown.match(/^#{1,2}\s+(.+)/m);
  const summary = summaryMatch?.[1]?.trim() ?? "";

  // Find acceptance criteria section — anything after an "Acceptance Criteria" heading
  const acSection = markdown.match(
    /#+\s+Acceptance Criteria[\s\S]*?(?=\n#+\s|\s*$)/i
  )?.[0] ?? "";

  const acceptanceCriteria = acSection
    .split("\n")
    .filter((l) => /^[-*+]\s/.test(l.trim()))
    .map((l) => l.replace(/^[-*+]\s+/, "").trim())
    .filter(Boolean);

  return { ticketId, acceptanceCriteria, summary };
}

// ─── Component builder ────────────────────────────────────────────────────────

/** Read a source file from disk and wrap it into a UIComponent. */
async function fileToComponent(filePath: string): Promise<UIComponent> {
  const absPath = path.resolve(filePath);
  const sourceCode = await fs.readFile(absPath, "utf8");
  const componentName =
    path.basename(absPath).replace(/\.[^.]+$/, "") || absPath;

  // Minimal HTML snapshot — same pattern as the orchestrator stub.
  // A real headless renderer would replace this.
  const compiledHTML = `<!-- local snapshot: ${filePath} -->\n${sourceCode}`;

  return { filePath, componentName, compiledHTML, sourceCode };
}

// ─── Report builder ───────────────────────────────────────────────────────────

function buildLocalReport(failures: FailureWithPatch[]): string {
  if (failures.length === 0) {
    return "✅  A11y-Agent: All accessibility checks passed.";
  }

  const lines: string[] = [
    `⚠️  A11y-Agent: ${failures.length} issue${failures.length !== 1 ? "s" : ""} found\n`,
    "Persona | File:Line | Issue | Suggested Fix",
    "--------|-----------|-------|---------------",
  ];

  for (const f of failures) {
    const loc = f.line ? `${f.filePath}:${f.line}` : f.filePath;
    lines.push(`${f.persona} | ${loc} | ${f.issue} | ${f.suggestedFix}`);
    if (f.patch.diff) {
      lines.push("```diff");
      lines.push(f.patch.diff);
      lines.push("```");
    }
  }

  return lines.join("\n");
}

// ─── Core scanner ─────────────────────────────────────────────────────────────

export async function scanLocalFiles(
  options: LocalScanOptions
): Promise<LocalScanResult> {
  const { filePaths, jiraDocPath, jiraMarkdown: inlineMarkdown } = options;

  // ── Resolve Jira markdown ─────────────────────────────────────────────────
  let jiraText: string | null = null;
  if (inlineMarkdown) {
    jiraText = inlineMarkdown;
  } else if (jiraDocPath) {
    jiraText = await fs.readFile(path.resolve(jiraDocPath), "utf8");
  }

  const jiraInfo = jiraText ? parseJiraMarkdown(jiraText) : null;

  // Inject acceptance criteria so runRuleEngine can read them from the env
  // (same channel used by the Jira API path, keeps RuleEngine API stable).
  if (jiraInfo?.acceptanceCriteria.length) {
    process.env.A11Y_LOCAL_AC = JSON.stringify(jiraInfo.acceptanceCriteria);
  }
  if (jiraInfo?.summary) {
    process.env.A11Y_LOCAL_INTENT = jiraInfo.summary;
  }

  // ── Build UIComponent list ────────────────────────────────────────────────
  const components = await Promise.all(filePaths.map(fileToComponent));

  // ── Rule Engine ───────────────────────────────────────────────────────────
  const complianceContext = await runRuleEngine({
    components,
    jiraTicketId: jiraInfo?.ticketId ?? null,
  });

  // ── Three personas in parallel ────────────────────────────────────────────
  const personaTypes: PersonaType[] = ["Motor", "Visual", "Vestibular/Cognitive"];
  const personaReports: PersonaReport[] = await Promise.all(
    personaTypes.map((persona) =>
      runPersona({ persona, components, complianceContext })
    )
  );

  // ── Merge results ─────────────────────────────────────────────────────────
  const allResults: Array<TestResult & { persona: PersonaType }> =
    personaReports.flatMap((r) =>
      r.results.map((res) => ({ ...res, persona: r.persona }))
    );

  const rawFailures = allResults.filter((r) => r.status === "fail");
  const passCount = allResults.filter((r) => r.status === "pass").length;

  // ── Debugger — patch each failure ────────────────────────────────────────
  const failures: FailureWithPatch[] = await Promise.all(
    rawFailures.map(async (failure) => {
      const component = components.find((c) => c.filePath === failure.filePath);
      const patch = await runDebugger({
        failure,
        component,
        approvedFixPalette: complianceContext.approvedFixPalette,
        componentIntent: complianceContext.componentIntent,
      });
      return { ...failure, patch };
    })
  );

  return {
    testedComponents: components.map((c) => c.filePath),
    failures,
    passCount,
    failCount: failures.length,
    report: buildLocalReport(failures),
  };
}
