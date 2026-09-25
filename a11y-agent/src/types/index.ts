// ─── Shared type contracts across all A11y-Agent subagents ───────────────────

export interface PRContext {
  prNumber: number;
  repo: string;          // "owner/repo"
  headSha: string;
  baseSha: string;
  jiraTicketId: string | null;
  changedFiles: ChangedFile[];
}

export interface ChangedFile {
  path: string;          // e.g. "src/components/Button.tsx"
  patch: string;         // raw unified diff
  rawUrl: string;        // URL to fetch full file content at headSha
}

export interface UIComponent {
  filePath: string;
  componentName: string;
  compiledHTML: string;  // rendered DOM snapshot (HTML string)
  sourceCode: string;    // original source for patch generation
}

// ─── Rule Engine ─────────────────────────────────────────────────────────────

export interface ComplianceContext {
  applicableRules: WCAGRule[];
  designSystemNotes: string[];
  jiraAcceptanceCriteria: string[];
  /** Jira ticket summary / component intent (Phase 2+) */
  componentIntent?: string;
  /**
   * WCAG rules pre-partitioned by persona so each runPersona() call
   * only receives rules that are relevant to it.
   */
  rulesByPersona?: RulesByPersona;
  /**
   * Design-system-safe colours, spacing tokens, and component names
   * for the Debugger to use when suggesting replacements.
   */
  approvedFixPalette?: ApprovedFixPalette;
}

export interface RulesByPersona {
  motor: WCAGRule[];        // keyboard, focus order, ARIA, alt text, semantic roles
  visual: WCAGRule[];       // contrast ratios, colour-blindness-safe indicators (CSS/colour only)
  vestibular: WCAGRule[];   // auto-play, carousel, transition/motion only
}

export interface ApprovedFixPalette {
  /** Hex values from the design system that are guaranteed AA-contrast-safe */
  colors: DesignSystemColor[];
  /** Named spacing tokens (e.g. "space-2": "0.5rem") */
  spacingTokens: Record<string, string>;
  /** Approved component names from the internal component library */
  componentNames: string[];
}

export interface DesignSystemColor {
  token: string;            // e.g. "color-text-primary"
  hex: string;              // e.g. "#1a1a2e"
  contrastOnWhite: number;  // computed ratio against #ffffff
  contrastOnBlack: number;  // computed ratio against #000000
  wcagAA: boolean;          // contrastOnWhite or contrastOnBlack ≥ 4.5
}

export interface WCAGRule {
  id: string;            // e.g. "1.4.3"
  level: "A" | "AA" | "AAA";
  title: string;
  description: string;
  relevantTo: PersonaType[];
}

// ─── Persona Testing ─────────────────────────────────────────────────────────

export type PersonaType = "Motor" | "Visual" | "Vestibular/Cognitive";

export interface PersonaReport {
  persona: PersonaType;
  results: TestResult[];
}

export interface TestResult {
  status: "pass" | "fail";
  ruleId: string;
  filePath: string;
  line: number | null;
  issue: string;
  suggestedFix: string;
}

// ─── Debugger ────────────────────────────────────────────────────────────────

export interface CodePatch {
  filePath: string;
  line: number | null;
  originalSnippet: string;
  patchedSnippet: string;
  diff: string;          // unified diff ready to apply with `git apply`
  /** One-sentence plain-English explanation for the PR comment (teaches the WCAG rule) */
  explanation: string;
}

export interface FailureWithPatch extends TestResult {
  persona: PersonaType;
  patch: CodePatch;
}

// ─── Final output ─────────────────────────────────────────────────────────────

export interface OrchestratorResult {
  prNumber: number;
  repo: string;
  testedComponents: string[];
  failures: FailureWithPatch[];
  passCount: number;
  failCount: number;
  prCommentMarkdown: string;
}
