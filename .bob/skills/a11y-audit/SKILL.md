---
name: a11y-audit
description: >-
  Use when the user wants to audit a UI source file for accessibility issues,
  run a WCAG 2.2 scan, check accessibility compliance, or review a component
  against a Jira story. Walks through scanning, explaining failures, and
  applying or negotiating fixes with the developer.
---

# A11y Audit Skill

Follow these steps every time an accessibility audit is requested.

## Step 1 — Identify the target file

Ask the user which file to audit if not already clear from context.
Accepted types: `.jsx`, `.tsx`, `.js`, `.ts`, `.html`, `.css`, `.scss`, `.svg`.

If the user references a Jira ticket or spec document (e.g. `CHKT-104.md`),
note its path — you will pass it as `jiraTicketPath` in Step 2.

## Step 2 — Run the scan

Call the `a11y_scan` MCP tool:

```
filePath:       <workspace-relative path to the UI file>
jiraTicketPath: <path to Jira Markdown spec, if provided>
jiraMarkdown:   <inline Jira text, if already in context>
```

While the scan runs, narrate what is happening:

```
⚡ Ingesting WCAG 2.2 rules...
⚡ Launching Motor, Visual, and Vestibular/Cognitive persona subagents in parallel...
⚡ Analysing <filename>...
```

## Step 3 — Present findings

For each failure returned:

1. **State the rule** — e.g. "WCAG 4.1.2 — Name, Role, Value (Motor persona)"
2. **Explain why it matters** — one sentence in plain English aimed at a junior developer.
3. **Show the diff** — display the unified diff in a fenced ```diff block.
4. **Offer to apply it** — ask "Shall I apply this patch?"

Group failures by persona in this order: Motor → Visual → Vestibular/Cognitive.

If zero failures are found, confirm all checks passed and list the rules that were verified.

## Step 4 — Apply or negotiate patches

If the developer accepts a patch, use `apply_diff` or `search_and_replace` to apply it
to the source file.

If the developer requests a different approach (e.g. "use a native `<button>` instead of
`role=button`"), regenerate the patch to honour that preference. Keep existing class names,
event handlers, and props intact — change only what is necessary for accessibility compliance.

Confirm the change is still WCAG-compliant before applying.

## Step 5 — Re-scan after changes

After applying any patches, offer to re-run the scan to confirm the issue is resolved
and no new issues were introduced.

Use `update_todo_list` to track which issues have been fixed and which are pending.

## Notes

- Never speculate about code you have not scanned.
- Always cite the WCAG rule ID and level (A/AA/AAA) when reporting an issue.
- When no Jira spec is provided, the scan still runs against the full WCAG 2.2 A+AA rule set.
- The scan engine is purely static — it does not execute JavaScript or render components.
  Results are based on source code and DOM structure analysis only.
