#!/usr/bin/env node
/**
 * A11y-Agent MCP Server
 *
 * Exposes the A11y engine as a Bob tool via the Model Context Protocol.
 * Registered in mcp.json as a local stdio server:
 *
 *   {
 *     "mcpServers": {
 *       "a11y-agent": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/a11y-agent/dist/mcp-server.js"]
 *       }
 *     }
 *   }
 *
 * Tool exposed:
 *   a11y_scan — Audit a local UI source file for WCAG 2.2 accessibility issues.
 *               Optionally supply a Jira spec file path for acceptance criteria context.
 *               Returns a markdown summary + unified diffs for each issue found.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runBobA11yTool } from "./integrations/bob-agent.js";

const server = new McpServer({
  name: "a11y-agent",
  version: "0.1.0",
});

// ─── Tool: a11y_scan ──────────────────────────────────────────────────────────

server.registerTool(
  "a11y_scan",
  {
    description:
      "Audit a local UI source file (HTML, JSX, TSX, CSS, SVG) for WCAG 2.2 " +
      "accessibility issues. Runs Motor, Visual, and Vestibular/Cognitive persona " +
      "checks and returns a markdown report with unified diffs that can be applied " +
      "directly with `git apply`. No GitHub token required.",
    inputSchema: z.object({
      filePath: z
        .string()
        .describe(
          "Workspace-relative path to the UI source file to audit (e.g. src/Button.tsx)."
        ),
      jiraTicketPath: z
        .string()
        .optional()
        .describe(
          "Optional workspace-relative path to a Jira spec Markdown file " +
            "(e.g. docs/CHKT-104.md). When provided, acceptance criteria are " +
            "extracted and used to focus the rule set."
        ),
      jiraMarkdown: z
        .string()
        .optional()
        .describe(
          "Optional raw Jira Markdown text. Use when you already have the spec " +
            "content in context. Takes precedence over jiraTicketPath."
        ),
    }),
  },
  async ({ filePath, jiraTicketPath, jiraMarkdown }) => {
    try {
      const result = await runBobA11yTool({
        filePath,
        jiraTicketPath,
        jiraMarkdown,
      });

      const diffSection =
        result.diffBlocks.length > 0
          ? "\n\n---\n\n### Suggested Patches\n\n" +
            result.diffBlocks
              .map(
                (b) =>
                  `**${b.persona} — WCAG ${b.ruleId}** (\`${b.filePath}${b.line ? `:${b.line}` : ""}\`)\n` +
                  `> ${b.explanation}\n\`\`\`diff\n${b.diff}\n\`\`\``
              )
              .join("\n\n")
          : "";

      return {
        content: [
          {
            type: "text" as const,
            text: result.summary + diffSection,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `A11y scan failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[A11y-Agent MCP] Server running on stdio");
}

main().catch((error) => {
  console.error("[A11y-Agent MCP] Fatal error:", error);
  process.exit(1);
});
