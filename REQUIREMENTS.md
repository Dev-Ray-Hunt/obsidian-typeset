# Obsidian Typeset — Product Requirements Document
**Version:** 1.0
**Date:** 2026-03-24
**Status:** Active — Living Document
**Owner:** Brandon Hunt

> This document is the authoritative source of truth for the Obsidian Typeset plugin. Every Claude Code session should begin by reading this file. All implementation decisions must trace back to a requirement defined here.

---

## Table of Contents

1. [Project Vision](#1-project-vision)
2. [Claude Code Collaboration Protocol](#2-claude-code-collaboration-protocol)
3. [Technical Architecture](#3-technical-architecture)
   - 3.6 [Developer Experience & Fast Iteration Loop](#36-developer-experience--fast-iteration-loop)
4. [MVP Requirements](#4-mvp-requirements)
5. [Long-Term Feature Backlog](#5-long-term-feature-backlog)
6. [Development Roadmap](#6-development-roadmap)
7. [GitHub Project Structure](#7-github-project-structure)
8. [Definition of Done](#8-definition-of-done)
9. [Glossary](#9-glossary)

---

## 1. Project Vision

### 1.1 What Is Obsidian Typeset?

**Obsidian Typeset** is an Obsidian community plugin that transforms notes into beautifully formatted PDF documents using CSS-powered layout control. It solves Obsidian's notoriously poor print and export story by giving users full typographic and design control through CSS — the same language that powers the web.

### 1.2 One-Sentence Pitch

> *Obsidian Typeset turns your vault notes into polished, print-ready documents with the full power of CSS — no design software required.*

### 1.3 Target User

A knowledge worker, writer, game designer, or hobbyist who writes in Obsidian and needs to produce professional-looking documents — especially complex layouts like D&D sourcebooks, homebrew content, academic papers, or formal reports — without leaving their vault.

### 1.4 MVP Success Criterion

**The MVP is successful when:** A user can write a D&D document in Obsidian (with stat blocks, styled tables, multi-column layout, and decorative elements) and export it as a polished PDF they would be proud to share at the table.

### 1.5 Core Design Philosophy

- **CSS is the layout engine.** Every aspect of output formatting is controlled by CSS. The plugin is the rendering engine; the user is the designer.
- **No external dependencies.** The plugin works out-of-the-box with no tools to install (Obsidian's Electron/Chromium handles PDF rendering).
- **Progressive disclosure.** Sane defaults work immediately; power users can go deep with custom CSS.
- **Native feel.** Block class syntax, settings UX, and workflow integrate naturally with Obsidian conventions.

---

## 2. Claude Code Collaboration Protocol

### 2.1 Working Model

**Brandon's role:** Product owner, reviewer, approver. Describes desired features or bugs in plain English. Reviews code diffs, tests output in the vault, and gives go/no-go.

**Claude Code's role:** Sole code author. Writes all TypeScript, CSS, tests, and configuration. Commits work to Git. Proposes solutions and explains trade-offs when relevant.

### 2.2 Session Startup Checklist

Every Claude Code session **must** begin with the following steps, in order:

1. **Read this file** (`REQUIREMENTS.md`) in full.
2. **Read `CLAUDE.md`** in the repo root (if it exists — contains session-specific instructions and context).
3. **Run `git status`** to understand the current state of the repo.
4. **Identify the current active milestone** from the roadmap (Section 6).
5. **Ask Brandon which GitHub Issue to work on**, or pick the next open issue on the active milestone if none is specified.

### 2.3 Commit Convention

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): short description
fix(scope): short description
refactor(scope): short description
docs(scope): short description
chore(scope): short description
test(scope): short description
```

Example scopes: `pdf-engine`, `css-editor`, `parser`, `preview`, `settings`, `ui`, `scaffold`

### 2.4 Branch Strategy

- `main` — stable, always-working branch. Never commit broken code here.
- `dev` — active development branch. All work happens here.
- Feature branches named `feat/issue-<number>-<short-name>` (e.g., `feat/issue-12-css-editor`).
- Merge to `dev` via PR; merge `dev` to `main` at milestone completion.

### 2.5 Communication Rules

- Claude Code should **explain what it's about to do** before doing it on any task that touches more than one file.
- Claude Code should **flag uncertainty** rather than guess — if something is ambiguous, ask.
- Claude Code should **never delete existing functionality** without explicit approval.
- All new UI strings must be written in clear, friendly English. No jargon in user-facing text.

---

## 3. Technical Architecture

### 3.1 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript | Obsidian plugin standard |
| Plugin API | Obsidian Plugin API (latest) | Required for vault integration |
| PDF Engine | Electron `BrowserWindow` + `webContents.printToPDF` | Native to Obsidian's Electron shell — pixel-perfect CSS print rendering, `@page` support, no external dependencies |
| CSS Editor | CodeMirror 6 (via Obsidian's built-in instance) | Already bundled with Obsidian; CSS syntax highlighting, autocomplete |
| Preview | Obsidian `ItemView` (custom leaf/pane) | Native split-pane integration |
| Block Parser | Custom lightweight parser (regex + AST walk) | Parse `{.classname}` attributes from rendered markdown |
| Build Tool | esbuild (via official Obsidian plugin template) | Fast, standard for Obsidian plugins |
| Package Manager | npm | Standard |
| Testing | Manual test vault (`test-vault/`) in repo | MVP-phase testing strategy |
| Linting | ESLint + Prettier | Code quality |
| CI | GitHub Actions | Lint + build on every PR |

### 3.2 Rendering Pipeline (Shared)

Both the print preview and PDF export use a **shared document builder** (`src/document-builder.ts`) that produces a complete, self-contained HTML document string. Each consumer loads this HTML into its own isolated document context.

```
User triggers export or opens preview
        │
        ▼
[1] MarkdownRenderer
    Render note to HTML using
    Obsidian's built-in renderer
        │
        ▼
[2] Block Class Injector
    Walk rendered DOM, find {.classname}
    markers, apply CSS classes to elements
        │
        ▼
[3] Document Builder (shared)
    Assemble complete HTML document with
    CSS layers: @layer obsidian, theme, layout
    ├── Obsidian CSS (captured <style> elements)
    ├── Theme CSS (active theme + @page rules)
    └── Layout CSS (preview chrome or print rules)
        │
        ├──────────────────────┐
        ▼                      ▼
[4a] Preview                [4b] PDF Export
     Load HTML into              Load HTML into hidden
     iframe (srcdoc)             BrowserWindow
     JS pagination               │
     via smartBreak()             ▼
                             [5] Electron printToPDF
                                  Chromium print engine
                                  handles pagination
                                  │
                                  ▼
                             [6] File Output
                                  Save PDF to user-specified
                                  location (default: same
                                  folder as source note)
```

**Key architectural decisions:**
- Both pipelines own their own `<body>` element — no selector rewriting needed
- CSS cascade is controlled via `@layer` (Chromium 99+, Obsidian ships 114+) — eliminates `!important` warfare
- PDF export uses an isolated `BrowserWindow` — no mutation of Obsidian's live DOM
- Preview uses `smartBreak()` JS pagination as a visual approximation; PDF uses Chromium's native print engine for pixel-perfect output

### 3.3 Block Class Syntax Specification

#### For Callouts
Callout type maps directly to CSS class. No extra syntax needed.

```markdown
> [!stat-block]
> **Goblin**
> *Small humanoid*
```

This renders with class `callout-stat-block` in the output HTML, which the user styles via CSS.

#### For Tables, Images, Paragraphs, and Other Blocks
Use an **inline attribute tag** on the line immediately following the block:

```markdown
| STR | DEX | CON |
| --- | --- | --- |
| 8   | 14  | 10  |
{.stat-table}

![My Image](image.png)
{.full-width-image}

This is a paragraph of flavour text.
{.read-aloud}
```

**Parser rules:**
- The `{.classname}` token must appear on its own line, immediately after the block it modifies.
- Multiple classes are supported: `{.class-one .class-two}`.
- The token is stripped from the rendered output (invisible in final PDF).
- If a block has both a block ID and a class, both are supported: `{.classname}` and `^block-id` can coexist on the same trailing line.

### 3.4 CSS Architecture

**Theme storage:** User stylesheets live in `<plugin>/themes/` (i.e. `app.vault.configDir + "/plugins/obsidian-typeset/themes/"`). Built-in themes ship in the `built-in/` directory of the plugin source.

**CSS Cascade (via `@layer`):**

The document builder assembles CSS into three deterministic layers using CSS `@layer`. Rules in later-declared layers always override earlier layers regardless of specificity — no `!important` needed.

```css
@layer obsidian, theme, layout;

@layer obsidian {
  /* Captured from Obsidian's <style> elements at render time.
     Provides CSS custom properties, callout base styles,
     code highlighting token colors, etc. */
}

@layer theme {
  /* The active theme CSS (default.css, user theme, or per-note theme)
     + generated @page rules from plugin settings.
     Theme selectors use plain element/class selectors (body, p, h1, .callout, etc.) */
}

@layer layout {
  /* Preview: page chrome, overflow control, smartBreak() positioning
     PDF: @media print overrides, @page rules */
}
```

**CSS file features:**
- Full CSS support including `@page`, `@font-face`, `@media print`, CSS variables, and all modern CSS.
- `@page` rules control margins, page size, headers, and footers.
- CSS classes map directly to the `{.classname}` block syntax.
- Stylesheets are plain `.css` files — editable in the in-plugin CSS editor or any external editor.

**Example CSS for D&D layout:**

```css
@page {
  size: Letter;
  margin: 1in 0.75in;
}

@page :first {
  margin-top: 2in; /* Room for cover art */
}

.stat-block {
  background: #fdf1dc;
  border: 2px solid #9c2b1b;
  padding: 0.5em 1em;
  break-inside: avoid;
  font-family: 'Bookinsanity', serif;
}

.two-column {
  column-count: 2;
  column-gap: 1.5em;
}

.read-aloud {
  background: #e8e8e8;
  border-left: 4px solid #6b8cba;
  padding: 0.5em 1em;
  font-style: italic;
}
```

### 3.5 Plugin File Structure

```
obsidian-typeset/
├── src/
│   ├── main.ts                  ← Plugin entry point
│   ├── settings.ts              ← Plugin settings model + defaults
│   ├── settings-tab.ts          ← Settings UI (includes CSS editor)
│   ├── document-builder.ts      ← Shared document assembly (HTML + CSS layers)
│   ├── pdf-exporter.ts          ← PDF generation (BrowserWindow + printToPDF)
│   ├── preview-view.ts          ← Split-pane print preview (ItemView + iframe)
│   ├── block-class-parser.ts    ← {.classname} parser
│   ├── css-manager.ts           ← Read/write/list CSS files in vault
│   └── types.ts                 ← Shared TypeScript types
├── styles.css                   ← Plugin UI styles (not print styles)
├── themes/
│   ├── default.css
│   └── dnd-homebrew.css
├── test-vault/                  ← Manual test vault (Obsidian-openable)
│   ├── .obsidian/plugins/obsidian-typeset/ ← Symlinked build output
│   └── test-notes/
│       ├── simple-test.md
│       └── dnd-test.md
├── manifest.json
├── package.json
├── esbuild.config.mjs
├── tsconfig.json
├── .eslintrc
├── .prettierrc
├── .github/
│   └── workflows/
│       └── ci.yml
├── scripts/
│   ├── dev.mjs                  ← One-command dev startup (watch + open vault)
│   ├── release.mjs              ← Version bump + production build + git tag
│   └── check-vault.mjs          ← Verify test vault symlink is healthy
├── REQUIREMENTS.md              ← This file
├── CLAUDE.md                    ← Claude Code session notes
└── README.md
```

---

### 3.6 Developer Experience & Fast Iteration Loop

The single most important developer experience goal is **minimising the time between making a code change and seeing it live inside Obsidian.** The target for the full develop → build → deploy → test loop is **under 3 seconds** from file save to a reloaded plugin in the test vault.

Every session with Claude Code should result in a faster, more confident iteration loop — not just more features. If friction is discovered during development, fixing it takes priority.

---

#### 3.6.1 The Target Loop

```
Developer saves a .ts file
        │  < 1 second
        ▼
esbuild detects change, rebuilds main.js
        │  < 0.5 seconds (symlink — no copy needed)
        ▼
Built main.js lands in test-vault plugin folder
        │  < 1 second
        ▼
Obsidian Hot Reload detects main.js change,
reloads the plugin automatically
        │
        ▼
Developer sees the updated plugin live in Obsidian
```

**Total target: under 3 seconds, zero manual steps.**

---

#### 3.6.2 Core Components

**1. esbuild Watch Mode**
- `npm run dev` starts esbuild in `--watch` mode.
- Incremental rebuilds target < 500ms.
- Build output goes directly to `test-vault/.obsidian/plugins/obsidian-typeset/` via the symlink — no copy step needed.
- Each rebuild prints a clear timestamped line to the terminal: `[HH:MM:SS] Rebuilt in Xms ✓` or `[HH:MM:SS] Build failed — see error above ✗`.
- TypeScript type errors are reported but do **not** block the build in watch mode — fast feedback is more important than blocking on types. A separate `npm run typecheck` runs `tsc --noEmit` for clean type validation.

**2. Symlinked Build Output**
- `test-vault/.obsidian/plugins/obsidian-typeset/` is a symlink pointing to the repo's `dist/` folder.
- This means the built `main.js`, `manifest.json`, and `styles.css` are instantly available to Obsidian the moment esbuild writes them — no file copy, no deployment step.
- The `scripts/check-vault.mjs` script verifies the symlink is healthy and repairs it if needed. This runs automatically at the start of `npm run dev`.

**3. Obsidian Hot Reload**
- The test vault ships with the [Obsidian Hot Reload](https://github.com/pjeby/hot-reload) community plugin pre-configured.
- When `main.js` changes on disk, Hot Reload automatically reloads the plugin inside the running Obsidian instance — no manual "Reload Plugin" from settings, no Obsidian restart.
- A `.hotreload` file is committed to `test-vault/.obsidian/plugins/obsidian-typeset/` to register the plugin with Hot Reload.
- **The test vault is committed to the repo** (minus `.obsidian/workspace.json` which is gitignored) so any Claude Code session or contributor can open it immediately.

**4. Source Maps in Dev Builds**
- Dev builds (`npm run dev`) include inline source maps.
- This means stack traces and `console.log` output in Obsidian's DevTools point to the original TypeScript file and line number, not compiled JavaScript.
- Production builds (`npm run build`) strip source maps.

**5. Obsidian DevTools Access**
- Document clearly in `CLAUDE.md` and `README.md` how to open Obsidian's developer tools: `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac).
- `console.log`, `console.error`, and `console.warn` calls in plugin code are visible in the Console tab during development.
- All dev-only `console.log` calls must be wrapped with a `DEV` flag so they are stripped from production builds:
  ```typescript
  if (DEV) console.log('[Typeset]', message);
  ```
  `DEV` is a boolean constant injected by esbuild: `true` in watch mode, `false` in production builds.

---

#### 3.6.3 NPM Scripts Reference

All common tasks must be runnable with a single `npm run <command>`. No multi-step manual processes.

| Script | What it does |
|---|---|
| `npm run dev` | Runs `scripts/dev.mjs`: verifies symlink, starts esbuild watch, opens test vault in Obsidian |
| `npm run build` | Production build: minified, no source maps, type-checked |
| `npm run typecheck` | Run `tsc --noEmit` — type validation without emitting files |
| `npm run lint` | Run ESLint across `src/` |
| `npm run lint:fix` | Run ESLint with `--fix` to auto-correct fixable issues |
| `npm run format` | Run Prettier across `src/` |
| `npm run open-vault` | Open the test vault in Obsidian (cross-platform: `open` / `xdg-open` / `start`) |
| `npm run check-vault` | Run `scripts/check-vault.mjs` — verify/repair symlink, validate test vault structure |
| `npm run release` | Run `scripts/release.mjs` — bump version, build, tag, prep changelog (see below) |
| `npm run release:patch` | Release with patch version bump (0.1.0 → 0.1.1) |
| `npm run release:minor` | Release with minor version bump (0.1.0 → 0.2.0) |
| `npm run release:major` | Release with major version bump (0.1.0 → 1.0.0) |

---

#### 3.6.4 The `scripts/dev.mjs` Startup Script

`npm run dev` runs a custom Node.js script that orchestrates the full dev environment in one command:

```
1. Run scripts/check-vault.mjs
   → Verify test vault exists and symlink is healthy
   → If symlink is broken, recreate it automatically
   → Print ✓ or ✗ with clear fix instructions if unrecoverable

2. Start esbuild in watch mode
   → Inject DEV=true
   → Enable inline source maps
   → Output to dist/ (picked up by symlink)
   → Print timestamped rebuild notifications

3. Open test vault in Obsidian
   → Use OS-appropriate open command
   → Detect Obsidian install location (standard paths per OS)
   → If Obsidian is already open with this vault, skip (don't open a second window)

4. Print the dev loop summary to terminal:
   "Obsidian Typeset — Dev Mode
    Vault:   ./test-vault
    Output:  ./dist → (symlinked)
    Watching for changes...
    Press Ctrl+C to stop."
```

---

#### 3.6.5 The `scripts/release.mjs` Release Script

Releasing a new version should be a single command with no manual steps.

```
1. Confirm version bump type (patch / minor / major) from CLI arg or prompt
2. Run npm run typecheck — abort if type errors
3. Run npm run lint — abort if lint errors
4. Run npm run build — abort if build fails
5. Bump version in: manifest.json, package.json, versions.json (Obsidian convention)
6. Update CHANGELOG.md with auto-generated entry (date + git log since last tag)
7. Commit: "chore(release): v0.x.x"
8. Create git tag: v0.x.x
9. Print next steps:
   "Release v0.x.x ready.
    Run: git push && git push --tags
    Then: create GitHub Release from tag v0.x.x"
```

The script deliberately stops before pushing — Brandon reviews and pushes manually.

---

#### 3.6.6 CLAUDE.md — Session Continuity File

`CLAUDE.md` in the repo root is a living file that Claude Code maintains across sessions to preserve context between conversations.

**Claude Code must update `CLAUDE.md` at the end of every session** with:
- What was completed this session (issues closed, PRs merged)
- What is currently in progress (current branch, open PR)
- Any blockers or decisions that were deferred
- Any quirks, gotchas, or lessons learned about the codebase

**Format:**
```markdown
# CLAUDE.md — Obsidian Typeset Session Log

## Current State (updated: YYYY-MM-DD)
- Active milestone: M1 — Core PDF Export
- Current branch: feat/issue-11-pdf-exporter
- Last completed issue: #10 — Settings model implemented

## Open Decisions
- [ ] Decide on exact @page injection order when user CSS conflicts with settings panel

## Gotchas
- Obsidian's MarkdownRenderer is async — always await it before passing HTML to the pipeline
- The test vault symlink breaks on Windows if created with `ln -s`; use `scripts/check-vault.mjs` instead

## Session History
### 2026-03-24
- Completed M0 (issues #1–#8)
- Scaffold, test vault, CI all working
- npm run dev opens Obsidian and watch mode starts cleanly
```

---

#### 3.6.7 Iteration Quality Rules

These rules exist to protect the speed and quality of the iteration loop. Claude Code must follow them:

- **Never leave the build broken.** If a session ends with a failing build, the last commit must be reverted or the build fixed before stopping.
- **Never commit to `main` with TypeScript errors.** The CI workflow blocks this, but Claude Code should not try to bypass it.
- **Dev tools are first-class code.** The `scripts/` directory is maintained with the same care as `src/`. Dev tooling that is flaky, slow, or confusing gets fixed, not worked around.
- **Document every non-obvious dev step.** If setting something up required more than one command or a non-obvious decision, it goes in `CLAUDE.md` or `README.md` so it's never figured out twice.
- **Prefer automation over documentation.** If a task is done more than once manually, it becomes an npm script.

---

## 4. MVP Requirements

The MVP is a single, focused release that proves the core value proposition: **beautiful, CSS-controlled PDF export from a single Obsidian note.**

### 4.1 Feature: Export Current Note to PDF

**ID:** MVP-01
**Priority:** P0 (must-have)

**User Story:** As a user, I can trigger a PDF export of the currently open note, and a PDF file is saved to my vault.

**Acceptance Criteria:**
- A "Export to PDF" command appears in Obsidian's command palette.
- A "Export to PDF" button appears in the ribbon (left sidebar icon).
- Triggering either export option generates a `.pdf` file.
- The PDF is saved to the same folder as the source note by default.
- The user is shown a success notification with the output file path.
- Export errors are shown as a user-friendly notification (not a silent failure).

**Technical Notes:**
- Use `app.workspace.getActiveFile()` to get the current note.
- Use Obsidian's `MarkdownRenderer.renderMarkdown()` to render to HTML.
- Use `webContents.printToPDF()` with user's page settings.

---

### 4.2 Feature: CSS Theme Manager

**ID:** MVP-02
**Priority:** P0 (must-have)

**User Story:** As a user, I can select which CSS stylesheet is applied when I export, choosing from built-in themes or my own custom stylesheets.

**Acceptance Criteria:**
- Plugin ships with two built-in themes: `Default` and `D&D Homebrew`.
- User can select the active theme from the plugin settings panel.
- Built-in themes are read-only (cannot be edited, but can be duplicated).
- Custom stylesheets stored in `<vault>/.typeset/user/` are automatically discovered and appear in the theme selector.
- Active theme name is persisted in plugin settings across restarts.

---

### 4.3 Feature: In-Plugin CSS Editor

**ID:** MVP-03
**Priority:** P0 (must-have)

**User Story:** As a user, I can open a CSS editor inside Obsidian to create and edit my custom stylesheets, with syntax highlighting.

**Acceptance Criteria:**
- A "Open CSS Editor" command opens the editor as an Obsidian `ItemView` pane.
- The editor uses CodeMirror 6 with CSS syntax highlighting.
- **Note-aware opening:** When opened while a note is active, the editor loads that note's per-note theme (from `typeset-theme` frontmatter). Falls back to the global active theme if none is set.
- A dropdown in the editor header lists all available themes (built-ins first, then user stylesheets). Switching the dropdown loads that stylesheet into the editor and updates the active theme.
- A "New Stylesheet" command creates a new `.css` file in `<plugin>/themes/`.
- Changes are saved automatically (debounced, 500ms after last keystroke).
- Attempting to edit a built-in theme shows a read-only notice.
- **Storage:** User stylesheets live in `<plugin>/themes/` (NOT `<vault>/.typeset/`). See Architecture Decisions in CLAUDE.md.

#### 4.3a Feature: CSS Editor Search & Highlighting

**User Story:** As a user, I can type into a search bar in the CSS editor to instantly find and highlight matching selectors and properties across the stylesheet.

**Query Syntax:**
- Terms are matched against both selector text and property names — no explicit selector/property split required.
- **AND:** `+`, `&`, or `and` (all equivalent)
- **OR:** `|` or `or` (all equivalent)
- **Grouping:** `()` for precedence
- Search is case-insensitive.

**Examples:**
```
h1                       → highlight all h1 selector lines
h1 and font-size         → h1 selector lines + font-size property lines inside h1 blocks
(h1 | h2) and color      → h1/h2 selector lines + color property lines in those blocks
(h1 & h2) or font        → blocks containing both h1 AND h2, OR any block with font
```

**Display Behaviour:**
- **Selector matches** → entire selector line(s) highlighted in Colour A.
- **Property matches** → matching property line(s) highlighted in Colour B.
- Non-matching lines remain visible (no hiding).
- Clearing the search removes all highlights.

**Architecture (four clean layers — each independently testable):**
1. **Query Parser** (`css-search-query.ts`) — parses raw string into a typed boolean expression AST.
2. **CSS Block Extractor** — walks the Lezer syntax tree (already built by `lang-css`) to produce `CssBlock[]`: `{ selectorText, selectorLines, declarations: { property, lineRange }[] }`.
3. **Match Evaluator** — evaluates the boolean AST against each `CssBlock`, returns `{ selectorRanges, propRanges }` per match.
4. **CM6 Decoration Layer** — a `StateField<DecorationSet>` that reacts to document changes and query changes, applying `Decoration.mark()` with two CSS classes: `.typeset-search-selector` (Colour A) and `.typeset-search-property` (Colour B).

---

### 4.4 Feature: Block CSS Class Syntax

**ID:** MVP-04
**Priority:** P0 (must-have)

**User Story:** As a user, I can annotate any block in my note with `{.classname}` and that CSS class will be applied to the corresponding element in the PDF output.

**Acceptance Criteria:**
- Parser correctly identifies `{.classname}` tokens on a standalone line following a block.
- Parser supports multiple classes: `{.class-one .class-two}`.
- The token is removed from the rendered output (does not appear in preview or PDF).
- Works for: paragraphs, tables, images, blockquotes, ordered lists, unordered lists, code blocks, horizontal rules.
- Callout type is automatically mapped to class `callout-<type>` (e.g., `[!stat-block]` → `.callout-stat-block`).
- Does not interfere with Obsidian's native `^block-id` syntax.

---

### 4.5 Feature: Split-Pane Print Preview

**ID:** MVP-05
**Priority:** P0 (must-have)

**User Story:** As a user, I can open a live print preview pane that shows me exactly how my note will look when exported to PDF.

**Acceptance Criteria:**
- A "Toggle Print Preview" command opens a new leaf/pane in Obsidian.
- The preview renders the current note with the active CSS theme applied.
- The preview updates automatically when the note is edited (debounced, 800ms).
- The preview uses the same shared document builder as PDF export (`document-builder.ts`), ensuring the HTML and CSS layers are identical. The only difference is pagination: the preview uses `smartBreak()` JS approximation while the PDF uses Chromium's native print engine.
- The preview includes a visual representation of page boundaries (dashed border or shadow showing page edges).
- A "Export PDF" button is visible in the preview pane header for quick access.
- The preview pane can be closed/toggled without affecting the note.
- **Note-aware:** The preview always shows the theme for the currently active note (per-note `typeset-theme` frontmatter, falling back to the global active theme).

---

### 4.6 Feature: Page Layout Settings

**ID:** MVP-06
**Priority:** P0 (must-have)

**User Story:** As a user, I can configure global page layout settings that are applied to all exports when no CSS overrides them.

**Acceptance Criteria:**
- Settings available in the plugin settings panel:
  - Page size: A4, Letter, Legal, A3 (dropdown)
  - Page orientation: Portrait, Landscape (toggle)
  - Margins: Top, Bottom, Left, Right (number fields, unit selector: in/mm/cm)
- Settings are reflected in a generated `@page` rule that is injected alongside the user's CSS.
- User's CSS `@page` rules always take precedence over settings-panel values.
- Settings persist across Obsidian restarts.

---

### 4.7 Feature: Built-In D&D Homebrew Theme

**ID:** MVP-07
**Priority:** P1 (high-value for MVP success criterion)

**User Story:** As a D&D user, I can select the built-in D&D Homebrew theme and immediately get Homebrewery-inspired formatting for my D&D notes.

**Acceptance Criteria:**
- The `dnd-homebrew.css` theme ships with the plugin and is available in the theme selector.
- Theme includes styles for the following CSS classes (usable with `{.classname}` syntax):
  - `.stat-block` — Monster stat block styling (bordered box, parchment background)
  - `.two-column` — Two-column layout section
  - `.read-aloud` — Boxed read-aloud text (italic, shaded)
  - `.spell-block` — Spell description block
  - `.note-box` — Designer note callout
  - `.chapter-header` — Decorative chapter/section heading
  - `.full-width` — Force element to span full page width (break out of columns)
  - `.img-half-right` — Image floats right, occupying ~half the page width; text wraps around left side
  - `.img-half-left` — Image floats left, occupying ~half the page width; text wraps around right side
  - `.img-full-width` — Image spans the full content width, text does not wrap
- `callout-stat-block`, `callout-read-aloud`, etc. receive the same styles as their class equivalents.
- The theme defines `@page` rules appropriate for D&D documents (Letter size, 0.75in margins).

---

### 4.8 Feature: Automatic Page Flow

**ID:** MVP-08
**Priority:** P0 (must-have)

**User Story:** As a user, content in both the print preview and the exported PDF automatically flows correctly across pages — text reflows naturally, blocks are not awkwardly split, and the layout looks intentional rather than accidental.

**Description:** Automatic page flow means the rendering engine handles multi-page documents gracefully without manual intervention. Text fills one page and continues seamlessly onto the next. Block-level elements respect page boundaries intelligently. This works in both the live preview pane (visual page simulation) and the final PDF output.

**Acceptance Criteria:**

*Text Flow:*
- Body text, headings, and list items automatically reflow across pages with no manual line breaks required.
- Widows and orphans are suppressed: no single line of a paragraph is left alone at the top or bottom of a page. Minimum 2 lines together at page boundaries.

*Block-Level Page Break Handling:*
- Tables: rows do not split across pages. If a table does not fit on the remaining page, the whole table moves to the next page. For very long tables (more than ~15 rows), the table is allowed to split at a row boundary, never mid-row.
- Images: images are never cut by a page break. If an image does not fit in the remaining space on a page, it flows to the next page, and the space above is filled with the following text.
- Callouts and stat blocks: elements with `break-inside: avoid` applied (via CSS) are treated as atomic — they never split across pages.
- Code blocks: treated as `break-inside: avoid` by default in the built-in themes.
- Headings: headings are never orphaned at the bottom of a page (no heading as the last line before a page break). Headings always have at least 2 lines of following content on the same page.

*Multi-Column Flow:*
- Content in `.two-column` sections flows correctly column-to-column before flowing to the next page.
- Column balancing is applied at the end of a multi-column section.

*Preview Accuracy:*
- The split-pane print preview shows page breaks at the correct positions, matching where Chromium's print engine will break the PDF.
- Page boundary indicators in the preview (dashed borders) accurately reflect the real page flow — not an approximation.

*CSS Controllability:*
- All default page-flow behaviours are implemented via CSS properties (`break-before`, `break-after`, `break-inside`, `orphans`, `widows`, `page-break-*`).
- Users can override any default behaviour in their custom stylesheet — e.g., `break-inside: auto` on `.stat-block` to allow splitting if desired.
- The built-in `default.css` and `dnd-homebrew.css` themes include sensible page-flow defaults out of the box.

**Technical Notes:**
- Chromium's print engine (`printToPDF`) handles the actual pagination — the plugin's job is to supply correct CSS hints.
- The preview pane uses a fixed-width, fixed-height page simulation container with `overflow: hidden` per page, re-rendered in JavaScript to simulate where breaks occur.
- Page flow CSS defaults to include in all built-in themes:
  ```css
  p { orphans: 2; widows: 2; }
  h1, h2, h3, h4 { break-after: avoid; }
  table { break-inside: avoid; }
  img { break-inside: avoid; break-before: auto; }
  .stat-block, .read-aloud, .spell-block, .note-box { break-inside: avoid; }
  pre, code { break-inside: avoid; }
  ```

---

## 5. Long-Term Feature Backlog

These features are explicitly **out of scope for MVP** but are planned and should be considered in architectural decisions to avoid blocking future work.

### 5.1 Multi-Note / Book Export (v2)

Combine multiple notes into a single PDF document.

**Planned implementation:**
- A "Collection Note" approach: a master note that uses `![[embed]]` syntax to include other notes in order.
- An "Export Folder as Book" command: exports all notes in a selected folder in alphabetical order (with optional custom order via frontmatter `order:` key).
- Chapter breaks automatically inserted between notes.
- Table of contents auto-generated from H1/H2 headings across all included notes.

---

### 5.2 Word (.docx) Export (v2)

Export a note to a Microsoft Word document for handoff to collaborators.

**Planned implementation:**
- Use `docx` npm library (pure JavaScript, no external dependencies).
- CSS class mappings inform Word styles (e.g., `.read-aloud` → "Read Aloud" paragraph style).
- Images are embedded as base64.
- Tables are converted to native Word tables.

---

### 5.3 HTML Export (v2)

Export a note to a clean, standalone HTML file.

**Planned implementation:**
- Self-contained HTML: CSS inlined in `<style>` tags, images base64-encoded.
- Output is a single `.html` file — no external dependencies.
- Suitable for email, web publishing, or offline sharing.

---

### 5.3b Three-Pane Synchronization — Note + Preview + CSS Editor (v2)

**Vision:** The note editor, print preview, and CSS editor are all linked to the same document context. Changing any one of them updates the others automatically.

**Desired behaviour:**
- Opening the CSS editor while a note is active loads that note's theme (per-note `typeset-theme` frontmatter, or global active theme as fallback). *(Targeted in M3 Issue #36)*
- Switching the active note updates the preview pane to show the new note.
- Switching the active note also reloads the CSS editor to show that note's theme.
- Switching the theme in the CSS editor dropdown updates the preview immediately (no export required).
- Editing CSS in the editor triggers a debounced preview refresh so changes are visible live.

**Implementation notes:**
- Use Obsidian's `workspace.on('active-leaf-change')` and `metadataCache.on('changed')` events to detect note switches.
- The CSS editor should expose a `loadTheme(theme: ThemeInfo)` method that the workspace event handler calls.
- The preview should subscribe to a shared "active theme changed" event (or poll `settings.activeTheme`) to rerender.

---

### 5.4 GUI CSS Inspector — Bidirectional Element Editor (v3)

The **killer long-term differentiator** for Obsidian Typeset.

**Vision:** Click on any element in the print preview pane → the Markdown editor scrolls to and highlights the source block → the CSS editor highlights the CSS rule(s) responsible for that element's styling.

**Planned implementation phases:**
1. **Click-to-highlight in preview:** Click an element in the preview, source block is highlighted in the editor pane.
2. **CSS rule identification:** Identify which CSS class(es) are applied to the clicked element and which rules in the active stylesheet govern it.
3. **CSS editor focus:** Scroll the CSS editor to the first matching rule and highlight it.
4. **Inline CSS overrides:** Allow the user to tweak CSS values directly in a floating inspector panel (like browser DevTools), with changes written back to the active stylesheet.

---

### 5.5 Extended Obsidian Plugin Support (v3)

First-class support for popular Obsidian community plugins in PDF output.

**Priority targets:**
- **Fantasy Statblocks** (`obsidian-5e-statblocks`): Render stat block components correctly in PDF output. Currently the plugin renders custom HTML components that may not survive the print pipeline.
- **Dataview**: Ensure Dataview-generated tables and lists are rendered before PDF export is triggered.
- **Excalidraw**: Embed Excalidraw drawings as images in the PDF output.
- **Admonition** plugin callouts.

**Implementation approach:** A plugin compatibility layer that fires a `typeset:pre-render` event, giving other plugins a chance to finalize their rendered output before the PDF pipeline runs.

---

### 5.6 Theme Marketplace & Presets (v3)

**Vision:** A curated library of built-in CSS themes users can browse and apply, plus a mechanism to share/import themes as `.css` files.

**Planned themes:**
- D&D Homebrew (ships with MVP)
- Academic Paper (Chicago/MLA style)
- Clean Modern (minimal, sans-serif)
- Technical Specification
- Letter / Memo

**Import/Export:** Users can export their theme settings (CSS + plugin config) as a `.typeset-theme` bundle and share it with others.

---

### 5.7 Table of Contents Auto-Generation (v2)

Auto-generate a linked table of contents page inserted at the beginning of the exported document.

**Implementation:** Parse H1/H2/H3 headings from note(s), generate a styled ToC section. Depth configurable in settings.

---

### 5.8 Cover Page Support (v2)

A styled first page with title, author, date, and optional cover image.

**Implementation:**
- A special `[!cover]` callout block in the note defines cover page content.
- Or: a YAML frontmatter block with `typeset-cover: true` triggers cover page generation.
- Cover page layout is fully CSS-controlled via `@page :first` rules.

---

### 5.9 Image Handling Controls (v2)

Fine-grained control over image layout in PDFs, modelled after how images appear in professional D&D sourcebooks — where an illustration might dominate half the page while text flows naturally around it, or where a full-bleed artwork spans the entire width of a page.

**Reference:** The target aesthetic is how Wizards of the Coast lays out art in books like the *Player's Handbook* and *Dungeon Master's Guide* — images are compositional elements, not afterthoughts dropped between paragraphs.

**CSS Classes (all applied via `{.classname}` block syntax):**

| Class | Behaviour |
|---|---|
| `{.img-half-right}` | Image floats right, occupies approximately 45–50% of page width. Body text wraps around the left side. Image may span multiple paragraphs vertically. |
| `{.img-half-left}` | Mirror of above — image floats left, text wraps right. |
| `{.img-full-width}` | Image spans the full content width. Text does not wrap; content resumes below. Useful for chapter banners or wide landscape art. |
| `{.img-full-page}` | Image occupies an entire page. A page break is forced before and after the image. Useful for full-page splash artwork. |
| `{.img-quarter-right}` | Smaller float — approximately 25–30% width. Useful for portrait-style character art or small icons. |
| `{.img-no-break}` | Prevents an image from being cut by a page break. The image moves to the next page if it doesn't fit. Can be combined with other classes. |
| `{.img-caption}` | Applied to a paragraph immediately following an image; renders as a styled caption (smaller font, centred or italicised). |

**Behaviour Requirements:**
- Floating images (`img-half-right`, `img-half-left`, `img-quarter-right`) use CSS `float` with appropriate `shape-outside` support where Chromium allows, so text follows the natural rectangle of the image.
- Text that wraps around a floated image must clear the float before the next heading, stat block, or section separator — no text should overlap a new major section because of an uncleared float.
- Captions are auto-generated from image alt text when the `{.img-caption}` class is used on a following paragraph, or can be written manually.
- All image layout classes work within multi-column layouts (`.two-column`) as well as single-column body text.
- In the print preview, floating images render with the same wrap behaviour as the final PDF.

**Implementation notes:**
- All behaviour is CSS-driven — the plugin injects classes, Chromium handles rendering.
- The built-in `dnd-homebrew.css` theme ships with full definitions for all image classes listed above.
- Users can override or extend image class styles in their custom stylesheets.
- `{.img-full-page}` requires a CSS `page-break-before: always; page-break-after: always;` approach combined with `width: 100%; height: 100%; object-fit: contain` or `cover` (configurable).

---

### 5.10 Plugin Settings Sync (v3)

Export and import the complete plugin configuration (active theme, page settings, custom CSS files) as a single JSON bundle.

Use case: sync settings between multiple vaults, or share a "document style package" with a team.

---

### 5.11 Google Docs Export (v3)

Export a note directly to a Google Docs document, enabling real-time collaboration and editing in Google Workspace.

**Vision:** A user finishes drafting in Obsidian and publishes directly to Google Docs with a single command — no copy-paste, no formatting loss.

**Planned implementation:**
- Authenticate with Google via OAuth 2.0 (stored securely in Obsidian settings).
- Use the Google Docs REST API to create a new document or update an existing one.
- Markdown structure maps to native Google Docs elements: headings → Heading 1/2/3 styles, bold/italic → character styles, tables → native Docs tables, images → inline images.
- CSS class mappings inform named paragraph styles in Google Docs where possible (e.g., `.read-aloud` → "Read Aloud" custom style).
- A "Publish to Google Docs" command in the command palette opens a dialog to: create a new doc (with configurable title and destination folder), or update a previously linked doc (stored in note frontmatter as `typeset-gdoc-id`).
- Two-way consideration: the architecture should not preclude future import-from-Google-Docs, but that is not in scope for this feature.

**Constraints and considerations:**
- Requires internet access and a Google account — clearly documented as an optional cloud feature.
- OAuth token storage must follow Obsidian's secure storage patterns.
- Rate-limit and API error handling must be robust with clear user-facing messages.
- Complex CSS-driven layouts (multi-column, D&D parchment styling) cannot map to Google Docs — the export is semantic/structural only. Users should be informed of this limitation.

---

## 6. Development Roadmap

### Milestone 0: Project Scaffold (Week 1)

**Goal:** An empty-but-correct Obsidian plugin project exists on GitHub, with all tooling configured and the test vault ready.

> **This is the first milestone Claude Code should execute.** After reading this document, Claude Code's first job is to complete Milestone 0 entirely.

| Issue # | Title | Description |
|---|---|---|
| #1 | Initialize plugin from official Obsidian sample template | Clone `obsidian-sample-plugin`, rename, configure `manifest.json` with plugin ID `obsidian-typeset`, name, and description |
| #2 | Configure TypeScript, ESLint, and Prettier | Set up `tsconfig.json`, `.eslintrc`, `.prettierrc` with sensible defaults. Add `npm run typecheck`, `npm run lint`, `npm run lint:fix`, `npm run format` scripts |
| #3 | Configure esbuild for dev and production | `esbuild.config.mjs`: dev mode injects `DEV=true`, enables inline source maps, watches for changes, prints timestamped rebuild notifications. Prod mode minifies, strips source maps, runs typecheck first |
| #4 | Create test vault and symlink | Create `test-vault/` directory with sample notes. Create `dist/` and symlink `test-vault/.obsidian/plugins/obsidian-typeset` → `dist/`. Commit a `.hotreload` file inside the plugin folder |
| #5 | Pre-install Obsidian Hot Reload in test vault | Add Hot Reload plugin files to `test-vault/.obsidian/plugins/hot-reload/`. This enables automatic plugin reload on `main.js` changes with zero manual steps |
| #6 | Write `scripts/check-vault.mjs` | Node.js script that verifies the symlink is healthy, recreates it if broken, and validates test vault structure. Cross-platform (Windows/Mac/Linux) |
| #7 | Write `scripts/dev.mjs` — one-command dev startup | Runs check-vault, starts esbuild watch, opens test vault in Obsidian using OS-appropriate command. Prints clear dev mode summary to terminal |
| #8 | Write `scripts/release.mjs` — one-command release | Runs typecheck + lint + build, bumps version in `manifest.json` / `package.json` / `versions.json`, updates `CHANGELOG.md`, commits, creates git tag. Stops before push for manual review |
| #9 | Wire all npm scripts in `package.json` | `dev`, `build`, `typecheck`, `lint`, `lint:fix`, `format`, `open-vault`, `check-vault`, `release`, `release:patch`, `release:minor`, `release:major` — all documented |
| #10 | Create GitHub Actions CI workflow | On every PR to `main` or `dev`: run `npm run typecheck`, `npm run lint`, `npm run build`. Fail PR if any step fails. Report build size |
| #11 | Create CLAUDE.md with initial session log | Stub with current state, dev loop instructions (how to start, how Hot Reload works, how to open DevTools), and Obsidian API gotchas |
| #12 | Create GitHub Projects board | Set up board with milestone columns. Create all issues #1–#52 as GitHub Issues, assigned to correct milestone |
| #13 | Write README with dev setup guide | Plugin name, pitch, install for users, and dev setup section: `git clone → npm install → npm run dev` = running in 3 commands |
| #14 | End-to-end dev loop smoke test | Verify the full loop: edit a `.ts` file → save → see rebuild in terminal in < 1s → see plugin reload in Obsidian automatically via Hot Reload → no manual steps required |

**Milestone 0 complete when:** `npm run dev` starts the full loop in one command, a TypeScript edit reloads the plugin in Obsidian in under 3 seconds with zero manual steps, and all issues are on the GitHub Projects board.

---

### Milestone 1: Core PDF Export (Weeks 2–3)

**Goal:** The plugin can export a basic Obsidian note to a PDF file using the Electron print engine with default settings.

| Issue # | Title | Description |
|---|---|---|
| #15 | Add `main.ts` plugin skeleton | `Plugin` class with `onload`/`onunload`, register ribbon icon, register command palette command |
| #16 | Implement settings model | `TypesetSettings` interface, default values, `loadSettings`/`saveSettings` methods |
| #17 | Implement basic PDF exporter | `pdf-exporter.ts`: get active note → render to HTML → call `printToPDF` → save file |
| #18 | Wire export command to exporter | Connect "Export to PDF" command and ribbon button to `pdf-exporter` |
| #19 | Implement page settings injection | Generate `@page { size: ...; margin: ...; }` CSS from settings and inject into export HTML |
| #20 | Add settings tab with page layout controls | Settings pane: page size, orientation, margin fields. Wire to `TypesetSettings` |
| #21 | Add success/error notifications | User-friendly toast notifications for export success (with file path) and errors |
| #22 | Implement default page-flow CSS baseline | Add `orphans`, `widows`, heading `break-after: avoid`, table/image `break-inside: avoid` rules to the default CSS injected into every export. This ensures basic page flow is correct from the first export |
| #23 | Manual test: export simple note | Test using `test-vault/test-notes/simple-test.md`. Verify PDF is created, headings/paragraphs/tables render correctly, and no blocks are awkwardly split across pages |

---

### Milestone 2: Block Class Parser & CSS Injection (Weeks 3–4)

**Goal:** `{.classname}` syntax works end-to-end: parsed from note, class applied to DOM element, user CSS is injected, classes take effect in PDF output.

| Issue # | Title | Description |
|---|---|---|
| #24 | Implement `block-class-parser.ts` | Parse `{.classname}` tokens from rendered HTML. Strip token from output. Apply classes to preceding DOM element |
| #25 | Support multiple classes in one token | e.g., `{.class-one .class-two}` — both classes applied |
| #26 | Callout type to CSS class mapping | Ensure `[!stat-block]` callouts get class `callout-stat-block` in rendered output |
| #27 | Implement `css-manager.ts` | Discover CSS files in `<vault>/.typeset/`. Read/write stylesheet content. Create `.typeset/` folder structure on first run |
| #28 | Ship `default.css` built-in theme | Basic print-friendly CSS: sensible font, line-height, heading sizes, table borders, page-flow defaults |
| #29 | CSS injection into export pipeline | Inject selected stylesheet (+ generated `@page` rules) into HTML before `printToPDF` call |
| #30 | Settings: active theme selector | Dropdown in settings showing available themes. Persisted in settings |
| #31 | Manual test: block classes + CSS | Test `{.my-class}` in `dnd-test.md`, verify class appears on element in PDF |

---

### Milestone 3: In-Plugin CSS Editor (Weeks 4–5)

**Goal:** User can create, select, and edit CSS stylesheets from inside Obsidian with syntax highlighting.

| Issue # | Title | Description |
|---|---|---|
| #32 | Add CSS Editor section to settings tab | Tab or section in the settings pane dedicated to CSS editing |
| #33 | Integrate CodeMirror 6 CSS editor | Embed CodeMirror editor with CSS language support (using Obsidian's bundled CM6 instance) |
| #34 | Load active stylesheet into editor | Editor displays the currently selected stylesheet content on open |
| #35 | Auto-save on edit (debounced 500ms) | Changes to the editor are written to the `.css` file automatically |
| #36 | "New Stylesheet" button | Creates a new `.css` file in `<vault>/.typeset/user/`, adds it to the theme selector, and opens it in the editor |
| #37 | "Duplicate Theme" for built-in themes | Clicking edit on a built-in theme shows a "Duplicate to edit" prompt. Creates a copy in `user/` |
| #38 | Manual test: CSS editor round-trip | Create stylesheet, write CSS, switch active theme, export PDF — verify custom CSS applied |

---

### Milestone 4: Split-Pane Print Preview (Weeks 5–6)

**Goal:** A live print preview pane shows a real-time WYSIWYG preview of the PDF output.

| Issue # | Title | Description |
|---|---|---|
| #39 | Implement `preview-view.ts` as Obsidian `ItemView` | Register a new view type `typeset-preview`, openable as a leaf in any pane position |
| #40 | "Toggle Print Preview" command | Opens preview pane if closed, closes if open |
| #41 | Render note to HTML in preview | Same pipeline as export: `MarkdownRenderer` → block class parser → CSS injection |
| #42 | Live update on note edit | Subscribe to `editor-change` event, debounce 800ms, re-render preview |
| #43 | Page boundary visualization with accurate flow | Add CSS to preview showing page break positions. Preview must simulate correct page flow: images, tables, and `break-inside: avoid` blocks position identically to the final PDF |
| #44 | "Export PDF" button in preview header | Quick-access export button visible in the preview pane's action bar |
| #45 | Manual test: preview accuracy | Verify preview matches actual PDF output for `dnd-test.md`, including image wrapping and page-break positions |
| #68 | Theme picker in preview + CSS editor UI overhaul | Theme name chip in preview header opens picker; palette icon opens CSS editor; CSS editor file picker only changes editing target |
| #74 | Phase A: Extract shared document builder | Create `document-builder.ts` with shared rendering logic; refactor preview and PDF to use it |
| #75 | Phase B: Isolated PDF rendering in BrowserWindow | Move PDF export to hidden BrowserWindow; build bare pipeline first (no themes), validate parity, then add themes |
| #76 | Phase C: CSS @layer for cascade control | Wrap CSS output in `@layer obsidian, theme, layout` blocks; eliminate `!important` declarations |
| #77 | Polish: Preview/PDF visual fine-tuning | Address remaining minor visual differences after unified pipeline is in place |

---

### Milestone 5: D&D Homebrew Theme & MVP Polish (Weeks 6–7)

**Goal:** The MVP success criterion is achieved. A D&D document can be authored in Obsidian and exported as a beautiful PDF.

| Issue # | Title | Description |
|---|---|---|
| #46 | Author `dnd-homebrew.css` built-in theme | Full D&D theme CSS: `.stat-block`, `.two-column`, `.read-aloud`, `.spell-block`, `.note-box`, `.chapter-header`, `.full-width`, all `.img-*` image layout classes, `@page` rules, page-flow defaults (`orphans`, `widows`, `break-inside` rules), custom font references |
| #47 | Create `dnd-test.md` comprehensive test note | A realistic D&D encounter document in `test-vault/` using all D&D CSS classes, callout types, and image layout classes (half-right art, full-width banner, stat block, read-aloud, two-column body text) |
| #48 | Manual test: full D&D export + page flow | Export `dnd-test.md` with the D&D theme. Verify: visual quality, correct image wrapping, no split stat blocks, correct text flow across multiple pages, preview matches PDF. File issues for any problems |
| #49 | Plugin settings polish | Review all settings UI for clarity, labelling, and usability |
| #50 | Error handling hardening | Audit all export and parser code paths for unhandled errors. Add graceful fallbacks |
| #51 | Write `README.md` with full usage guide | Installation, first export walkthrough, block class syntax reference, CSS editor guide, image layout class reference |
| #52 | Tag `v0.1.0` release | Run `npm run release:minor`, push tags, create GitHub Release with changelog |

---

### Milestone 6: v0.2 — Book Export & Cover Pages (Future)

Multi-note export, ToC generation, cover page support. (Detailed issues to be created when Milestone 5 is complete.)

### Milestone 7: v0.3 — Additional Export Formats (Future)

Word (.docx), HTML, and Google Docs export. (Detailed issues to be created when Milestone 6 is complete.)

### Milestone 8: v1.0 — GUI Inspector & Plugin Compatibility (Future)

The bidirectional CSS inspector, Fantasy Statblocks support, extended plugin compatibility layer. (Detailed issues to be created when Milestone 7 is complete.)

---

## 7. GitHub Project Structure

### 7.1 Repository

**Name:** `obsidian-typeset`
**Visibility:** Public (open-source, MIT license)
**Primary language:** TypeScript

### 7.2 GitHub Projects Board

**Board name:** Obsidian Typeset Development
**View type:** Board (Kanban)

**Columns:**
- `📋 Backlog` — Issues not yet in an active milestone
- `🎯 Active Milestone` — Issues in the current milestone, not started
- `🔨 In Progress` — Currently being worked on
- `👀 In Review` — Code written, awaiting Brandon's review/approval
- `✅ Done` — Closed issues

### 7.3 Labels

| Label | Color | Usage |
|---|---|---|
| `p0-critical` | Red | Must have for MVP |
| `p1-important` | Orange | High value, important for milestone |
| `p2-nice-to-have` | Yellow | Improvement, not blocking |
| `bug` | Red | Something broken |
| `feat` | Blue | New feature |
| `refactor` | Purple | Code improvement, no behaviour change |
| `docs` | Green | Documentation |
| `test` | Teal | Testing-related |
| `blocked` | Grey | Waiting on something |

### 7.4 Milestones

Create the following GitHub Milestones (map to roadmap milestones):

- `M0: Project Scaffold`
- `M1: Core PDF Export`
- `M2: Block Class Parser & CSS Injection`
- `M3: CSS Editor`
- `M4: Print Preview`
- `M5: D&D Theme & MVP Polish`
- `M6: Book Export (v0.2)`
- `M7: Additional Formats (v0.3)`
- `M8: GUI Inspector (v1.0)`

---

## 8. Definition of Done

A feature or issue is **Done** only when ALL of the following are true:

- [ ] Code is written and compiles without TypeScript errors.
- [ ] ESLint passes with no errors (warnings are acceptable).
- [ ] The feature has been manually tested in `test-vault/` and works as described in the acceptance criteria.
- [ ] No existing working features have been broken (regression check).
- [ ] Relevant code has inline comments for non-obvious logic.
- [ ] The PR has been reviewed and approved by Brandon.
- [ ] The commit follows the Conventional Commits format.
- [ ] The GitHub Issue is closed and moved to "Done" on the Projects board.

---

## 9. Glossary

| Term | Definition |
|---|---|
| **Active theme** | The CSS stylesheet currently selected by the user to be applied at export |
| **Block class syntax** | The `{.classname}` marker placed after a Markdown block to apply a CSS class |
| **Callout class mapping** | The automatic mapping of Obsidian callout type (e.g., `[!stat-block]`) to CSS class (`callout-stat-block`) |
| **Collection note** | (Future) A note that embeds other notes via `![[embed]]` syntax, used for multi-note export |
| **Export pipeline** | The sequence of steps: render → parse → inject CSS → print to PDF → save |
| **Print preview** | The split-pane Obsidian view showing a WYSIWYG preview of the PDF output |
| **`.typeset/` folder** | The vault subfolder where Typeset stores user CSS stylesheets and config |
| **`@page` rule** | CSS at-rule that controls page size, margins, and headers/footers in print output |
| **Homebrewery** | theHomebrewery.naturalcrit.com — a web tool for creating D&D documents; primary visual reference for the D&D theme |
| **WYSIWYG** | What You See Is What You Get — the preview accurately reflects the PDF output |
