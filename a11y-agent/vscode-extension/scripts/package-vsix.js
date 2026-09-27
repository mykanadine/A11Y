const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const extensionRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(extensionRoot, "package.json");

const pkg = JSON.parse(
  fs.readFileSync(packageJsonPath, "utf8")
);

const releasesDir = path.join(extensionRoot, "releases");
const vsixName = `${pkg.name}-${pkg.version}.vsix`;
const vsixPath = path.join(releasesDir, vsixName);

if (fs.existsSync(releasesDir) && !fs.statSync(releasesDir).isDirectory()) {
  fs.rmSync(releasesDir);
}

fs.mkdirSync(releasesDir, { recursive: true });

if (fs.existsSync(vsixPath)) {
  fs.rmSync(vsixPath);
}

console.log(`[package-vsix] Packaging ${pkg.name} v${pkg.version}…`);
console.log(`[package-vsix] Output: ${vsixPath}`);

execSync(
  `npx vsce package --out "${vsixPath}"`,
  {
    cwd: extensionRoot,
    stdio: "inherit"
  }
);

if (!fs.existsSync(vsixPath)) {
  throw new Error(`VSIX was not created: ${vsixPath}`);
}

console.log(`[package-vsix] ✅ Created ${vsixName}`);