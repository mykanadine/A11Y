/**
 * Vestibular/Cognitive Simulator persona.
 * Scope: motion and animation-trigger checks only.
 * WCAG rules covered: 2.2.2 (auto-play / auto-advance), 2.3.3 (prefers-reduced-motion), 2.3.1 (flashing)
 */

import type { PersonaReport, TestResult, UIComponent, WCAGRule } from "../../types/index.js";
import type { PersonaInput } from "../persona.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Return all 1-based line numbers in `src` where `pattern` matches. */
function matchLines(src: string, pattern: RegExp): number[] {
  const lines = src.split("\n");
  const results: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) results.push(i + 1);
  }
  return results;
}

/** Return the first 1-based line in `src` where `pattern` matches, or null. */
function firstMatchLine(src: string, pattern: RegExp): number | null {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return i + 1;
  }
  return null;
}

/**
 * Very small luminance estimator from a CSS hex colour string.
 * Handles #rgb, #rrggbb. Returns null when it cannot parse.
 */
function hexLuminance(hex: string): number | null {
  const clean = hex.replace("#", "");
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0]! + clean[0]!, 16);
    g = parseInt(clean[1]! + clean[1]!, 16);
    b = parseInt(clean[2]! + clean[2]!, 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return null;
  }
  const linearise = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * Collect all CSS text in scope:
 * 1. <style> blocks from compiledHTML
 * 2. inline style attributes from compiledHTML
 * 3. raw sourceCode (catches CSS-in-JS / Tailwind arbitrary values)
 */
function extractAllCSS(compiledHTML: string, sourceCode: string): string {
  const parts: string[] = [];

  // <style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleBlockRe.exec(compiledHTML)) !== null) {
    parts.push(m[1]!);
  }

  // inline style attributes
  const inlineRe = /style="([^"]*)"/gi;
  while ((m = inlineRe.exec(compiledHTML)) !== null) {
    parts.push(m[1]!);
  }

  // raw source
  parts.push(sourceCode);

  return parts.join("\n");
}

/**
 * True if the CSS position is already nested inside a prefers-reduced-motion
 * media query in the supplied full CSS text.
 */
function isWrappedInReducedMotion(css: string, needle: string): boolean {
  // Find all @media (prefers-reduced-motion: …) blocks and check if needle sits inside one.
  const mediaRe =
    /@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*\{([\s\S]*?)\}/gi;
  let m: RegExpExecArray | null;
  while ((m = mediaRe.exec(css)) !== null) {
    if (m[1]!.includes(needle)) return true;
  }
  return false;
}

// ─── rule-scope filter ────────────────────────────────────────────────────────

function applicableRuleIds(input: PersonaInput): Set<string> {
  const rules: WCAGRule[] =
    input.complianceContext.rulesByPersona?.vestibular ??
    input.complianceContext.applicableRules;
  return new Set(rules.map((r) => r.id));
}

// ─── CHECK 1: auto-playing media (WCAG 2.2.2) ────────────────────────────────

function checkAutoPlayingMedia(
  component: UIComponent,
  scopeIds: Set<string>
): TestResult[] {
  if (!scopeIds.has("2.2.2")) return [];
  const results: TestResult[] = [];
  const { compiledHTML, sourceCode, filePath } = component;

  // Helper: does the parent element contain a pause control?
  const hasPauseControl = (parentHTML: string): boolean => {
    return (
      /controls[\s/>]/i.test(parentHTML) ||
      /<button/i.test(parentHTML) ||
      /role=["']button["']/i.test(parentHTML)
    );
  };

  // Scan <video …autoplay…> blocks
  const videoRe = /<video([^>]*)>([\s\S]*?)<\/video>/gi;
  let m: RegExpExecArray | null;
  while ((m = videoRe.exec(compiledHTML)) !== null) {
    const attrs = m[1]!;
    const inner = m[2]!;
    if (/\bautoplay\b/i.test(attrs)) {
      if (!hasPauseControl(attrs + inner)) {
        const line = firstMatchLine(sourceCode, /<video/i);
        results.push({
          status: "fail",
          ruleId: "2.2.2",
          filePath,
          line,
          issue: "Video element has autoplay with no visible pause/stop control",
          suggestedFix:
            'Add `controls` attribute to <video> to expose native pause/stop UI.',
        });
      }
    }
  }

  // Scan <audio …autoplay…> blocks
  const audioRe = /<audio([^>]*)>([\s\S]*?)<\/audio>/gi;
  while ((m = audioRe.exec(compiledHTML)) !== null) {
    const attrs = m[1]!;
    const inner = m[2]!;
    if (/\bautoplay\b/i.test(attrs)) {
      if (!hasPauseControl(attrs + inner)) {
        const line = firstMatchLine(sourceCode, /<audio/i);
        results.push({
          status: "fail",
          ruleId: "2.2.2",
          filePath,
          line,
          issue: "Audio element has autoplay with no visible pause/stop control",
          suggestedFix:
            'Add `controls` attribute to <audio> to expose native pause/stop UI.',
        });
      }
    }
  }

  // Scan <img src="…*.gif" …> elements
  const imgRe = /<img([^>]*)>/gi;
  while ((m = imgRe.exec(compiledHTML)) !== null) {
    const attrs = m[1]!;
    if (/src=["'][^"']*\.gif["']/i.test(attrs)) {
      // Check for an adjacent pause control — scan the nearest parent block (heuristic: 200 chars before/after)
      const start = Math.max(0, m.index - 200);
      const end = Math.min(compiledHTML.length, m.index + m[0].length + 200);
      const surrounding = compiledHTML.slice(start, end);
      if (!/<button/i.test(surrounding) && !/role=["']button["']/i.test(surrounding)) {
        const line = firstMatchLine(sourceCode, /\.gif/i);
        results.push({
          status: "fail",
          ruleId: "2.2.2",
          filePath,
          line,
          issue: "Animated GIF image has no adjacent pause control button",
          suggestedFix:
            "Add a <button> adjacent to the GIF that pauses/stops the animation, or replace the GIF with a video element with `controls`.",
        });
      }
    }
  }

  // React JSX: autoPlay (camelCase) in sourceCode
  const autoPlayLines = matchLines(sourceCode, /\bautoPlay\b/);
  for (const lineNum of autoPlayLines) {
    // Only flag if the line also doesn't reference controls or a handler that hints at a pause button
    const srcLine = sourceCode.split("\n")[lineNum - 1]!;
    if (!/controls/i.test(srcLine) && !/onPause|onStop|pause|stop/i.test(srcLine)) {
      results.push({
        status: "fail",
        ruleId: "2.2.2",
        filePath,
        line: lineNum,
        issue:
          "React JSX `autoPlay` prop detected with no visible pause control",
        suggestedFix:
          "Replace autoPlay with a user-triggered play mechanism, or ensure `controls` is also set.",
      });
    }
  }

  return results;
}

// ─── CHECK 2: auto-advancing carousels (WCAG 2.2.2) ──────────────────────────

const CAROUSEL_CLASS_RE =
  /\b(carousel|slider|swiper|splide|glide|marquee)\b/i;
const PAUSE_BUTTON_RE = /aria-label=["'][^"']*(pause|stop|freeze)[^"']*["']|<button[^>]*>\s*(pause|stop|freeze)/i;
const AUTO_ADVANCE_PROP_RE =
  /autoplay\s*:\s*true|autoPlay=\{true\}|interval=\{?['"]?\d|delay=\{?['"]?\d/i;

function checkAutoCarousel(
  component: UIComponent,
  scopeIds: Set<string>
): TestResult[] {
  if (!scopeIds.has("2.2.2")) return [];
  const results: TestResult[] = [];
  const { compiledHTML, sourceCode, filePath } = component;

  // Unconditionally flag <marquee>
  const marqueeRe = /<marquee([^>]*)>([\s\S]*?)<\/marquee>/gi;
  let m: RegExpExecArray | null;
  while ((m = marqueeRe.exec(compiledHTML)) !== null) {
    const line = firstMatchLine(sourceCode, /<marquee/i);
    results.push({
      status: "fail",
      ruleId: "2.2.2",
      filePath,
      line,
      issue:
        "<marquee> element detected — deprecated, auto-scrolling, cannot be paused",
      suggestedFix:
        "Replace <marquee> with a CSS-animated element that respects `prefers-reduced-motion` and include a pause/stop button.",
    });
  }

  // Elements with carousel/slider/… class or id
  // Match opening tags that have class= or id= containing carousel keywords
  const tagRe = /<[a-z][a-z0-9-]*([^>]*(?:class|id)=["'][^"']*(?:carousel|slider|swiper|splide|glide|marquee)[^"']*["'][^>]*)>/gi;
  const checkedTags = new Set<number>();
  while ((m = tagRe.exec(compiledHTML)) !== null) {
    if (checkedTags.has(m.index)) continue;
    checkedTags.add(m.index);

    // Look ahead in the HTML (heuristic: up to 500 chars) for a pause button
    const ahead = compiledHTML.slice(m.index, Math.min(compiledHTML.length, m.index + 500));
    if (!PAUSE_BUTTON_RE.test(ahead)) {
      const classOrId = (m[1]!.match(/(?:class|id)=["']([^"']+)["']/i) ?? [])[1] ?? "";
      const matchedKeyword = (CAROUSEL_CLASS_RE.exec(classOrId) ?? [])[0] ?? "carousel";
      const line = firstMatchLine(sourceCode, new RegExp(matchedKeyword, "i"));
      results.push({
        status: "fail",
        ruleId: "2.2.2",
        filePath,
        line,
        issue: `Auto-advancing carousel/slider element (.${matchedKeyword}) has no pause/stop button`,
        suggestedFix:
          "Add a pause/stop button control to the carousel with an accessible aria-label (e.g. aria-label=\"Pause carousel\").",
      });
    }
  }

  // sourceCode: timed advancement props
  const autoAdvanceLines = matchLines(sourceCode, AUTO_ADVANCE_PROP_RE);
  for (const lineNum of autoAdvanceLines) {
    results.push({
      status: "fail",
      ruleId: "2.2.2",
      filePath,
      line: lineNum,
      issue:
        "Carousel/slider configured with auto-advance timing (autoplay/interval/delay)",
      suggestedFix:
        "Set autoplay to false by default and require explicit user action to advance slides.",
    });
  }

  return results;
}

// ─── CHECK 3: CSS transitions/animations without prefers-reduced-motion (WCAG 2.3.3) ──

/**
 * Extract (selector, property, rawSnippet) triples for motion-related CSS declarations
 * that are NOT already inside a @media (prefers-reduced-motion: …) block.
 */
interface CSSMotionFinding {
  selector: string;
  property: string;
  raw: string;
}

// Patterns that are explicitly safe (no-op values)
const SAFE_MOTION_RE =
  /\b(transition|animation)\s*:\s*none\b|transition-duration\s*:\s*0s\b/i;

function checkReducedMotion(
  component: UIComponent,
  scopeIds: Set<string>
): TestResult[] {
  if (!scopeIds.has("2.3.3")) return [];
  const results: TestResult[] = [];
  const { compiledHTML, sourceCode, filePath } = component;

  const allCSS = extractAllCSS(compiledHTML, sourceCode);

  // Motion-relevant property patterns we care about
  const motionProps: Array<{ label: string; re: RegExp }> = [
    { label: "transition", re: /\btransition\s*:/i },
    { label: "animation", re: /\banimation\s*:/i },
    { label: "@keyframes", re: /@keyframes\s+\S+/i },
    { label: "transform (with transition)", re: /\btransform\s*:/i },
  ];

  const findings: CSSMotionFinding[] = [];

  // Split CSS into logical lines for scanning
  const cssLines = allCSS.split("\n");
  for (let i = 0; i < cssLines.length; i++) {
    const line = cssLines[i]!;
    for (const { label, re } of motionProps) {
      if (!re.test(line)) continue;
      if (SAFE_MOTION_RE.test(line)) continue;

      // Skip if this line is inside a prefers-reduced-motion block
      if (isWrappedInReducedMotion(allCSS, line.trim())) continue;

      // Try to infer the CSS selector (walk backwards looking for a selector line)
      let selector = "<unknown>";
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const candidate = cssLines[j]!.trim();
        if (candidate.endsWith("{") || (/^[.#a-zA-Z[\](*>~+]/.test(candidate) && !candidate.startsWith("/"))) {
          selector = candidate.replace(/\{$/, "").trim();
          break;
        }
      }

      findings.push({ selector, property: label, raw: line.trim() });
    }
  }

  // Deduplicate (same selector + property combination)
  const seen = new Set<string>();
  for (const f of findings) {
    const key = `${f.selector}::${f.property}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const line = firstMatchLine(sourceCode, new RegExp(escapeRegex(f.raw.slice(0, 40)), "i")) ??
      firstMatchLine(sourceCode, new RegExp(escapeRegex(f.selector), "i"));

    const suggestedFix =
      `@media (prefers-reduced-motion: reduce) {\n  ${f.selector} { transition: none; animation: none; }\n}`;

    results.push({
      status: "fail",
      ruleId: "2.3.3",
      filePath,
      line: line ?? null,
      issue: `CSS \`${f.property}\` on \`${f.selector}\` is not wrapped in @media (prefers-reduced-motion)`,
      suggestedFix,
    });
  }

  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── CHECK 4: flashing content (WCAG 2.3.1) ──────────────────────────────────

/**
 * Parse a CSS colour value string and return its relative luminance, or null.
 * Handles hex (#rgb / #rrggbb) and rgb(r,g,b) / rgba(r,g,b,a).
 */
function parseLuminance(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return hexLuminance(trimmed);
  const rgbM = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgbM) {
    const r = parseInt(rgbM[1]!, 10);
    const g = parseInt(rgbM[2]!, 10);
    const b = parseInt(rgbM[3]!, 10);
    return hexLuminance(
      "#" +
        [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")
    );
  }
  return null;
}

/**
 * Parse animation-duration CSS value to milliseconds, or null if unparseable.
 */
function parseDurationMs(value: string): number | null {
  const trimmed = value.trim();
  const msMatch = /^([\d.]+)ms$/.exec(trimmed);
  if (msMatch) return parseFloat(msMatch[1]!);
  const sMatch = /^([\d.]+)s$/.exec(trimmed);
  if (sMatch) return parseFloat(sMatch[1]!) * 1000;
  return null;
}

function checkFlashingContent(
  component: UIComponent,
  scopeIds: Set<string>
): TestResult[] {
  if (!scopeIds.has("2.3.1")) return [];
  const results: TestResult[] = [];
  const { compiledHTML, sourceCode, filePath } = component;

  const allCSS = extractAllCSS(compiledHTML, sourceCode);

  // Extract @keyframes blocks
  const keyframesRe = /@keyframes\s+(\S+)\s*\{([\s\S]*?)\}/gi;
  let m: RegExpExecArray | null;
  while ((m = keyframesRe.exec(allCSS)) !== null) {
    const name = m[1]!;
    const body = m[2]!;

    // Collect colour values mentioned inside this @keyframes
    const colourValues: number[] = [];
    const colourRe =
      /(?:background-color|color)\s*:\s*([^;}\n]+)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = colourRe.exec(body)) !== null) {
      const lum = parseLuminance(cm[1]!.trim());
      if (lum !== null) colourValues.push(lum);
    }

    if (colourValues.length < 2) continue;

    const minLum = Math.min(...colourValues);
    const maxLum = Math.max(...colourValues);
    const luminanceDiff = maxLum - minLum;
    if (luminanceDiff <= 0.5) continue;

    // Check shorthand: animation: <duration> ... <name> ...
    const shorthandRe = /animation\s*:\s*([^;]+);/gi;
    let foundFastFlash = false;
    let durationMs: number | null = null;

    let am: RegExpExecArray | null;
    while ((am = shorthandRe.exec(allCSS)) !== null) {
      const val = am[1]!;
      if (!val.includes(name)) continue;
      // Try to extract a duration token (e.g. "0.1s", "100ms")
      const durMatch = /([\d.]+m?s)\b/.exec(val);
      if (durMatch) {
        durationMs = parseDurationMs(durMatch[1]!);
        if (durationMs !== null && durationMs <= 333) {
          foundFastFlash = true;
        }
      }
    }

    // Try longhand animation-duration
    if (!foundFastFlash) {
      const longhandRe = /animation-duration\s*:\s*([^;]+);/gi;
      while ((am = longhandRe.exec(allCSS)) !== null) {
        durationMs = parseDurationMs(am[1]!.trim());
        if (durationMs !== null && durationMs <= 333) {
          // We can't definitively link it to this keyframe without deeper parsing,
          // but if a fast duration exists alongside a flashing keyframe, flag it.
          foundFastFlash = true;
        }
      }
    }

    // Also check steps() timing on the animation — many steps in a short duration
    const stepsRe = new RegExp(
      `animation\\s*:[^;]*${escapeRegex(name)}[^;]*steps\\(\\s*(\\d+)`,
      "gi"
    );
    while ((am = stepsRe.exec(allCSS)) !== null) {
      const steps = parseInt(am[1]!, 10);
      if (steps >= 6) foundFastFlash = true; // heuristic
    }

    if (foundFastFlash) {
      const line = firstMatchLine(
        sourceCode,
        new RegExp(`@keyframes\\s+${escapeRegex(name)}`, "i")
      );
      results.push({
        status: "fail",
        ruleId: "2.3.1",
        filePath,
        line,
        issue: `@keyframes \`${name}\` cycles between high-contrast colours (luminance Δ ${luminanceDiff.toFixed(2)}) at > 3 flashes/second (duration ≤ 333ms)`,
        suggestedFix:
          "Remove or replace flashing animation — no prefers-reduced-motion wrapper can make content that exceeds 3 flashes/second WCAG compliant.",
      });
    }
  }

  // Secondary heuristic is fully covered by the shorthand/longhand loops above.
  return results;
}

// ─── pass records ─────────────────────────────────────────────────────────────

/**
 * For each rule in scope that has zero failures across all components,
 * emit a single "pass" result.
 */
function buildPassRecords(
  scopeIds: Set<string>,
  failures: TestResult[],
  components: UIComponent[]
): TestResult[] {
  const failedRules = new Set(failures.map((f) => f.ruleId));
  const passResults: TestResult[] = [];
  for (const ruleId of scopeIds) {
    if (!failedRules.has(ruleId)) {
      // Emit one pass per component (or a single pass if no components)
      const targets = components.length > 0 ? components : [{ filePath: "", componentName: "" } as UIComponent];
      for (const comp of targets) {
        passResults.push({
          status: "pass",
          ruleId,
          filePath: comp.filePath,
          line: null,
          issue: "",
          suggestedFix: "",
        });
      }
    }
  }
  return passResults;
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function runVestibularPersona(
  input: PersonaInput
): Promise<PersonaReport> {
  const scopeIds = applicableRuleIds(input);
  const failures: TestResult[] = [];

  for (const component of input.components) {
    failures.push(...checkAutoPlayingMedia(component, scopeIds));
    failures.push(...checkAutoCarousel(component, scopeIds));
    failures.push(...checkReducedMotion(component, scopeIds));
    failures.push(...checkFlashingContent(component, scopeIds));
  }

  const passes = buildPassRecords(scopeIds, failures, input.components);

  return {
    persona: "Vestibular/Cognitive",
    results: [...failures, ...passes],
  };
}
