/**
 * Visual Impairment Simulator persona.
 * Performs CSS-only static analysis for contrast ratios (WCAG 1.4.3)
 * and colour-blindness safety (WCAG 1.4.1 — Protanopia simulation).
 */
import type {
  PersonaReport,
  TestResult,
  WCAGRule,
  DesignSystemColor,
} from "../../types/index.js";
import type { PersonaInput } from "../persona.js";

// ─── Colour Math (no external packages) ──────────────────────────────────────

/** Parse a 3- or 6-digit hex colour string into [r, g, b] 0-255. */
function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace(/^#/, "");
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0]! + cleaned[0]!, 16);
    const g = parseInt(cleaned[1]! + cleaned[1]!, 16);
    const b = parseInt(cleaned[2]! + cleaned[2]!, 16);
    return [r, g, b];
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}

/** Convert a single 0-255 channel to its linearised value. */
function linearise(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0–1). */
function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const R = linearise(rgb[0]);
  const G = linearise(rgb[1]);
  const B = linearise(rgb[2]);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two hex colours. */
function contrastRatio(fg: string, bg: string): number | null {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  if (L1 === null || L2 === null) return null;
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Apply the Viénot 1999 Protanopia simulation matrix to linear RGB.
 * Input channels are 0-255; output is 0-255 (clamped).
 */
function simulateProtanopia(hex: string): [number, number, number] | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const R = linearise(rgb[0]);
  const G = linearise(rgb[1]);
  const B = linearise(rgb[2]);

  // Viénot 1999 matrix for Protanopia
  const rp = 0.56667 * R + 0.43333 * G + 0 * B;
  const gp = 0.55833 * R + 0.44167 * G + 0 * B;
  const bp = 0.0 * R + 0.24167 * G + 0.75833 * B;

  // Convert back to 0-255 (gamma re-apply via sRGB approximation)
  const toSrgb = (v: number): number => {
    const clamped = Math.max(0, Math.min(1, v));
    const encoded =
      clamped <= 0.0031308
        ? clamped * 12.92
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  };

  return [toSrgb(rp), toSrgb(gp), toSrgb(bp)];
}

/** Euclidean distance in RGB space. */
function rgbDistance(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
      Math.pow(a[1] - b[1], 2) +
      Math.pow(a[2] - b[2], 2)
  );
}

// ─── CSS Extraction ───────────────────────────────────────────────────────────

/** Extract all CSS text from <style> blocks and style="" attributes. */
function extractCss(compiledHTML: string): string {
  const parts: string[] = [];

  // <style>...</style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleBlockRe.exec(compiledHTML)) !== null) {
    parts.push(m[1]!);
  }

  // style="" attributes
  const inlineStyleRe = /style="([^"]*)"/gi;
  while ((m = inlineStyleRe.exec(compiledHTML)) !== null) {
    // Wrap in a throwaway rule so the CSS parser can read it uniformly
    parts.push(`__inline__ { ${m[1]!} }`);
  }

  return parts.join("\n");
}

// ─── Hex value extraction ─────────────────────────────────────────────────────

const HEX_RE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function extractHexValues(css: string): string[] {
  const values: string[] = [];
  let m: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(css)) !== null) {
    values.push(m[0]!);
  }
  return values;
}

/** Return the 1-based line number of the first occurrence of needle in source, or null. */
function findLine(sourceCode: string, needle: string): number | null {
  const lines = sourceCode.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(needle)) return i + 1;
  }
  return null;
}

// ─── CSS Rule Parsing ─────────────────────────────────────────────────────────

interface CssDeclaration {
  property: string;
  value: string;
}

interface CssRule {
  selector: string;
  declarations: CssDeclaration[];
}

/**
 * Minimal CSS parser: extracts selector + declaration blocks.
 * Handles nested at-rules by stripping them.
 */
function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];

  // Remove comments
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Match selector { declarations }
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(stripped)) !== null) {
    const selector = m[1]!.trim();
    const body = m[2]!.trim();
    if (!selector || selector.startsWith("@")) continue;

    const declarations: CssDeclaration[] = [];
    for (const decl of body.split(";")) {
      const colon = decl.indexOf(":");
      if (colon === -1) continue;
      const property = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (property && value) declarations.push({ property, value });
    }
    if (declarations.length > 0) rules.push({ selector, declarations });
  }
  return rules;
}

/** Extract the first hex colour from a CSS value string, or null. */
function extractHexFromValue(value: string): string | null {
  HEX_RE.lastIndex = 0;
  const m = HEX_RE.exec(value);
  return m ? m[0]! : null;
}

/** Return declaration value for a property name, or undefined. */
function getDecl(decls: CssDeclaration[], property: string): string | undefined {
  return decls.find((d) => d.property === property)?.value;
}

// ─── Font Size Helpers ────────────────────────────────────────────────────────

/** Returns true when the declarations describe "large text" per WCAG. */
function isLargeText(decls: CssDeclaration[]): boolean {
  const fontSizeVal = getDecl(decls, "font-size");
  const fontWeightVal = getDecl(decls, "font-weight");
  const isBold =
    fontWeightVal === "bold" ||
    fontWeightVal === "700" ||
    (Number(fontWeightVal) >= 700);

  if (!fontSizeVal) return false;

  // pixels
  const pxMatch = /^([\d.]+)px$/.exec(fontSizeVal);
  if (pxMatch) {
    const px = parseFloat(pxMatch[1]!);
    if (px >= 24) return true;          // ≥ 18pt
    if (px >= 18.67 && isBold) return true; // ≥ 14pt bold
    return false;
  }

  // points
  const ptMatch = /^([\d.]+)pt$/.exec(fontSizeVal);
  if (ptMatch) {
    const pt = parseFloat(ptMatch[1]!);
    if (pt >= 18) return true;
    if (pt >= 14 && isBold) return true;
    return false;
  }

  return false;
}

// ─── Rule Scope Filter ────────────────────────────────────────────────────────

function getScopedRules(input: PersonaInput): WCAGRule[] {
  return input.complianceContext.rulesByPersona?.visual ??
    input.complianceContext.applicableRules;
}

function ruleInScope(ruleId: string, scoped: WCAGRule[]): boolean {
  return scoped.some((r) => r.id === ruleId);
}

// ─── Suggested Fix Helpers ────────────────────────────────────────────────────

function suggestPaletteReplacement(
  colors: DesignSystemColor[] | undefined
): string {
  if (!colors) return "Replace the failing colour with a design-system token that meets WCAG AA contrast.";
  const safe = colors.find((c) => c.wcagAA);
  if (!safe)
    return "Replace the failing colour with a design-system token that meets WCAG AA contrast.";
  return `Replace with design-system token \`${safe.token}\` (${safe.hex}) which passes WCAG AA contrast.`;
}

// ─── CHECK 1: Contrast Ratio ─────────────────────────────────────────────────

function checkContrast(
  component: { filePath: string; compiledHTML: string; sourceCode: string },
  scoped: WCAGRule[],
  palette: DesignSystemColor[] | undefined
): TestResult[] {
  const RULE_ID = "1.4.3";
  if (!ruleInScope(RULE_ID, scoped)) return [];

  // Parse CSS from sourceCode only — compiledHTML is a stub that embeds the
  // raw source verbatim, so concatenating both would double-count every rule.
  const css = extractCss(component.sourceCode);
  const rules = parseCssRules(css);

  const failures: TestResult[] = [];
  // Deduplicate by (selector, fgHex, bgHex) so the same rule isn't reported twice
  // if the same CSS block appears in multiple extracted contexts.
  const seen = new Set<string>();

  for (const rule of rules) {
    const colorVal = getDecl(rule.declarations, "color");
    const bgVal = getDecl(rule.declarations, "background-color");

    const fgHex = colorVal ? extractHexFromValue(colorVal) : null;
    if (!fgHex) continue; // no foreground colour — skip

    const bgHex = bgVal ? extractHexFromValue(bgVal) : "#ffffff";
    if (!bgHex) continue;

    const dedupeKey = `${rule.selector.trim()}|${fgHex}|${bgHex}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const ratio = contrastRatio(fgHex, bgHex);
    if (ratio === null) continue;

    const large = isLargeText(rule.declarations);
    const threshold = large ? 3.0 : 4.5;

    if (ratio < threshold) {
      // Find source line: try the selector first, then the hex value
      const line =
        findLine(component.sourceCode, rule.selector.trim()) ??
        findLine(component.sourceCode, fgHex);

      failures.push({
        status: "fail",
        ruleId: RULE_ID,
        filePath: component.filePath,
        line,
        issue: `Text color ${fgHex} on ${bgHex} has contrast ratio ${ratio.toFixed(2)}:1, below ${threshold}:1 threshold (selector: "${rule.selector.trim()}")`,
        suggestedFix: suggestPaletteReplacement(palette),
      });
    }
  }

  // If no failures, emit a single pass for the rule
  if (failures.length === 0) {
    return [
      {
        status: "pass",
        ruleId: RULE_ID,
        filePath: component.filePath,
        line: null,
        issue: "All colour contrast ratios meet WCAG AA thresholds.",
        suggestedFix: "",
      },
    ];
  }

  return failures;
}

// ─── CHECK 2: Colour-Blindness Safety (Protanopia) ────────────────────────────

/**
 * Heuristic: group selectors that share a common base name but differ only
 * in a modifier suffix (e.g. --error / --success, --warning / --info, etc.)
 * and compare their resolved colours under Protanopia simulation.
 */
function checkColourBlindness(
  component: { filePath: string; compiledHTML: string; sourceCode: string },
  scoped: WCAGRule[],
): TestResult[] {
  const RULE_ID = "1.4.1";
  if (!ruleInScope(RULE_ID, scoped)) return [];

  const css = extractCss(component.compiledHTML) +
    "\n" +
    extractCss(component.sourceCode);
  const rules = parseCssRules(css);

  // Build a map: selector → primary colour (color or background-color)
  const selectorColour = new Map<string, string>();
  for (const rule of rules) {
    const colorVal = getDecl(rule.declarations, "color") ??
      getDecl(rule.declarations, "background-color");
    if (!colorVal) continue;
    const hex = extractHexFromValue(colorVal);
    if (hex) selectorColour.set(rule.selector.trim(), hex);
  }

  // Find sibling pairs: selectors that share a common prefix before the last
  // modifier segment (-- or last word separated by space or [).
  // Strategy: group selectors by their "base" (everything except the last
  // modifier token), then compare every pair within each group.
  const STATE_MODIFIER_RE =
    /^(.*?)(--[\w-]+|\[aria-[\w-]+=["'][\w-]+["']\]|:\w[\w-]*)$/;

  const groups = new Map<string, Array<{ selector: string; hex: string }>>();

  for (const [selector, hex] of selectorColour) {
    const m = STATE_MODIFIER_RE.exec(selector);
    const base = m ? m[1]!.trim() : selector;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push({ selector, hex });
  }

  const failures: TestResult[] = [];
  const seen = new Set<string>();

  for (const members of groups.values()) {
    if (members.length < 2) continue;

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!;
        const b = members[j]!;

        if (a.hex === b.hex) continue; // same colour — trivially safe to skip

        const pairKey = [a.hex, b.hex].sort().join("|");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const simA = simulateProtanopia(a.hex);
        const simB = simulateProtanopia(b.hex);
        if (!simA || !simB) continue;

        const dist = rgbDistance(simA, simB);

        if (dist < 30) {
          const line =
            findLine(component.sourceCode, a.selector) ??
            findLine(component.sourceCode, a.hex);

          failures.push({
            status: "fail",
            ruleId: RULE_ID,
            filePath: component.filePath,
            line,
            issue: `Colors ${a.hex} and ${b.hex} are indistinguishable under Protanopia simulation (distance: ${dist.toFixed(1)}) — selectors: "${a.selector}" vs "${b.selector}"`,
            suggestedFix:
              "Add a non-color differentiator (icon, pattern, text label, or border-style change) alongside the color distinction so the UI state is perceivable without color.",
          });
        }
      }
    }
  }

  if (failures.length === 0) {
    return [
      {
        status: "pass",
        ruleId: RULE_ID,
        filePath: component.filePath,
        line: null,
        issue: "No colour-only state distinctions detected that fail Protanopia simulation.",
        suggestedFix: "",
      },
    ];
  }

  return failures;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function runVisualPersona(
  input: PersonaInput
): Promise<PersonaReport> {
  const scoped = getScopedRules(input);
  const palette = input.complianceContext.approvedFixPalette?.colors;

  const results: TestResult[] = [];

  for (const component of input.components) {
    results.push(...checkContrast(component, scoped, palette));
    results.push(...checkColourBlindness(component, scoped));
  }

  return {
    persona: "Visual",
    results,
  };
}
