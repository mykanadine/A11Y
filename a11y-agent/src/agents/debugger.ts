/**
 * Debugger subagent — Phase 4
 *
 * Converts a single persona failure into a minimal, committable code patch.
 *
 * Responsibilities:
 *  1. Re-locate the failure's exact position in the developer's source file
 *     (not the compiled snapshot) using the line hint from the Persona report.
 *  2. Extract the smallest possible original snippet around that position.
 *  3. Generate a patched snippet using a failure-type-specific strategy.
 *  4. Format a unified diff (ready for `git apply`) and a plain-English
 *     explanation that teaches the underlying WCAG rule to junior developers.
 *
 * All patch strategies are pure transformations — they do NOT call an LLM or
 * any external service. Strategies are chosen by ruleId, so each patch type
 * is deterministic, reviewable, and testable.
 */

import {
  UIComponent,
  TestResult,
  PersonaType,
  CodePatch,
  ApprovedFixPalette,
} from "../types/index.js";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface DebuggerInput {
  failure: TestResult & { persona: PersonaType };
  component: UIComponent | undefined;
  /** Passed from complianceContext — used by contrast-fix strategy */
  approvedFixPalette?: ApprovedFixPalette;
  /** Passed from complianceContext.componentIntent — used in explanation copy */
  componentIntent?: string;
}

// ─── Source location helpers ──────────────────────────────────────────────────

/** Split source into 1-based lines. */
function sourceLines(source: string): string[] {
  return source.split("\n");
}

/**
 * Find the 1-based line number of the first occurrence of `needle` in source.
 * Returns null when not found.
 */
function findLineNumber(source: string, needle: string): number | null {
  const lines = sourceLines(source);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return null;
}

/**
 * Extract a window of lines centred on `lineNumber` (1-based).
 * Returns { lines, startLine } where startLine is the 1-based index of lines[0].
 */
function extractWindow(
  source: string,
  lineNumber: number,
  radius: number = 0
): { lines: string[]; startLine: number } {
  const all = sourceLines(source);
  const zeroIdx = lineNumber - 1;
  const start = Math.max(0, zeroIdx - radius);
  const end = Math.min(all.length - 1, zeroIdx + radius);
  return { lines: all.slice(start, end + 1), startLine: start + 1 };
}

// ─── Unified diff builder ─────────────────────────────────────────────────────

/**
 * Build a minimal unified diff string compatible with `git apply`.
 *
 * @param filePath  - repo-relative file path (used in the diff header)
 * @param startLine - 1-based line number of the first line in both snippets
 * @param original  - array of original lines (without trailing newline per line)
 * @param patched   - array of patched lines
 */
function buildUnifiedDiff(
  filePath: string,
  startLine: number,
  original: string[],
  patched: string[]
): string {
  const hunkHeader = `@@ -${startLine},${original.length} +${startLine},${patched.length} @@`;
  const removals = original.map((l) => `-${l}`);
  const additions = patched.map((l) => `+${l}`);

  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    hunkHeader,
    ...removals,
    ...additions,
  ].join("\n");
}

// ─── Patch strategies (one per failure category) ─────────────────────────────

interface PatchResult {
  originalSnippet: string;
  patchedSnippet: string;
  diff: string;
  explanation: string;
  resolvedLine: number | null;
}

// ── 2.1.1  Unfocusable interactive element ────────────────────────────────────
function patchUnfocusable(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, failure.issue.split(" ")[0] ?? "");
  const { lines, startLine } = extractWindow(source, line ?? 1);
  const original = lines;

  const patched = original.map((l) => {
    // Remove tabindex="-1" — the most common cause
    let fixed = l.replace(/\s*tabindex=["']-1["']/gi, "");
    // If the element is disabled but shouldn't be, surface it in the explanation
    // (we don't auto-remove `disabled` — that requires intent knowledge)
    return fixed;
  });

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 2.1.1 — Keyboard: this element had \`tabindex="-1"\` which removes it from ` +
      `the tab order entirely. Keyboard-only and switch-access users cannot reach or ` +
      `activate it. Removing \`tabindex="-1"\` restores it to the natural focus sequence.`,
    resolvedLine: line,
  };
}

// ── 2.4.7  Missing focus indicator ───────────────────────────────────────────
function patchFocusIndicator(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, "outline");
  const { lines, startLine } = extractWindow(source, line ?? 1);
  const original = lines;

  // Replace `outline: none` / `outline: 0` with a visible focus ring
  const patched = original.map((l) =>
    l
      .replace(/outline\s*:\s*none\s*;?/gi, "outline: 2px solid currentColor; outline-offset: 2px;")
      .replace(/outline\s*:\s*0\s*;?/gi, "outline: 2px solid currentColor; outline-offset: 2px;")
  );

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 2.4.7 — Focus Visible: \`outline: none\` hides the keyboard focus indicator, ` +
      `making it impossible for keyboard users to see which element is currently active. ` +
      `Replaced with a 2px solid outline that is visible on any background colour. ` +
      `If you need a custom focus style, use \`box-shadow\` instead of removing outline.`,
    resolvedLine: line,
  };
}

// ── 4.1.2  Div/span acting as interactive without role + tabindex ─────────────
function patchDivButton(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, "onClick");
  const { lines, startLine } = extractWindow(source, line ?? 1, 2);
  const original = lines;

  // Determine whether this looks like JSX (contains onClick=) or HTML (onclick=)
  const isJSX = original.some((l) => /onClick\s*=/.test(l));

  const patched = original.map((l) => {
    if (isJSX) {
      // JSX: inject role="button" and tabIndex={0} if missing; also add onKeyDown for Enter/Space
      let fixed = l;
      if (!/role\s*=/.test(fixed) && /<(div|span)/.test(fixed)) {
        fixed = fixed.replace(/<(div|span)(\s)/, `<$1 role="button" tabIndex={0}$2`);
      }
      if (!/onKeyDown\s*=/.test(fixed) && /onClick\s*=/.test(fixed)) {
        // Inject a minimal onKeyDown handler that mirrors onClick
        const onClickMatch = fixed.match(/onClick\s*=\s*(\{[^}]+\}|"[^"]+"|'[^']+')/);
        if (onClickMatch) {
          const handler = onClickMatch[1];
          fixed = fixed.replace(
            /onClick\s*=/,
            `onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ${handler.replace(/^\{|\}$/g, "")}} onClick=`
          );
        }
      }
      return fixed;
    } else {
      // HTML: inject tabindex="0" and role="button" if missing
      let fixed = l;
      if (!/role\s*=/.test(fixed) && /<(div|span)/.test(fixed)) {
        fixed = fixed.replace(/<(div|span)(\s|>)/, `<$1 role="button" tabindex="0"$2`);
      }
      return fixed;
    }
  });

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 4.1.2 — Name, Role, Value: a \`<div>\` or \`<span>\` with a click handler is ` +
      `invisible to assistive technologies — screen readers won't announce it as interactive, ` +
      `and keyboard users can't Tab to or activate it. Added \`role="button"\`, \`tabindex="0"\`, ` +
      `and an \`onKeyDown\` handler for Enter/Space. For new code, prefer a semantic \`<button>\` ` +
      `element which provides all of this for free.`,
    resolvedLine: line,
  };
}

// ── 2.4.3  Positive tabindex (tab-order mismatch) ────────────────────────────
function patchPositiveTabindex(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, "tabindex");
  const { lines, startLine } = extractWindow(source, line ?? 1);
  const original = lines;

  // Replace tabindex="N" (N > 0) with tabindex="0"
  const patched = original.map((l) =>
    l
      .replace(/tabindex\s*=\s*["']\s*[1-9]\d*\s*["']/gi, `tabindex="0"`)
      .replace(/tabIndex\s*=\s*\{\s*[1-9]\d*\s*\}/g, `tabIndex={0}`)
  );

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 2.4.3 — Focus Order: a positive \`tabindex\` value (e.g. tabindex="3") creates ` +
      `a custom tab sequence that diverges from the DOM reading order, which confuses ` +
      `screen-reader users who expect focus to follow the visual/document flow. ` +
      `Changed to \`tabindex="0"\` which places the element in the natural DOM tab order ` +
      `without disrupting the sequence. Reorder the DOM if visual order must change instead.`,
    resolvedLine: line,
  };
}

// ── 1.4.3  Contrast ratio failure ────────────────────────────────────────────

/** Compute relative luminance of a hex colour (WCAG 2.1 formula). */
function relativeLuminance(hex: string): number {
  const rgb = parseInt(hex.replace("#", ""), 16);
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick the approved-palette colour with the highest contrast ratio against `bgHex`. */
function bestPaletteColor(
  palette: ApprovedFixPalette | undefined,
  bgHex: string,
  minRatio: number
): { token: string; hex: string } | null {
  if (!palette?.colors.length) return null;
  const bgL = relativeLuminance(bgHex);

  let best: { token: string; hex: string; ratio: number } | null = null;
  for (const c of palette.colors) {
    if (!c.wcagAA) continue;
    const fgL = relativeLuminance(c.hex);
    const lighter = Math.max(fgL, bgL);
    const darker = Math.min(fgL, bgL);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    if (ratio >= minRatio && (!best || ratio > best.ratio)) {
      best = { token: c.token, hex: c.hex, ratio };
    }
  }
  return best;
}

function patchContrast(
  failure: TestResult,
  source: string,
  palette: ApprovedFixPalette | undefined
): PatchResult {
  // Extract the failing hex from the issue string: "… #rrggbb …"
  const hexMatch = failure.issue.match(/#([0-9a-fA-F]{3,6})/);
  const failingHex = hexMatch ? `#${hexMatch[1]}` : null;

  // Extract background hex if present (second hex in issue string)
  const allHexes = [...failure.issue.matchAll(/#([0-9a-fA-F]{3,6})/g)].map((m) => `#${m[1]}`);
  const bgHex = allHexes[1] ?? "#ffffff";

  // Determine if large-text threshold (3:1) or normal (4.5:1) applies
  const isLargeText = /large.text/i.test(failure.issue);
  const minRatio = isLargeText ? 3.0 : 4.5;

  const replacement = failingHex
    ? bestPaletteColor(palette, bgHex, minRatio)
    : null;

  const line = failure.line ?? (failingHex ? findLineNumber(source, failingHex) : null);
  const { lines, startLine } = extractWindow(source, line ?? 1);
  const original = lines;

  const patched = replacement
    ? original.map((l) =>
        failingHex ? l.replace(new RegExp(failingHex, "gi"), replacement.hex) : l
      )
    : original; // no palette available — diff will be identity; explanation still posted

  const fixDescription = replacement
    ? `Replaced \`${failingHex}\` with \`${replacement.hex}\` (design-system token \`${replacement.token}\`).`
    : `No approved-palette colour available — manually select a colour with ≥${minRatio}:1 contrast against \`${bgHex}\`.`;

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 1.4.3 — Contrast (Minimum): the colour \`${failingHex ?? "detected"}\` does not meet ` +
      `the ${minRatio}:1 contrast ratio required against its background \`${bgHex}\`. ` +
      `Low contrast makes text unreadable for users with low vision or in bright-light environments. ` +
      fixDescription,
    resolvedLine: line,
  };
}

// ── 1.4.1  Colour-blindness (Protanopia) — state differentiated by hue only ──
function patchColorBlindness(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, failure.issue.split(" ")[0] ?? "");
  const { lines, startLine } = extractWindow(source, line ?? 1, 1);
  const original = lines;

  // Cannot safely auto-swap colours here without knowing the full design intent.
  // Emit an identity diff with a detailed explanation and the canonical fix pattern.
  const patched = [...original];

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 1.4.1 — Use of Color: these two states are distinguishable only by hue, which ` +
      `users with Protanopia (red-green colour blindness, ~8% of males) cannot perceive as ` +
      `different. Add a secondary, non-colour differentiator — for example: a distinct icon ` +
      `(\`✓\` vs \`✕\`), a \`border-style\` change (solid vs dashed), or a visible text label ` +
      `("Error" / "Success") — so the state is never communicated by colour alone.`,
    resolvedLine: line,
  };
}

// ── 2.2.2  Auto-playing media / carousels ─────────────────────────────────────
function patchAutoplay(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, "autoplay") ?? findLineNumber(source, "autoPlay");
  const { lines, startLine } = extractWindow(source, line ?? 1);
  const original = lines;

  const patched = original.map((l) => {
    // HTML attribute: remove autoplay
    let fixed = l.replace(/\s*autoplay\b/gi, "");
    // JSX prop: autoPlay={true} → autoPlay={false}
    fixed = fixed.replace(/autoPlay\s*=\s*\{true\}/g, "autoPlay={false}");
    // Plain autoPlay without value → remove
    fixed = fixed.replace(/\s*autoPlay\b(?!\s*=)/g, "");
    return fixed;
  });

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 2.2.2 — Pause, Stop, Hide: auto-playing media starts motion or sound without ` +
      `the user's consent, which can trigger vestibular disorders (dizziness, nausea) and ` +
      `distracts users with cognitive disabilities. Removed \`autoplay\`/\`autoPlay\` so ` +
      `playback only begins on explicit user interaction. If autoplay is a product requirement, ` +
      `add a prominently placed pause/stop button adjacent to the media element.`,
    resolvedLine: line,
  };
}

// ── 2.3.3  CSS animation/transition not wrapped in prefers-reduced-motion ─────
function patchReducedMotion(
  failure: TestResult,
  source: string
): PatchResult {
  // Extract the CSS selector from the issue string
  const selectorMatch = failure.issue.match(/on (.+?) is not wrapped/);
  const selector = selectorMatch?.[1] ?? failure.suggestedFix.split(" ")[0] ?? "/* selector */";

  const line = failure.line ?? findLineNumber(source, selector);
  const { lines, startLine } = extractWindow(source, line ?? 1);
  const original = lines;

  // The patch appends the @media block directly after the matched rule.
  // We emit it as an addition after the existing lines.
  const mediaWrapper = [
    ``,
    `/* A11y-Agent: wrap motion in prefers-reduced-motion (WCAG 2.3.3) */`,
    `@media (prefers-reduced-motion: reduce) {`,
    `  ${selector} {`,
    `    transition: none;`,
    `    animation: none;`,
    `  }`,
    `}`,
  ];

  const patched = [...original, ...mediaWrapper];

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 2.3.3 — Animation from Interactions: CSS transitions and animations that run ` +
      `unconditionally can cause dizziness, nausea, and seizures for users with vestibular ` +
      `disorders. Wrapping them in \`@media (prefers-reduced-motion: reduce)\` respects the ` +
      `OS-level "Reduce Motion" preference set by ~35% of macOS users and ~26% of iOS users. ` +
      `The animation still runs for users who haven't enabled that preference.`,
    resolvedLine: line,
  };
}

// ── 2.3.1  Flashing content exceeding 3 Hz ───────────────────────────────────
function patchFlashing(
  failure: TestResult,
  source: string
): PatchResult {
  const line = failure.line ?? findLineNumber(source, "@keyframes");
  const { lines, startLine } = extractWindow(source, line ?? 1, 1);
  const original = lines;

  // Flashing content cannot be made safe by wrapping — the patch slows the
  // animation-duration to a safe threshold (> 333ms per cycle = < 3 Hz).
  const patched = original.map((l) =>
    // If animation-duration is set on this line, replace with a safe value
    l.replace(
      /animation-duration\s*:\s*[\d.]+m?s/gi,
      "animation-duration: 500ms /* A11y-Agent: slowed to < 3 Hz (WCAG 2.3.1) */"
    )
  );

  return {
    originalSnippet: original.join("\n"),
    patchedSnippet: patched.join("\n"),
    diff: buildUnifiedDiff(failure.filePath, startLine, original, patched),
    explanation:
      `WCAG 2.3.1 — Three Flashes or Below Threshold: content flashing faster than 3 times ` +
      `per second can trigger photosensitive epileptic seizures. Unlike other motion issues, ` +
      `this cannot be fixed with \`prefers-reduced-motion\` alone — it must be slowed or ` +
      `removed entirely. Set \`animation-duration\` to at least 500ms (2 Hz) or remove the ` +
      `flashing colour cycle and use a fade or opacity change instead.`,
    resolvedLine: line,
  };
}

// ─── Strategy router ──────────────────────────────────────────────────────────

/**
 * Map a failure's ruleId to the appropriate patch strategy function.
 * Falls back to a safe identity patch with a generic explanation when no
 * strategy is registered for the rule.
 */
function applyStrategy(
  failure: TestResult & { persona: PersonaType },
  source: string,
  palette: ApprovedFixPalette | undefined
): PatchResult {
  switch (failure.ruleId) {
    case "2.1.1":
      return patchUnfocusable(failure, source);
    case "2.4.7":
      return patchFocusIndicator(failure, source);
    case "4.1.2":
      return patchDivButton(failure, source);
    case "2.4.3":
      return patchPositiveTabindex(failure, source);
    case "1.4.3":
      return patchContrast(failure, source, palette);
    case "1.4.1":
      return patchColorBlindness(failure, source);
    case "2.2.2":
      return patchAutoplay(failure, source);
    case "2.3.3":
      return patchReducedMotion(failure, source);
    case "2.3.1":
      return patchFlashing(failure, source);
    default: {
      // Unknown rule — emit an identity diff so the PR comment still appears
      // with the explanation from suggestedFix, rather than silently skipping.
      const line = failure.line;
      const { lines, startLine } = extractWindow(source, line ?? 1);
      return {
        originalSnippet: lines.join("\n"),
        patchedSnippet: lines.join("\n"),
        diff: buildUnifiedDiff(failure.filePath, startLine, lines, lines),
        explanation:
          `WCAG ${failure.ruleId}: ${failure.suggestedFix} — no automatic patch strategy is ` +
          `registered for this rule yet. Review manually.`,
        resolvedLine: line,
      };
    }
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runDebugger(input: DebuggerInput): Promise<CodePatch> {
  const { failure, component, approvedFixPalette, componentIntent } = input;

  const source = component?.sourceCode ?? "";

  if (!source) {
    // No source available — return a minimal no-op patch so the PR comment
    // still surfaces the issue and explanation.
    const explanation =
      `WCAG ${failure.ruleId} — ${failure.issue} ` +
      `(source file not available for automatic patch; fix manually: ${failure.suggestedFix})`;
    return {
      filePath: failure.filePath,
      line: failure.line,
      originalSnippet: "",
      patchedSnippet: "",
      diff: `--- a/${failure.filePath}\n+++ b/${failure.filePath}\n@@ -0,0 +0,0 @@\n`,
      explanation,
    };
  }

  const result = applyStrategy(failure, source, approvedFixPalette);

  // Prepend component intent when available so developers understand the
  // ticket context in which this failure was found.
  const contextPrefix = componentIntent
    ? `[${componentIntent}] `
    : "";

  return {
    filePath: failure.filePath,
    line: result.resolvedLine,
    originalSnippet: result.originalSnippet,
    patchedSnippet: result.patchedSnippet,
    diff: result.diff,
    explanation: contextPrefix + result.explanation,
  };
}
