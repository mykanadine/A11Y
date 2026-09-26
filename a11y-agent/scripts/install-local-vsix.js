#!/usr/bin/env node
/**
 * install-local-vsix.js
 *
 * Finds the most recently generated .vsix in vscode-extension/releases/
 * and installs it using the `code` CLI.
 *
 * Run from: a11y-agent/
 *   node scripts/install-local-vsix.js
 *
 * Or via:   npm run extension:install-local
 */

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RELEASES_DIR = path.join(__dirname, "..", "vscode-extension", "releases");

// ── Find the most recently modified .vsix ─────────────────────────────────────
function findLatestVsix() {
  if (!fs.existsSync(RELEASES_DIR)) {
    console.error(`[install-local] No releases/ directory found at:\n  ${RELEASES_DIR}`);
    console.error("[install-local] Run: npm run extension:package");
    process.exit(1);
  }

  const vsixFiles = fs
    .readdirSync(RELEASES_DIR)
    .filter((f) => f.endsWith(".vsix"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(RELEASES_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (vsixFiles.length === 0) {
    console.error("[install-local] No .vsix files found in vscode-extension/releases/");
    console.error("[install-local] Run: npm run extension:package");
    process.exit(1);
  }

  return path.join(RELEASES_DIR, vsixFiles[0].name);
}

// ── Check if the `code` CLI is available ──────────────────────────────────────
function isCodeCliAvailable() {
  try {
    const result = spawnSync("code", ["--version"], { encoding: "utf8", timeout: 5000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const vsixPath = findLatestVsix();
console.log(`[install-local] Found VSIX: ${vsixPath}`);

if (!isCodeCliAvailable()) {
  console.log("\n[install-local] The 'code' CLI was not found in PATH.");
  console.log("Install the extension manually:");
  console.log("");
  console.log("  1. Open VS Code");
  console.log("  2. Open the Extensions panel (Ctrl+Shift+X / Cmd+Shift+X)");
  console.log("  3. Click the '...' menu (top-right of Extensions panel)");
  console.log("  4. Select 'Install from VSIX...'");
  console.log(`  5. Select: ${vsixPath}`);
  console.log("");
  process.exit(0);
}

console.log("[install-local] Installing extension via 'code' CLI…");
try {
  execSync(`code --install-extension "${vsixPath}" --force`, { stdio: "inherit" });
  console.log("[install-local] ✅ Extension installed successfully.");
  console.log("[install-local] Reload VS Code (Ctrl+Shift+P → Developer: Reload Window)");
  console.log("[install-local] Then open any HTML/JSX/TSX file and run: A11y: Scan Current File");
} catch (err) {
  console.error("[install-local] Installation failed:", err.message);
  console.log(`\nManual fallback: Extensions → ... → Install from VSIX → ${vsixPath}`);
  process.exit(1);
}
