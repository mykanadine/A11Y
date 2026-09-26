/**
 * Rule Engine subagent — Phase 2
 *
 * Responsibilities:
 *  1. Ingest WCAG 2.2 criteria (from a local PDF or a hosted JSON index) and
 *     filter to the subset relevant to this PR's component types.
 *  2. Fetch internal design system docs (colour palette, spacing tokens,
 *     component library) from the URL in DESIGN_SYSTEM_DOCS_URL.
 *  3. Fetch the Jira ticket (ID already extracted by the Orchestrator) and
 *     pull its acceptance criteria + component intent.
 *  4. Partition applicable WCAG rules into exactly three persona buckets.
 *  5. Return a ComplianceContext that unblocks the three parallel runPersona()
 *     calls in the Orchestrator.
 *
 * Environment variables required:
 *   WCAG_PDF_PATH          - local path to WCAG 2.2 PDF, OR
 *   WCAG_JSON_URL          - URL of a pre-built WCAG 2.2 JSON index
 *   DESIGN_SYSTEM_DOCS_URL - URL of the internal design system JSON manifest
 *   JIRA_BASE_URL          - e.g. "https://acme.atlassian.net"
 *   JIRA_TOKEN             - Jira API token (Basic auth: base64 "email:token")
 *   JIRA_USER_EMAIL        - email paired with the Jira token
 */

import { createRequire } from "module";
import * as fs from "fs/promises";
import * as path from "path";
import {
  UIComponent,
  ComplianceContext,
  WCAGRule,
  PersonaType,
  RulesByPersona,
  ApprovedFixPalette,
  DesignSystemColor,
} from "../types/index.js";

// ─── Public interface (matches what the Orchestrator passes) ──────────────────

export interface RuleEngineInput {
  components: UIComponent[];
  jiraTicketId: string | null;
}

// ─── Environment helpers ───────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[RuleEngine] Missing required environment variable: ${name}`);
  return v;
}

// ─── 1. WCAG 2.2 ingestion ────────────────────────────────────────────────────

/**
 * Raw shape expected in the WCAG JSON index.
 * The index can be generated once from the PDF and committed to the repo.
 * See scripts/build-wcag-index.ts for the extraction script.
 */
interface WCAGIndexEntry {
  id: string;
  level: "A" | "AA" | "AAA";
  title: string;
  description: string;
  /** Coarse category tags used for persona partitioning */
  tags: string[];
}

/**
 * Tag sets that determine which persona bucket a criterion belongs to.
 * A criterion may belong to MORE than one persona (e.g. 1.3.1 applies to
 * both Motor and Visual). Order here matches PersonaType literal order.
 */
const MOTOR_TAGS = new Set([
  "keyboard",
  "focus",
  "aria",
  "alt-text",
  "semantic",
  "role",
  "label",
  "tab-order",
  "operability",
]);

const VISUAL_TAGS = new Set([
  "contrast",
  "color",
  "colour",
  "color-blindness",
  "visual-indicator",
  "text-spacing",
  "resize",
]);

const VESTIBULAR_TAGS = new Set([
  "motion",
  "animation",
  "autoplay",
  "carousel",
  "transition",
  "parallax",
  "flashing",
]);

/**
 * WCAG criterion IDs that are explicitly out of scope for this build.
 * Reading-level (3.1.5) and session-timeout (2.2.1/2.2.6) rules are excluded.
 */
const EXCLUDED_IDS = new Set(["3.1.5", "2.2.1", "2.2.6"]);

/** Load and parse the WCAG 2.2 JSON index from disk or a remote URL. */
async function loadWCAGIndex(): Promise<WCAGIndexEntry[]> {
  const localPath = process.env.WCAG_PDF_PATH; // reused as JSON path when pre-built
  const remoteUrl = process.env.WCAG_JSON_URL;

  let raw: string;

  if (localPath) {
    // Prefer local file (fastest; works offline / in CI without egress)
    raw = await fs.readFile(path.resolve(localPath), "utf8");
  } else if (remoteUrl) {
    const res = await fetch(remoteUrl);
    if (!res.ok) throw new Error(`[RuleEngine] WCAG index fetch failed: ${res.status}`);
    raw = await res.text();
  } else {
    // Fall back to the bundled baseline index shipped with this package
    const require = createRequire(import.meta.url);
    const indexPath = require.resolve("../data/wcag-2.2-index.json");
    raw = await fs.readFile(indexPath, "utf8");
  }

  return JSON.parse(raw) as WCAGIndexEntry[];
}

/**
 * Filter the full WCAG index to criteria that are:
 *   - Level A or AA (unless the Jira ticket flags AAA intent)
 *   - In scope for at least one of the three persona tag sets
 *   - Not in the EXCLUDED_IDS list
 *   - Relevant to the component types present in this PR
 */
function filterRelevantCriteria(
  allCriteria: WCAGIndexEntry[],
  components: UIComponent[],
  allowAAA: boolean
): WCAGRule[] {
  // Infer broad component type hints from file extensions and source code
  const hasInteractive = components.some(
    (c) => /button|input|select|textarea|<a\s|role=|tabindex/i.test(c.sourceCode)
  );
  const hasImages = components.some((c) => /<img|<svg|background-image/i.test(c.sourceCode));
  const hasMotion = components.some(
    (c) => /animation|transition|@keyframes|carousel|autoplay/i.test(c.sourceCode)
  );
  const hasColor = components.some(
    (c) => /color:|background(-color)?:|border-color/i.test(c.sourceCode)
  );

  return allCriteria
    .filter((entry) => {
      if (EXCLUDED_IDS.has(entry.id)) return false;
      if (!allowAAA && entry.level === "AAA") return false;

      const tags = entry.tags.map((t) => t.toLowerCase());
      const inMotor = tags.some((t) => MOTOR_TAGS.has(t));
      const inVisual = tags.some((t) => VISUAL_TAGS.has(t));
      const inVestibular = tags.some((t) => VESTIBULAR_TAGS.has(t));

      if (!inMotor && !inVisual && !inVestibular) return false;

      // Skip image-specific rules when no images are present
      if (tags.includes("alt-text") && !hasImages) return false;
      // Skip interactive-element rules when no interactive elements are present
      if ((tags.includes("keyboard") || tags.includes("focus")) && !hasInteractive) return false;
      // Skip motion rules only when the rule is EXCLUSIVELY vestibular
      if (inVestibular && !inMotor && !inVisual && !hasMotion) return false;
      // Skip colour rules only when the rule is EXCLUSIVELY visual
      if (inVisual && !inMotor && !inVestibular && !hasColor) return false;

      return true;
    })
    .map((entry) => {
      const tags = entry.tags.map((t) => t.toLowerCase());
      const relevantTo: PersonaType[] = [];
      if (tags.some((t) => MOTOR_TAGS.has(t))) relevantTo.push("Motor");
      if (tags.some((t) => VISUAL_TAGS.has(t))) relevantTo.push("Visual");
      if (tags.some((t) => VESTIBULAR_TAGS.has(t))) relevantTo.push("Vestibular/Cognitive");

      return {
        id: entry.id,
        level: entry.level,
        title: entry.title,
        description: entry.description,
        relevantTo,
      } satisfies WCAGRule;
    });
}

// ─── 2. Design system ingestion ───────────────────────────────────────────────

/**
 * Expected shape of the design system JSON manifest at DESIGN_SYSTEM_DOCS_URL.
 *
 * Teams maintain this file alongside their component library.
 * Minimum required fields are shown; extra fields are ignored.
 */
interface DesignSystemManifest {
  colors: Array<{
    token: string;
    hex: string;
    contrastOnWhite: number;
    contrastOnBlack: number;
  }>;
  spacingTokens: Record<string, string>;
  componentNames: string[];
  notes?: string[];
}

async function loadDesignSystem(): Promise<{
  palette: ApprovedFixPalette;
  notes: string[];
}> {
  const url = process.env.DESIGN_SYSTEM_DOCS_URL;
  if (!url) {
    return {
      palette: { colors: [], spacingTokens: {}, componentNames: [] },
      notes: [],
    };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[RuleEngine] Design system fetch failed: ${res.status}`);

    const manifest: DesignSystemManifest = await res.json();

    const colors: DesignSystemColor[] = manifest.colors.map((c) => ({
      token: c.token,
      hex: c.hex,
      contrastOnWhite: c.contrastOnWhite,
      contrastOnBlack: c.contrastOnBlack,
      // A colour passes AA if it achieves ≥4.5:1 against either white or black
      wcagAA: c.contrastOnWhite >= 4.5 || c.contrastOnBlack >= 4.5,
    }));

    return {
      palette: {
        colors,
        spacingTokens: manifest.spacingTokens ?? {},
        componentNames: manifest.componentNames ?? [],
      },
      notes: manifest.notes ?? [],
    };
  } catch (err) {
    console.warn(`[RuleEngine] Design system fetch failed (non-fatal): ${(err as Error).message}`);
    return {
      palette: { colors: [], spacingTokens: {}, componentNames: [] },
      notes: [],
    };
  }
}

// ─── 3. Jira ticket ingestion ─────────────────────────────────────────────────

interface JiraIssue {
  fields: {
    summary: string;
    description?: { content?: Array<{ content?: Array<{ text?: string }> }> } | string | null;
    /** Acceptance criteria may live in a custom field — common field IDs listed */
    customfield_10016?: string | null; // Story Points (skip)
    customfield_10014?: string | null; // Epic link (skip)
    [key: string]: unknown;
  };
}

/**
 * Parse acceptance criteria text from a Jira issue.
 * Handles both Atlassian Document Format (ADF) and plain-text descriptions.
 */
function extractAcceptanceCriteria(issue: JiraIssue): string[] {
  const raw = issue.fields.description;
  if (!raw) return [];

  // Plain string (older Jira Server / simplified API responses)
  if (typeof raw === "string") {
    return raw
      .split(/\n|•|;/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Atlassian Document Format — walk the content tree and collect text nodes
  const lines: string[] = [];
  function walk(node: { text?: string; content?: unknown[] } | undefined): void {
    if (!node) return;
    if (node.text) lines.push(node.text.trim());
    if (Array.isArray(node.content)) node.content.forEach((child) => walk(child as typeof node));
  }
  walk(raw as Parameters<typeof walk>[0]);

  return lines.filter(Boolean);
}

async function fetchJiraTicket(ticketId: string): Promise<{
  componentIntent: string;
  acceptanceCriteria: string[];
  allowAAA: boolean;
}> {
  const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/$/, "");
  const email = requireEnv("JIRA_USER_EMAIL");
  const token = requireEnv("JIRA_TOKEN");
  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${ticketId}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`[RuleEngine] Jira fetch failed for ${ticketId}: ${res.status}`);

  const issue: JiraIssue = await res.json();
  const acceptanceCriteria = extractAcceptanceCriteria(issue);

  // If any acceptance criterion mentions "AAA", unlock AAA rules for this scan
  const allowAAA = acceptanceCriteria.some((c) => /\bAAA\b/i.test(c));

  return {
    componentIntent: issue.fields.summary ?? ticketId,
    acceptanceCriteria,
    allowAAA,
  };
}

// ─── 4. Partition rules into persona buckets ──────────────────────────────────

function partitionByPersona(rules: WCAGRule[]): RulesByPersona {
  return {
    motor: rules.filter((r) => r.relevantTo.includes("Motor")),
    visual: rules.filter((r) => r.relevantTo.includes("Visual")),
    vestibular: rules.filter((r) => r.relevantTo.includes("Vestibular/Cognitive")),
  };
}

// ─── 5. Main entry point ──────────────────────────────────────────────────────

export async function runRuleEngine(input: RuleEngineInput): Promise<ComplianceContext> {
  const { components, jiraTicketId } = input;

  // When A11Y_QUIET=1 (set by --json mode), route progress logs to stderr
  // so stdout stays clean for machine-readable JSON output.
  const log = process.env.A11Y_QUIET === "1" ? console.error : console.log;

  log("[RuleEngine] Starting ingestion pipeline…");

  // ── 3. Jira (first, because it controls allowAAA) ────────────────────────
  let componentIntent = "(no Jira ticket linked)";
  let acceptanceCriteria: string[] = [];
  let allowAAA = false;

  if (jiraTicketId) {
    log(`[RuleEngine] Fetching Jira ticket ${jiraTicketId}…`);
    try {
      const jira = await fetchJiraTicket(jiraTicketId);
      componentIntent = jira.componentIntent;
      acceptanceCriteria = jira.acceptanceCriteria;
      allowAAA = jira.allowAAA;
    } catch (err) {
      // Non-fatal: proceed without Jira context rather than block the PR scan
      console.warn(`[RuleEngine] Jira fetch failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // ── 1. WCAG 2.2 + 2. Design system in parallel ────────────────────────────
  log("[RuleEngine] Loading WCAG 2.2 index and design system in parallel…");
  const [wcagIndex, designSystem] = await Promise.all([
    loadWCAGIndex(),
    loadDesignSystem(),
  ]);

  // ── Filter WCAG to applicable rules ──────────────────────────────────────
  const applicableRules = filterRelevantCriteria(wcagIndex, components, allowAAA);
  log(
    `[RuleEngine] ${applicableRules.length} WCAG rules applicable ` +
      `(${allowAAA ? "A+AA+AAA" : "A+AA only"}).`
  );

  // ── Partition into persona buckets ────────────────────────────────────────
  const rulesByPersona = partitionByPersona(applicableRules);
  log(
    `[RuleEngine] Rules by persona — ` +
      `Motor: ${rulesByPersona.motor.length}, ` +
      `Visual: ${rulesByPersona.visual.length}, ` +
      `Vestibular: ${rulesByPersona.vestibular.length}`
  );

  return {
    // ── Base ComplianceContext fields (consumed by existing Persona stubs) ──
    applicableRules,
    designSystemNotes: designSystem.notes,
    jiraAcceptanceCriteria: acceptanceCriteria,

    // ── Extended fields added in Phase 2 ─────────────────────────────────
    componentIntent,
    rulesByPersona,
    approvedFixPalette: designSystem.palette,
  };
}
