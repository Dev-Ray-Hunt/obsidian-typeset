# CLAUDE.md — Session Protocol for Obsidian Typeset

---

## 👋 When Brandon Says "Hello"

Immediately run the following and report back in this exact format:

1. Run `git status` and `git log --oneline -5`
2. Run `gh issue list --repo Dev-Ray-Hunt/obsidian-typeset --state open --milestone "$(gh api repos/Dev-Ray-Hunt/obsidian-typeset/milestones --jq '[.[] | select(.open_issues > 0)] | first | .title')" --json number,title --jq '.[] | "#\(.number) \(.title)"'`
3. Identify the active milestone by finding the lowest-numbered milestone with open issues

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

## Development Protocol (Baby Steps)

For every issue:
1. **Claude writes the code**
2. **Claude explains the new code** (what it does, why it's written that way)
3. **Brandon tests it** using the Test Checklist from the issue
4. **Edit or move on** — fix anything that fails, then close the issue

**Never skip the explanation step. Never close an issue Brandon hasn't tested.**

---

## Session Startup Checklist

Before touching any code:
1. Read `REQUIREMENTS.md`
2. Run `git status`
3. Identify the active milestone (lowest-numbered with open issues)
4. Find the next open issue on that milestone
5. Wait for Brandon's go-ahead

---

## Key References

| Item | Location |
|---|---|
| Full requirements | `REQUIREMENTS.md` |
| GitHub repo | https://github.com/Dev-Ray-Hunt/obsidian-typeset |
| Project board | https://github.com/users/Dev-Ray-Hunt/projects/2 |
| Issues | https://github.com/Dev-Ray-Hunt/obsidian-typeset/issues |

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
