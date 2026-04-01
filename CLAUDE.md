# CLAUDE.md — Session Protocol for Obsidian Typeset

---

## 👋 When Brandon Says "Hello"

Immediately run the following and report back in this exact format:

1. Run `git status` and `git log --oneline -5`
2. Run `gh issue list --repo Dev-Ray-Hunt/obsidian-typeset --state open --milestone "$(gh api repos/Dev-Ray-Hunt/obsidian-typeset/milestones --jq '[.[] | select(.open_issues > 0)] | first | .title')" --json number,title --jq '.[] | "#\(.number) \(.title)"'`
3. Identify the active milestone by finding the lowest-numbered milestone with open issues
4. Tell Brandon to run `/rename <active milestone title>` to name the session (e.g. `/rename M2: Block Class Parser & CSS Injection`)

Then respond with something like:

---

**Hey Brandon! Here's where we are:**

- 📍 **Active Milestone:** M1 — Core PDF Export
- ✅ **Last completed:** Issue #14 — Verify full dev loop
- 🔜 **Next up:** Issue #15 — Create types.ts with core interfaces
- 🌿 **Git status:** Clean / [any uncommitted changes]

Ready to go on Issue #15 whenever you are — just say the word!

---

Always orient before asking what to do. Never make Brandon figure out where we left off.

---

## 🆘 When Brandon Says "Please Help"

This activates **Debug & Refactor Mode**. Run the following immediately, in order, before asking anything:

1. Run `git log --oneline -10` — see what was recently changed
2. Run `git diff HEAD~1 HEAD -- $(git diff --name-only HEAD~1 HEAD)` — see the exact code changes
3. Run `git status` — check for any uncommitted work
4. Read the issue currently `In Progress` on the GitHub project board
5. Skim the relevant source file(s) touched by recent commits

Then respond in this exact format:

---

**Got it — here's what I can see:**

- 🔍 **Last change:** `fix(preview): switched to live DOM render to fix callout visibility` (commit abc1234)
- 📄 **Files touched:** `src/preview-view.ts`
- 🐛 **Issue in progress:** #40 — Render active note as paginated HTML
- 🌿 **Git status:** Clean / [uncommitted changes]

**What's the problem you're running into?**

---

Once I've reported the orientation summary, **ask Brandon two questions before touching anything:**

1. **"What's the issue you're running into?"**
2. **"What's your current theory on how to fix it?"**

Then — before writing a single line of code — do the following:

1. **Read the relevant code** referenced in the recent commits and the in-progress issue.
2. **Evaluate Brandon's idea honestly.** Not kindly — honestly. If the idea is good, say so and explain why. If it has problems, say so directly and explain what will go wrong. Do not soften the critique to protect feelings.
3. **Present all viable alternatives.** List every reasonable approach, with honest trade-offs for each. Don't steer toward Brandon's idea just because he suggested it.
4. **Recommend the best option clearly.** State which option you think is best and why. If Brandon's idea is the best, say that. If it isn't, say that too.

**This is a BEST IDEA WINS environment. The goal is the right solution, not agreement.**

---

### Debug Master Rules
- **Hypothesize before touching code.** State your theory clearly: *"I think X is happening because Y."*
- **Confirm before fixing.** Add the smallest possible diagnostic (console.log, CSS highlight, etc.) to PROVE the theory before writing the real fix.
- **One variable at a time.** Never change two things at once — you'll lose the signal.
- **Show your reasoning.** After each test, explain what the result means and what it rules out.
- **Don't guess-fix.** If you don't know why something is broken, say so and propose a diagnostic step instead of trying random fixes.
- **Refactor only after the bug is fixed.** Never clean up and fix at the same time.
- **Read the error message literally.** The first line of the stack trace is almost always the answer.

### Refactor Master Rules
- **Understand before changing.** Read the full function/module before touching anything.
- **Preserve behaviour.** Refactors must not change what the code does — only how it's written.
- **Explain the "why".** Don't just show the new code — explain what was wrong with the old approach.
- **Small steps.** One logical change per commit.

---

## Development Protocol (Baby Steps)

For every issue:
1. **Claude writes the code**
2. **Claude explains the new code** (what it does, why it's written that way)
3. **Brandon tests it** using the Test Checklist from the issue
4. **Edit or move on** — fix anything that fails, then close the issue

**Never skip the explanation step. Never close an issue Brandon hasn't tested.**

---

## GitHub Project Board Protocol

Use the GraphQL API (`gh api graphql`) to keep the project board current:

- **When starting a new Milestone:** Set all issues on that milestone to `Active Milestone`
- **When starting work on an issue:** Set that issue to `In Progress`
- **When an issue is closed:** Set it to `Done`

### Key IDs (Project 2 — obsidian-typeset)
- Project ID: `PVT_kwHOCgOGys4BStuF`
- Status Field ID: `PVTSSF_lAHOCgOGys4BStuFzhAKu1Q`
- Status Options:
  - Backlog: `bfe80b19`
  - Active Milestone: `f6ee813c`
  - In Progress: `eb1ce8b8`
  - In Review: `c304acc2`
  - Needs Testing: `3a0ef14d`
  - Done: `ed330029`

---

## Session Startup Checklist

Before touching any code:
1. Read `REQUIREMENTS.md`
2. Run `git status`
3. Identify the active milestone (lowest-numbered with open issues)
4. Find the next open issue on that milestone
5. Wait for Brandon's go-ahead

---

## Long-Term Feature Ideas

When Brandon wants to capture a future feature idea:
- Create a GitHub issue and assign it to the **"Roadmap & Future Features"** milestone (milestone #7)
- No need to worry about implementation details — just capture the idea clearly
- These issues won't block any active milestone and can be promoted to a real milestone later

## Key References

| Item | Location |
|---|---|
| Full requirements | `REQUIREMENTS.md` |
| GitHub repo | https://github.com/Dev-Ray-Hunt/obsidian-typeset |
| Project board | https://github.com/users/Dev-Ray-Hunt/projects/2 |
| Issues | https://github.com/Dev-Ray-Hunt/obsidian-typeset/issues |
| Roadmap milestone | https://github.com/Dev-Ray-Hunt/obsidian-typeset/milestone/7 |

---

## Commit Convention

```
feat(scope): short description
fix(scope): short description
refactor(scope): short description
docs(scope): short description
chore(scope): short description
test(scope): short description
```

**Scopes:** `pdf-engine`, `css-editor`, `parser`, `preview`, `settings`, `ui`, `scaffold`

---

## Branch Strategy

- `main` — stable, always-working. Never commit broken code here.
- `dev` — active development. All work happens here.
- Feature branches: `feat/issue-<number>-<short-name>`
- Merge to `dev` via PR; merge `dev` → `main` at milestone completion.

### Branch Workflow (follow this every milestone)

**When starting a new milestone:**
1. Create `dev` branch off `main`: `git checkout -b dev`
2. Push it immediately: `git push -u origin dev`
3. All issue work goes on `dev` (commit and push `dev` regularly as backup)

**When closing a milestone:**
1. Ensure all issues are closed and tests pass on `dev`
2. Merge `dev` → `main`: `git checkout main && git merge dev`
3. Push `main`: `git push origin main`
4. Delete `dev`: `git branch -d dev && git push origin --delete dev`
5. Create a fresh `dev` for the next milestone

> M1 was committed directly to `main` (branch strategy not yet in place).
> M2 onwards must follow this flow.

---

## Error Handling Standard

- User-facing errors: Obsidian `Notice` with friendly message
- Debug details: `console.error` with full context
- Never swallow errors silently

---

## Rules

- Never delete existing functionality without explicit approval from Brandon
- Flag uncertainty — ask rather than guess
- Explain what you're about to do before touching more than one file
- All user-facing strings must be clear, friendly English — no jargon

---

## Architecture Decisions (Do Not Revisit Without Explicit Approval)

### User theme storage: `<plugin>/themes/` NOT `<vault>/.typeset/`

User stylesheets live in `<plugin>/themes/` (i.e. `app.vault.configDir + "/plugins/obsidian-typeset/themes/"`).

A vault-level `.typeset/` directory was attempted in Issue #35 but caused the frontmatter theme autocomplete (`TypesetThemeSuggest`) and the theme picker modal (`ThemePickerModal`) to stop discovering user themes. Both of those classes construct their own `CssManager` instance, so any change to `themesDir` affects them directly.

**Do not change the theme storage location without also verifying that `TypesetThemeSuggest` and `ThemePickerModal` still discover themes correctly.**

### Unified Rendering Pipeline (Phases A/B/C) — Approved 2026-04-01

The preview and PDF pipelines were built independently and diverged structurally. After extensive debugging (#72, #73) and a 4-agent architecture review (`docs/architecture-review/`), Brandon approved a 3-phase plan to unify them:

**Phase A (#74): Extract shared document builder** — Create `src/document-builder.ts` with `mergeLayout()`, `renderMarkdownToHtml()`, `resolveThemeCss()`, and `buildDocumentHtml()`. Refactor both `preview-view.ts` and `pdf-exporter.ts` to consume the shared module. Low risk, high value.

**Phase B (#75): Isolated PDF rendering in BrowserWindow** — Move PDF export from Obsidian's live DOM into a hidden `BrowserWindow`. **Critical: Build bare pipeline first (no themes, only Obsidian CSS + page margins), validate parity, then add themes.** This eliminates the `body` → `#typeset-print-root` regex rewrite, the `appContainer.style.display = "none"` mutation, and all 13 `!important` declarations in the PDF path.

**Phase C (#76): CSS @layer** — Wrap CSS in `@layer obsidian, theme, layout` blocks for deterministic cascade ordering. Eliminates remaining `!important` declarations in the preview path.

**#77: Polish** — Final visual fine-tuning after the pipeline is unified.

**Order: A → B (B1 bare, then B2 themed) → C → Polish**

The full architecture review is in `docs/architecture-review/synthesis-and-recommendation.md`. The detailed implementation plan (with test checklists) is in the GitHub issues above.

### Known uncommitted changes from #72/#73 work

There are uncommitted changes on `dev` branch to `built-in/default.css`, `src/preview-view.ts`, and `src/pdf-exporter.ts` from the CSS parity debugging session. These include:
- Added `markdown-rendered` class to preview iframe body and PDF `#typeset-print-root` div
- Added Layer 3 CSS baseline rules (table border reset, callout icon/fold hiding)
- Removed font-family overrides from `default.css` headings (they now inherit from body)

These changes should be committed before starting Phase A, or incorporated into the Phase A refactor.
