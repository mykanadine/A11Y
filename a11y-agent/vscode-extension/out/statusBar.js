"use strict";
/**
 * StatusBarManager
 *
 * Manages the accessibility badge in the VS Code status bar (bottom-right).
 *
 * States:
 *   • Idle / no issues: $(accessibility) A11y: ✓
 *   • Scanning:         $(sync~spin) A11y: Scanning…
 *   • Issues found:     $(error) A11y: 2 errors, 1 warning
 *   • All clear:        $(pass) A11y: All clear
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
class StatusBarManager {
    item;
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100 // priority — appears near the right end of the status bar
        );
        this.item.command = "a11y.scanFile";
        this.item.tooltip = "Click to run A11y scan on the current file";
        this.update(0, 0);
        this.item.show();
    }
    /** Show a spinning indicator while the scan is in progress. */
    setScanning() {
        this.item.text = "$(sync~spin) A11y: Scanning…";
        this.item.backgroundColor = undefined;
    }
    /**
     * Update the badge after a scan completes.
     * @param errors   Number of Error-severity (Level A) issues.
     * @param warnings Number of Warning-severity (Level AA) issues.
     */
    update(errors, warnings) {
        const total = errors + warnings;
        if (total === 0) {
            this.item.text = "$(pass) A11y: ✓";
            this.item.backgroundColor = undefined;
        }
        else if (errors > 0) {
            this.item.text = `$(error) A11y: ${errors} error${errors !== 1 ? "s" : ""}${warnings > 0 ? `, ${warnings} warning${warnings !== 1 ? "s" : ""}` : ""}`;
            this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        }
        else {
            this.item.text = `$(warning) A11y: ${warnings} warning${warnings !== 1 ? "s" : ""}`;
            this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        }
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBar.js.map