# =============================================================================
# A11y-Agent — one-shot setup & run script (Windows PowerShell)
#
# Usage:
#   .\setup.ps1                         # install deps + build engine
#   .\setup.ps1 local <file>            # scan a local file
#   .\setup.ps1 local <file> -Jira <md> # scan with Jira spec
#   .\setup.ps1 scan <PR#> <owner/repo> # scan a GitHub PR
#   .\setup.ps1 ext                     # build the VS Code extension
#   .\setup.ps1 clean                   # remove all build artifacts
# =============================================================================

param(
    [string]$Command  = "install",
    [string]$Arg1     = "",
    [string]$Arg2     = "",
    [string]$Jira     = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root      = $PSScriptRoot
$AgentDir  = Join-Path $Root "a11y-agent"
$ExtDir    = Join-Path $AgentDir "vscode-extension"
$Engine    = Join-Path $AgentDir "dist\index.js"
$Npm       = (Get-Command npm -ErrorAction SilentlyContinue)?.Source
if (-not $Npm) {
    # Common install locations
    foreach ($p in @("D:\Apps\NodeJS\npm.cmd","C:\Program Files\nodejs\npm.cmd")) {
        if (Test-Path $p) { $Npm = $p; break }
    }
}
if (-not $Npm) { Write-Error "npm not found. Install Node.js 20+ from https://nodejs.org"; exit 1 }

function Info($msg)  { Write-Host "[a11y] $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[a11y] $msg" -ForegroundColor Green }
function Err($msg)   { Write-Host "[a11y] ERROR: $msg" -ForegroundColor Red; exit 1 }

function Ensure-Built {
    if (-not (Test-Path $Engine)) {
        Info "Engine not built — running install first..."
        & $PSCommandPath install
    }
}

switch ($Command) {

    { $_ -in @("install", "") } {
        Info "Installing engine dependencies..."
        Push-Location $AgentDir
        & $Npm install --silent
        Info "Building a11y-agent engine..."
        & $Npm run build --silent
        Pop-Location
        Ok "Engine ready at $Engine"
        Ok ""
        Ok "Quick-start commands:"
        Ok "  .\setup.ps1 local a11y-agent\test-sample.html       # scan local file"
        Ok "  .\setup.ps1 ext                                      # build VS Code extension"
        Ok "  .\setup.ps1 scan 42 owner/repo                      # scan GitHub PR"
    }

    "local" {
        Ensure-Built
        if (-not $Arg1) { Err "Usage: .\setup.ps1 local <file> [-Jira <spec.md>]" }
        $extraArgs = @()
        if ($Jira) { $extraArgs += "--jira", $Jira }
        Info "Scanning $Arg1..."
        node $Engine local $Arg1 @extraArgs
    }

    "scan" {
        Ensure-Built
        if (-not $Arg1) { Err "Usage: .\setup.ps1 scan <PR-number> <owner/repo> [-DryRun]" }
        if (-not $Arg2) { Err "Usage: .\setup.ps1 scan <PR-number> <owner/repo> [-DryRun]" }
        if (-not $env:GITHUB_TOKEN) { Err "GITHUB_TOKEN is not set.`n  Set it via: `$env:GITHUB_TOKEN = 'ghp_...'" }
        $extraArgs = @()
        if ($DryRun) { $extraArgs += "--dry-run" }
        Info "Scanning PR #$Arg1 in $Arg2..."
        node $Engine scan $Arg1 --repo $Arg2 @extraArgs
    }

    "ext" {
        Info "Building VS Code extension..."
        $tsc = Join-Path $ExtDir "node_modules\typescript\bin\tsc"
        node $tsc -p (Join-Path $ExtDir "tsconfig-ext.json")
        Ok "Extension built at $ExtDir\out\extension.js"
        Ok "Open $ExtDir in VS Code and press F5 to launch."
    }

    "clean" {
        Info "Removing build artifacts..."
        Remove-Item -Recurse -Force (Join-Path $AgentDir "dist") -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force (Join-Path $ExtDir "out")    -ErrorAction SilentlyContinue
        Ok "Clean."
    }

    default {
        Write-Host "Usage: .\setup.ps1 [install|local <file>|scan <PR> <repo>|ext|clean]"
        exit 1
    }
}
