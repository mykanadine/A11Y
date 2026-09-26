import {
  PRContext,
  ChangedFile,
  UIComponent,
  ComplianceContext,
  PersonaReport,
  FailureWithPatch,
  OrchestratorResult,
  PersonaType,
  TestResult,
} from "../types/index.js";

// ─── Subagent stubs (each lives in its own file; imported here for wiring) ───
// These will be replaced by real implementations in subsequent phases.
import { runRuleEngine } from "./rule-engine.js";
import { runPersona } from "./persona.js";
import { runDebugger } from "./debugger.js";

// ─── GitHub API helpers ────────────────────────────────────────────────────────

const GH_API = "https://api.github.com";
const GH_TOKEN = process.env.GITHUB_TOKEN ?? "";

async function ghFetch(path: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN || GH_TOKEN;
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
  return res;
}

// ─── Step 1: Build PR context ──────────────────────────────────────────────────

/** Fetch PR metadata and diff from GitHub. */
async function buildPRContext(repo: string, prNumber: number): Promise<PRContext> {
  const [prRes, filesRes] = await Promise.all([
    ghFetch(`/repos/${repo}/pulls/${prNumber}`),
    ghFetch(`/repos/${repo}/pulls/${prNumber}/files`),
  ]);

  const pr = await prRes.json();
  const files: Array<{ filename: string; patch?: string; raw_url: string }> =
    await filesRes.json();

  // Extract Jira ticket ID — checked in priority order:
  //   1. CLI --jira override (A11Y_JIRA_OVERRIDE env var)
  //   2. PR title  (smart-commit convention: "FRONT-1234 Add accessible button")
  //   3. PR body   (Jira auto-link or manual reference)
  //   4. Branch name (feature/FRONT-1234-add-button)
  const jiraPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/;
  const jiraTicketId =
    process.env.A11Y_JIRA_OVERRIDE?.match(jiraPattern)?.[1] ??
    (pr.title ?? "").match(jiraPattern)?.[1] ??
    (pr.body ?? "").match(jiraPattern)?.[1] ??
    (pr.head?.ref ?? "").match(jiraPattern)?.[1] ??
    null;

  const changedFiles: ChangedFile[] = files.map((f) => ({
    path: f.filename,
    patch: f.patch ?? "",
    rawUrl: f.raw_url,
  }));

  return {
    prNumber,
    repo,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    jiraTicketId,
    changedFiles,
  };
}

// ─── Step 2: Identify UI components ───────────────────────────────────────────

const UI_FILE_PATTERN = /\.(tsx?|jsx?|html|css|scss|svg)$/i;

/** Filter changed files to only those that contain UI components. */
function identifyUIFiles(changedFiles: ChangedFile[]): ChangedFile[] {
  return changedFiles.filter((f) => UI_FILE_PATTERN.test(f.path));
}

// ─── Step 3: Compile / render components ──────────────────────────────────────

/**
 * Fetch each UI file's source at headSha and render it to an HTML snapshot.
 *
 * Real implementation delegates to a headless renderer (Playwright/Storybook).
 * The stub below fetches raw source for wiring purposes.
 */
async function compileComponents(
  uiFiles: ChangedFile[],
  headSha: string
): Promise<UIComponent[]> {
  const components = await Promise.all(
    uiFiles.map(async (file) => {
      const sourceCode = await fetch(file.rawUrl).then((r) => r.text());

      // TODO: Replace this stub with a call to the headless renderer.
      // The renderer receives sourceCode + headSha and returns a full DOM
      // snapshot. See docs/renderer.md for the expected interface.
      const compiledHTML = `<!-- rendered snapshot of ${file.path} at ${headSha} -->\n${sourceCode}`;

      // Derive component name from filename (e.g. "Button.tsx" → "Button")
      const componentName = file.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file.path;

      return { filePath: file.path, componentName, compiledHTML, sourceCode };
    })
  );
  return components;
}

// ─── Step 5: Merge persona reports ────────────────────────────────────────────

function mergePersonaReports(
  reports: PersonaReport[]
): Array<TestResult & { persona: PersonaType }> {
  return reports.flatMap((report) =>
    report.results.map((r) => ({ ...r, persona: report.persona }))
  );
}

// ─── Step 7: Build PR comment markdown ────────────────────────────────────────

function buildPRComment(failures: FailureWithPatch[], repo: string, prNumber: number): string {
  if (failures.length === 0) {
    return `## ✅ A11y-Agent: All Accessibility Checks Passed\n\nNo issues found across Motor, Visual, and Vestibular/Cognitive personas.`;
  }

  // Each failure gets:
  //   1. A blockquote explanation line (teaches the WCAG rule)
  //   2. A table row with Accept Fix link
  const sections = failures.map((f, i) => {
    const fileLine = f.line ? `\`${f.filePath}:${f.line}\`` : `\`${f.filePath}\``;
    const fix = f.suggestedFix.replace(/\|/g, "\\|").replace(/\n/g, " ");
    // Accept Fix: opens a pre-filled PR review comment with the unified diff body,
    // which the developer can submit to trigger the apply-patch workflow.
    const acceptUrl =
      `https://github.com/${repo}/issues/new` +
      `?title=${encodeURIComponent(`a11y-fix: ${f.filePath} — WCAG ${f.ruleId}`)}` +
      `&body=${encodeURIComponent(
        `<!-- A11y-Agent auto-patch: apply with \`git apply\` -->\n\`\`\`diff\n${f.patch.diff}\n\`\`\``
      )}`;
    const row = `| ${f.persona} | ${f.issue} | ${fileLine} | ${fix} | [Accept Fix ↗](${acceptUrl}) |`;
    // Explanation line above the row — indented as a blockquote so it renders
    // visually attached to its row without breaking the table.
    const explanation = `> **Fix ${i + 1}:** ${f.patch.explanation}`;
    return `${explanation}\n${row}`;
  });

  // The table header is emitted once; explanation blockquotes live between rows.
  // GitHub Markdown renders blockquotes outside table cells, so we interleave
  // the header+separator once and then each explanation+row pair.
  const header = [
    "| Persona | Issue | File:Line | Suggested Fix | Accept Fix |",
    "|---------|-------|-----------|---------------|------------|",
  ].join("\n");

  return [
    `## ⚠️ A11y-Agent: ${failures.length} Accessibility Issue${failures.length !== 1 ? "s" : ""} Found`,
    "",
    header,
    sections.join("\n"),
    "",
    `<sub>Generated by [A11y-Agent](https://github.com/${repo}) — Shift-Left Accessibility Simulator</sub>`,
  ].join("\n");
}

// ─── Step 7: Post comment to PR ───────────────────────────────────────────────

async function postPRComment(repo: string, prNumber: number, body: string): Promise<void> {
  // Dry-run mode: skip the HTTP call; the CLI entry point prints the markdown instead.
  if (process.env.A11Y_DRY_RUN === "1") {
    console.log("[Orchestrator] Dry-run: PR comment suppressed.");
    return;
  }
  const token = process.env.GITHUB_TOKEN || GH_TOKEN;
  const res = await fetch(`${GH_API}/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Failed to post PR comment: ${res.status}`);
  console.log("[Orchestrator] PR comment posted.");
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * run() is the single entry point called by both:
 *   - the GitHub Action (webhook trigger)
 *   - the CLI (`a11y-agent scan <PR-number>`)
 *
 * Execution order:
 *   1. Pull PR context + identify UI files
 *   2. Compile/render affected components
 *   3. Rule Engine (sequential — must complete before testing starts)
 *   4. Three Persona agents IN PARALLEL
 *   5. Collect + merge all reports
 *   6. Debugger for each failure (parallelised per failure)
 *   7. Post single consolidated PR comment
 */
export async function run(repo: string, prNumber: number): Promise<OrchestratorResult> {
  console.log(`[Orchestrator] Starting scan: ${repo}#${prNumber}`);

  // ── 1. PR context + UI file identification ────────────────────────────────
  const prContext = await buildPRContext(repo, prNumber);
  const uiFiles = identifyUIFiles(prContext.changedFiles);

  if (uiFiles.length === 0) {
    console.log("[Orchestrator] No UI files changed. Skipping accessibility scan.");
    const comment = "## ✅ A11y-Agent: No UI files changed — scan skipped.";
    await postPRComment(repo, prNumber, comment);
    return {
      prNumber,
      repo,
      testedComponents: [],
      failures: [],
      passCount: 0,
      failCount: 0,
      prCommentMarkdown: comment,
    };
  }

  // ── 2. Compile / render affected components ───────────────────────────────
  console.log(`[Orchestrator] Compiling ${uiFiles.length} UI file(s)…`);
  const components = await compileComponents(uiFiles, prContext.headSha);

  // ── 3. Rule Engine (BLOCKING — must complete before Personas start) ───────
  console.log("[Orchestrator] Running Rule Engine…");
  const complianceContext: ComplianceContext = await runRuleEngine({
    components,
    jiraTicketId: prContext.jiraTicketId,
  });
  console.log(`[Orchestrator] Rule Engine returned ${complianceContext.applicableRules.length} applicable rules.`);

  // ── 4. Three Persona agents IN PARALLEL ───────────────────────────────────
  console.log("[Orchestrator] Launching Motor, Visual, and Vestibular/Cognitive personas in parallel…");
  const personaTypes: PersonaType[] = ["Motor", "Visual", "Vestibular/Cognitive"];
  const personaReports: PersonaReport[] = await Promise.all(
    personaTypes.map((persona) =>
      runPersona({ persona, components, complianceContext })
    )
  );

  // ── 5. Collect + merge all reports ───────────────────────────────────────
  const allResults = mergePersonaReports(personaReports);
  const failures = allResults.filter((r) => r.status === "fail");
  const passCount = allResults.filter((r) => r.status === "pass").length;

  console.log(`[Orchestrator] Testing complete. ${passCount} passed, ${failures.length} failed.`);

  // ── 6. Debugger — one patch per failure, parallelised ────────────────────
  console.log("[Orchestrator] Generating patches for failures…");
  const failuresWithPatches: FailureWithPatch[] = await Promise.all(
    failures.map(async (failure) => {
      const component = components.find((c) => c.filePath === failure.filePath);
      const patch = await runDebugger({
        failure,
        component,
        // Thread Rule Engine context through to the Debugger
        approvedFixPalette: complianceContext.approvedFixPalette,
        componentIntent: complianceContext.componentIntent,
      });
      return { ...failure, patch };
    })
  );

  // ── 7. Post consolidated PR comment ──────────────────────────────────────
  const prCommentMarkdown = buildPRComment(failuresWithPatches, repo, prNumber);
  await postPRComment(repo, prNumber, prCommentMarkdown);

  return {
    prNumber,
    repo,
    testedComponents: components.map((c) => c.filePath),
    failures: failuresWithPatches,
    passCount,
    failCount: failures.length,
    prCommentMarkdown,
  };
}
