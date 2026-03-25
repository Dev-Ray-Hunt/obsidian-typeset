# CLAUDE.md — Session Protocol for Obsidian Typeset

> Every Claude Code session MUST follow these steps before writing any code.

---

## Session Startup Checklist

1. **Read `REQUIREMENTS.md`** — the authoritative source of truth for this project.
2. **Run `git status`** — understand the current state of the repo.
3. **Identify the current active milestone** — check which M0–M5 milestone is in progress.
4. **Ask Brandon which GitHub Issue to work on** — or pick the next open issue on the active milestone.

---

## Development Protocol (Baby Steps)

For every issue:
1. **Claude writes the code**
2. **Claude explains the new code** (what it does, why it's written that way)
3. **Brandon tests it** using the Test Checklist from the issue
4. **Edit or move on** — fix anything that fails, then close the issue

**Never skip the explanation step. Never close an issue Brandon hasn't tested.**

---

## Key References

| Item | Location |
|---|---|
| Full requirements | `REQUIREMENTS.md` |
| GitHub repo | https://github.com/Dev-Ray-Hunt/obsidian-typeset |
| Project board | https://github.com/users/Dev-Ray-Hunt/projects/2 |
| Active milestone | Check GitHub Milestones |

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
