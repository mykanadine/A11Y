/**
 * Motor Impairment Simulator Persona
 *
 * Simulates keyboard-only navigation by statically analysing the compiled
 * DOM snapshot (compiledHTML) and the original source code of each component.
 * Does NOT use a headless browser, mouse events, or Playwright.
 */

import { parseHTML } from "linkedom";
import type { PersonaInput } from "../persona.js";
import type { PersonaReport, TestResult, WCAGRule, UIComponent } from "../../types/index.js";

// ─── Selector constants ───────────────────────────────────────────────────────

const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [onclick], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"]';

const FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [onclick], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [tabindex]';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the set of ruleIds that are in scope for the motor persona. */
function inScopeRuleIds(complianceContext: PersonaInput["complianceContext"]): Set<string> {
  const rules: WCAGRule[] =
    complianceContext.rulesByPersona?.motor ?? complianceContext.applicableRules;
  return new Set(rules.map((r) => r.id));
}

/**
 * Try to find the 1-based line number in sourceCode where `needle` first
 * appears. Returns null when not found.
 */
function findLine(sourceCode: string, needle: string): number | null {
  if (!needle) return null;
  const idx = sourceCode.indexOf(needle);
  if (idx === -1) return null;
  return sourceCode.slice(0, idx).split("\n").length;
}

/**
 * Given an element, produce a short but unique search string we can look up
 * in the source. Prefer id, then a short outerHTML prefix.
 */
function elementNeedle(el: Element): string {
  const id = el.getAttribute("id");
  if (id) return `id="${id}"`;
  const outer = el.outerHTML ?? "";
  // Take opening tag only (up to first ">"), max 80 chars
  const tag = outer.slice(0, outer.indexOf(">") + 1).slice(0, 80);
  return tag;
}

/** Build a short human label for an element, e.g. "button#submit" or "div[onclick]". */
function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  if (id) return `${tag}#${id}`;
  const cls = el.getAttribute("class");
  if (cls) return `${tag}.${cls.trim().split(/\s+/)[0]}`;
  return tag;
}

// ─── Focus-indicator CSS helpers ─────────────────────────────────────────────

/**
 * Extract all `:focus` / `:focus-visible` rule bodies from the inline
 * `<style>` blocks inside compiledHTML. Returns the concatenated CSS text.
 */
function extractFocusCSS(document: ReturnType<typeof parseHTML>["document"]): string {
  const styleEls = document.querySelectorAll("style");
  let css = "";
  for (const s of styleEls) {
    css += s.textContent ?? "";
  }
  // Extract only rule bodies that are tied to :focus or :focus-visible
  const focusRuleRe = /:[:]?focus(?:-visible)?[^{]*\{([^}]*)\}/gi;
  let focusCss = "";
  let m: RegExpExecArray | null;
  while ((m = focusRuleRe.exec(css)) !== null) {
    focusCss += m[1] + " ";
  }
  return focusCss;
}

/**
 * Returns true when the given CSS body suppresses the outline AND offers no
 * compensating box-shadow or border-based focus ring.
 */
function isOutlineSuppressedWithoutCompensation(cssBody: string): boolean {
  const outlineRe = /outline\s*:\s*(none|0)\b/i;
  if (!outlineRe.test(cssBody)) return false;
  // Compensation: box-shadow or border changes
  const compensationRe = /box-shadow\s*:|border\s*:/i;
  return !compensationRe.test(cssBody);
}

/**
 * Returns true when an element's inline style suppresses focus outline.
 * (We inspect the `style` attribute directly as a CSS fragment.)
 */
function inlineStyleSuppressesFocus(el: Element): boolean {
  const style = el.getAttribute("style") ?? "";
  return isOutlineSuppressedWithoutCompensation(style);
}

// ─── Per-check functions ──────────────────────────────────────────────────────

function checkMissingAltText(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "1.1.1";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const images = document.querySelectorAll("img");

  for (const img of images) {
    // alt="" is valid (decorative image) — only flag when attribute is absent
    if (img.hasAttribute("alt")) continue;

    const needle = elementNeedle(img);
    const line = findLine(component.sourceCode, needle);
    const src = img.getAttribute("src") ?? "";
    const label = src ? `<img src="${src}">` : "<img>";

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} is missing an alt attribute — screen readers will announce the file name or skip the image entirely`,
      suggestedFix: `Add a descriptive alt attribute, e.g. alt="Description of image". Use alt="" for purely decorative images.`,
    });
  }

  return results;
}

function checkUnfocusableInteractive(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "2.1.1";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const elements = document.querySelectorAll(INTERACTIVE_SELECTOR);

  for (const el of elements) {
    const tabindex = el.getAttribute("tabindex");
    const disabled = el.hasAttribute("disabled");
    const unreachable = tabindex === "-1" || disabled;
    if (!unreachable) continue;

    const label = elementLabel(el);
    const reason = tabindex === "-1" ? `tabindex="-1"` : "disabled attribute";
    const needle = elementNeedle(el);
    const line = findLine(component.sourceCode, needle);

    const suggestedFix =
      tabindex === "-1"
        ? `Remove tabindex="-1" from <${el.tagName.toLowerCase()}${el.getAttribute("id") ? ` id="${el.getAttribute("id")}"` : ""}>`
        : `Remove the disabled attribute from <${el.tagName.toLowerCase()}> or provide a keyboard-accessible alternative`;

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} is not keyboard-focusable (${reason})`,
      suggestedFix,
    });
  }

  return results;
}

function checkMissingFocusIndicator(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "2.4.7";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const globalFocusCSS = extractFocusCSS(document);
  const globalSuppressed = isOutlineSuppressedWithoutCompensation(globalFocusCSS);

  const elements = document.querySelectorAll(FOCUSABLE_SELECTOR);

  for (const el of elements) {
    const suppressed = globalSuppressed || inlineStyleSuppressesFocus(el);
    if (!suppressed) continue;

    const label = elementLabel(el);
    const needle = elementNeedle(el);
    const line = findLine(component.sourceCode, needle);

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} has no visible focus indicator (outline suppressed with no compensating box-shadow or border)`,
      suggestedFix: `Replace "outline: none" with a visible focus style, e.g. ":focus-visible { outline: 2px solid #005fcc; outline-offset: 2px; }"`,
    });
  }

  return results;
}

function checkDivSpanInteractive(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "4.1.2";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];

  // DOM check: div/span with onclick or onkeydown
  const domElements = document.querySelectorAll(
    "div[onclick], span[onclick], div[onkeydown], span[onkeydown]",
  );

  for (const el of domElements) {
    const hasRole = el.hasAttribute("role");
    const hasTabindex = el.hasAttribute("tabindex");
    if (hasRole && hasTabindex) continue;

    const label = elementLabel(el);
    const needle = elementNeedle(el);
    const line = findLine(component.sourceCode, needle);
    const missing = !hasRole && !hasTabindex
      ? "role and tabindex"
      : !hasRole
        ? "role"
        : "tabindex";

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} acts as an interactive element but is missing ${missing}`,
      suggestedFix: `Add role="button" and tabIndex={0} to <${el.tagName.toLowerCase()}>, and handle onKeyDown for Enter/Space keys`,
    });
  }

  // Source-code scan: React-style <div onClick= or <span onClick= without role= and tabIndex=
  const sourceLines = component.sourceCode.split("\n");
  const jsxClickRe = /<(div|span)[^>]*\bonClick\s*=/;
  const roleRe = /\brole\s*=/;
  const tabIndexRe = /\btabIndex\s*=/;

  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i]!;
    if (!jsxClickRe.test(line)) continue;
    if (roleRe.test(line) || tabIndexRe.test(line)) continue;

    // Multi-line JSX: scan ahead a few lines for role/tabIndex
    const window = sourceLines.slice(i, i + 5).join(" ");
    if (roleRe.test(window) || tabIndexRe.test(window)) continue;

    // Extract tag name
    const tagMatch = line.match(/<(div|span)/);
    const tag = tagMatch ? tagMatch[1] : "div";

    // Extract id if present
    const idMatch = line.match(/\bid\s*=\s*["'{`]([^"'{`]+)/);
    const label = idMatch ? `${tag}#${idMatch[1]}` : tag;

    // Avoid duplicate — skip if DOM check already flagged this line
    const alreadyFlagged = results.some((r) => r.line === i + 1);
    if (alreadyFlagged) continue;

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line: i + 1,
      issue: `<${tag}> (line ${i + 1}) has onClick but no role or tabIndex — inaccessible to keyboard users`,
      suggestedFix: `Add role="button" tabIndex={0} to the <${tag}>, and add an onKeyDown handler for Enter/Space`,
    });
  }

  return results;
}

function checkPositiveTabindex(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "2.4.3";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const elements = document.querySelectorAll("[tabindex]");

  for (const el of elements) {
    const val = parseInt(el.getAttribute("tabindex") ?? "0", 10);
    if (val <= 0) continue;

    const label = elementLabel(el);
    const needle = elementNeedle(el);
    const line = findLine(component.sourceCode, needle);

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} has tabindex="${val}" — positive tabindex values disrupt natural DOM/reading order`,
      suggestedFix: `Replace tabindex="${val}" with tabindex="0" and reorder the element in the DOM to achieve the desired focus sequence`,
    });
  }

  return results;
}

// ─── Additional checks ────────────────────────────────────────────────────────

function checkUnlabelledInputs(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "3.3.2";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const inputs = document.querySelectorAll("input, select, textarea");

  for (const input of inputs) {
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    // hidden / submit / reset / button / image inputs don't need a label
    if (["hidden", "submit", "reset", "button", "image"].includes(type)) continue;

    const id = input.getAttribute("id");
    const hasLabel =
      input.hasAttribute("aria-label") ||
      input.hasAttribute("aria-labelledby") ||
      input.hasAttribute("title") ||
      (id && document.querySelector(`label[for="${id}"]`) !== null) ||
      // input wrapped directly inside a <label>
      input.closest("label") !== null;

    if (hasLabel) continue;

    const needle = elementNeedle(input);
    const line = findLine(component.sourceCode, needle);
    const tag = input.tagName.toLowerCase();
    const label = id ? `${tag}#${id}` : elementLabel(input);

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} has no associated label — screen readers cannot announce what the field is for`,
      suggestedFix: `Add a <label for="${id ?? "FIELD_ID"}">…</label>, or add aria-label="…" directly on the element`,
    });
  }

  return results;
}

function checkEmptyButtons(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "4.1.2";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const buttons = document.querySelectorAll("button");

  for (const btn of buttons) {
    const hasText = (btn.textContent ?? "").trim().length > 0;
    const hasAriaLabel = btn.hasAttribute("aria-label") || btn.hasAttribute("aria-labelledby");
    const hasTitle = btn.hasAttribute("title");
    const hasImgWithAlt = Array.from(btn.querySelectorAll("img[alt]")).some(
      (img) => (img.getAttribute("alt") ?? "").trim().length > 0
    );

    if (hasText || hasAriaLabel || hasTitle || hasImgWithAlt) continue;

    const needle = elementNeedle(btn);
    const line = findLine(component.sourceCode, needle);
    const label = elementLabel(btn);

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `${label} has no accessible name — screen readers will announce it as an unlabelled button`,
      suggestedFix: `Add descriptive text content, an aria-label="…" attribute, or a visually-hidden <span> inside the button`,
    });
  }

  return results;
}

function checkTableHeaders(
  document: ReturnType<typeof parseHTML>["document"],
  component: UIComponent,
  inScope: Set<string>,
): TestResult[] {
  const RULE = "1.3.1";
  if (!inScope.has(RULE)) return [];

  const results: TestResult[] = [];
  const tables = document.querySelectorAll("table");

  for (const table of tables) {
    const hasHeaders =
      table.querySelector("th") !== null ||
      table.querySelector("[role='columnheader']") !== null ||
      table.querySelector("[role='rowheader']") !== null;

    if (hasHeaders) continue;

    // Skip layout tables (role="presentation" or role="none")
    const role = table.getAttribute("role") ?? "";
    if (role === "presentation" || role === "none") continue;

    const needle = elementNeedle(table);
    const line = findLine(component.sourceCode, needle);

    results.push({
      status: "fail",
      ruleId: RULE,
      filePath: component.filePath,
      line,
      issue: `<table> has no <th> header cells — screen readers cannot identify column or row meanings`,
      suggestedFix: `Add <th scope="col"> cells to the first row (or <th scope="row"> for row headers) to provide column/row context`,
    });
  }

  return results;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runMotorPersona(input: PersonaInput): Promise<PersonaReport> {
  const inScope = inScopeRuleIds(input.complianceContext);
  const allResults: TestResult[] = [];

  const RULES_CHECKED = ["1.1.1", "1.3.1", "2.1.1", "2.4.7", "4.1.2", "2.4.3", "3.3.2"] as const;

  for (const component of input.components) {
    const { document } = parseHTML(component.compiledHTML);

    const failures: TestResult[] = [
      ...checkMissingAltText(document, component, inScope),
      ...checkUnfocusableInteractive(document, component, inScope),
      ...checkMissingFocusIndicator(document, component, inScope),
      ...checkDivSpanInteractive(document, component, inScope),
      ...checkPositiveTabindex(document, component, inScope),
      ...checkUnlabelledInputs(document, component, inScope),
      ...checkEmptyButtons(document, component, inScope),
      ...checkTableHeaders(document, component, inScope),
    ];

    // Track which rules produced at least one failure for this component
    const failedRuleIds = new Set(failures.map((f) => f.ruleId));

    allResults.push(...failures);

    // Emit one pass per in-scope rule that had no failures
    for (const ruleId of RULES_CHECKED) {
      if (!inScope.has(ruleId)) continue;
      if (failedRuleIds.has(ruleId)) continue;

      allResults.push({
        status: "pass",
        ruleId,
        filePath: component.filePath,
        line: null,
        issue: "",
        suggestedFix: "",
      });
    }
  }

  return {
    persona: "Motor",
    results: allResults,
  };
}
