# ShiftAble

ShiftAble is a local-first accessibility testing extension for Visual Studio Code.

It helps developers detect and fix WCAG 2.2 accessibility issues earlier in the development process, before they reach QA or production.

## Features

ShiftAble provides accessibility checks through three specialized testing personas:

### Motor Accessibility

- Keyboard accessibility
- Focus behavior
- Semantic interactive elements
- Tab order and `tabindex` issues

### Visual Accessibility

- Color contrast
- Color-only state differences
- Non-text content checks
- Visual accessibility issues

### Vestibular / Cognitive Accessibility

- Autoplaying media
- Aggressive animations
- Carousels without pause controls
- Reduced-motion support

## Commands

Open the VS Code Command Palette:

`Ctrl + Shift + P`

Then use:

- `A11y: Scan Current File`
- `A11y: Scan with Jira Spec…`
- `A11y: Clear Diagnostics`

## Supported Files

ShiftAble supports accessibility scanning for:

- HTML
- JavaScript
- JSX
- TypeScript
- TSX
- CSS
- SCSS
- SVG

## How It Works

ShiftAble runs a bundled accessibility engine locally inside the extension.

The accessibility analysis follows this flow:

**Source Code**  
→ **Rule Engine**  
→ **Motor Persona**  
→ **Visual Persona**  
→ **Vestibular / Cognitive Persona**  
→ **Accessibility Findings**  
→ **Suggested Fixes**

The three accessibility personas evaluate different categories of accessibility issues and report findings based on WCAG 2.2 requirements.

## Results

Accessibility findings are integrated directly into Visual Studio Code through:

- Problems panel
- Editor diagnostics
- WCAG issue information
- Hover information
- A11Y Simulator sidebar
- Status bar
- Quick Fix actions
- Suggested code changes

This allows accessibility issues to be identified while the developer is still working on the affected code.

## Scan a File

Open a supported UI source file.

Then open the Command Palette:

`Ctrl + Shift + P`

Run:

`A11y: Scan Current File`

ShiftAble will analyze the current file and display detected accessibility issues inside VS Code.

## Scan with Jira Spec

ShiftAble can optionally scan a UI source file alongside a Jira-style Markdown specification.

Run:

`A11y: Scan with Jira Spec…`

Then select the relevant specification file.

This allows ShiftAble to evaluate the component using both accessibility requirements and project-specific acceptance criteria.

## Local-First

Standard ShiftAble scans run locally on the developer's machine.

You do not need:

- A GitHub token
- The A11y-Agent repository cloned
- A separately installed accessibility engine
- A custom engine path
- A remote accessibility scanning service

The accessibility engine is bundled directly inside the extension.

## Shift-Left Accessibility

Accessibility testing often occurs after development has already moved into QA or staging.

ShiftAble moves accessibility feedback earlier in the development workflow:

**Traditional workflow**

Code  
→ Pull Request  
→ QA  
→ Accessibility Testing  
→ Accessibility Failure  
→ Developer Rework

**With ShiftAble**

Code  
→ ShiftAble Scan  
→ Fix Accessibility Issue  
→ Pull Request  
→ QA

This helps reduce accessibility rework and gives developers immediate feedback while the code is still fresh.

## Development

Clone the repository and navigate to the main A11y-Agent package:

```bash
cd a11y-agent
```

Install the required dependencies:

```bash
npm install
```

### Build the Extension

```bash
npm run extension:build
```

### Run the Extension in Development

```bash
npm run extension:dev
```

The extension can also be launched using the VS Code Extension Development Host.

Open the `a11y-agent` folder in VS Code and press:

`F5`

### Package the Extension

```bash
npm run extension:package
```

This creates a versioned `.vsix` package under:

```text
vscode-extension/releases/
```

For example:

```text
a11y-simulator-0.1.0.vsix
```

### Install the Extension Locally

To build, package, and install ShiftAble automatically:

```bash
npm run extension:install-local
```

After installation, reload VS Code:

`Ctrl + Shift + P`

Then run:

`Developer: Reload Window`

ShiftAble can then be used from any supported project without keeping the A11y-Agent repository open.

## IBM Bob 2.0 Integration

ShiftAble is part of the broader A11y-Agent project, which also integrates with IBM Bob 2.0 through the Model Context Protocol (MCP).

IBM Bob can access the:

`a11y_scan`

MCP tool.

The Bob workflow can:

- Scan UI source files
- Run persona-based accessibility analysis
- Explain WCAG failures
- Generate suggested code patches
- Allow developers to negotiate alternative fixes
- Re-scan files after changes

The IBM Bob integration operates independently from the installed VS Code extension while using the same accessibility architecture.

## GitHub Pull Request Integration

A11y-Agent also supports accessibility scanning during the Pull Request workflow.

When configured through GitHub Actions, the system can:

- Detect changed UI files
- Run WCAG accessibility analysis
- Execute Motor, Visual, and Vestibular/Cognitive persona checks
- Generate suggested fixes
- Create patch information
- Post a consolidated accessibility report on the Pull Request

This creates another accessibility checkpoint before code is merged.

## Architecture

ShiftAble and A11y-Agent provide three entry points into the same accessibility workflow:

```text
                    A11y Core Engine
              WCAG + Personas + Debugger
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
      ShiftAble      IBM Bob 2.0     GitHub PR
   VS Code Extension     MCP           Action
```

### ShiftAble

Developer-time accessibility testing directly inside Visual Studio Code.

### IBM Bob 2.0

Conversational accessibility auditing and code-fix assistance through MCP.

### GitHub Pull Requests

Automated accessibility analysis during code review.

## Accessibility Personas

### Motor Persona

Focuses on interaction patterns that can create barriers for users with limited motor control.

Examples include:

- Elements that cannot be reached by keyboard
- Incorrect tab order
- Missing interactive semantics
- Improper `tabindex` usage

### Visual Persona

Focuses on issues affecting users with low vision or color-vision deficiencies.

Examples include:

- Insufficient color contrast
- Information communicated only through color
- Missing alternative text
- Visual-state accessibility problems

### Vestibular / Cognitive Persona

Focuses on motion and interaction patterns that may cause accessibility barriers.

Examples include:

- Autoplaying content
- Continuous animations
- Carousels without pause controls
- Missing reduced-motion handling

## Privacy and Security

Standard ShiftAble accessibility scans run locally.

ShiftAble does not require a GitHub token for local VS Code scanning.

Sensitive information such as:

- API keys
- Personal access tokens
- Credentials
- Passwords
- Environment secrets

should never be stored directly in source files or committed to the repository.

## Repository

Project repository:

https://github.com/mykanadine/A11Y

Issues and bug reports:

https://github.com/mykanadine/A11Y/issues

## License

MIT License