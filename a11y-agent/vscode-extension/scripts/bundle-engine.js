#!/usr/bin/env node
/**
 * bundle-engine.js
 *
 * Bundles the a11y-agent core into a single self-contained CommonJS file
 * that the installed VS Code extension can execute with:
 *
 *   node engine/index.cjs local <filePath> --json
 *
 * Also copies the WCAG 2.2 JSON data file alongside the bundle, since
 * the rule-engine reads it from disk at runtime (createRequire path).
 *
 * Run from:  a11y-agent/vscode-extension/
 *   node scripts/bundle-engine.js
 *
 * Or via:    npm run bundle-engine
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const EXTENSION_ROOT = path.resolve(__dirname, "..");
const AGENT_ROOT = path.resolve(EXTENSION_ROOT, "..");
const ENGINE_OUT_DIR = path.join(EXTENSION_ROOT, "engine");
const ENGINE_ENTRY = path.join(AGENT_ROOT, "src", "index.ts");
const WCAG_DATA_SRC = path.join(AGENT_ROOT, "src", "data", "wcag-2.2-index.json");
const WCAG_DATA_DEST_DIR = path.join(ENGINE_OUT_DIR, "data");
const WCAG_DATA_DEST = path.join(WCAG_DATA_DEST_DIR, "wcag-2.2-index.json");

async function main() {
  console.log("[bundle-engine] Building standalone engine bundle…");

  // Ensure output directories exist
  fs.mkdirSync(ENGINE_OUT_DIR, { recursive: true });
  fs.mkdirSync(WCAG_DATA_DEST_DIR, { recursive: true });

  // ── Bundle with esbuild ────────────────────────────────────────────────────
  await esbuild.build({
    entryPoints: [ENGINE_ENTRY],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(ENGINE_OUT_DIR, "index.cjs"),
    // Mark vscode as external — it's provided by the extension host at runtime
    external: ["vscode"],
    // The WCAG JSON is loaded via fs.readFile at runtime (not import/require),
    // so it must NOT be inlined — it's copied separately below.
    loader: { ".json": "copy" },
    // Suppress the shebang — the extension spawns node explicitly
    banner: {
      js: "// A11y Simulator — bundled engine (auto-generated, do not edit)\n",
    },
    logLevel: "warning",
    metafile: false,
    // Minify identifiers only for a readable bundle; keep whitespace for debuggability
    minifyIdentifiers: false,
    minifyWhitespace: false,
    minifySyntax: true,
    define: {
      // In the CJS bundle, __dirname is always defined, so the import.meta.url
      // branch in rule-engine.ts is dead code. Replacing import.meta with an
      // empty object silences the esbuild "empty-import-meta" warning for that
      // unreachable branch.
      "import.meta": "{}",
      "process.env.BUNDLE_MODE": JSON.stringify("extension"),
    },
  });

  // ── Copy WCAG data file ────────────────────────────────────────────────────
  // The rule-engine resolves this file with:
  //   const require = createRequire(import.meta.url);
  //   const indexPath = require.resolve("../data/wcag-2.2-index.json");
  // In the bundled CJS context this becomes:
  //   require.resolve from engine/index.cjs → engine/data/wcag-2.2-index.json
  console.log("[bundle-engine] Copying WCAG 2.2 index data…");
  fs.copyFileSync(WCAG_DATA_SRC, WCAG_DATA_DEST);

  // ── Verify outputs ────────────────────────────────────────────────────────
  const bundlePath = path.join(ENGINE_OUT_DIR, "index.cjs");
  const bundleSize = fs.statSync(bundlePath).size;
  const dataSize = fs.statSync(WCAG_DATA_DEST).size;

  console.log(`[bundle-engine] ✅ engine/index.cjs      — ${(bundleSize / 1024).toFixed(1)} KB`);
  console.log(`[bundle-engine] ✅ engine/data/wcag-2.2-index.json — ${(dataSize / 1024).toFixed(1)} KB`);
  console.log("[bundle-engine] Done.");
}

main().catch((err) => {
  console.error("[bundle-engine] FATAL:", err);
  process.exit(1);
});
