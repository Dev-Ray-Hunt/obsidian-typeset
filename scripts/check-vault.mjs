/**
 * check-vault.mjs
 *
 * Pre-flight check that runs before `npm run dev`.
 * Verifies the test vault symlink exists and points to the repo root.
 * Exits with code 1 and a helpful message if anything is wrong — this
 * prevents esbuild from starting and producing confusing "file not found"
 * errors later in the dev session.
 */

import { existsSync, lstatSync } from "fs";
import { resolve } from "path";

const SYMLINK_PATH = "test-vault/.obsidian/plugins/obsidian-typeset";
const SYMLINK_ABS  = resolve(SYMLINK_PATH);

// ── 1. Does the path exist at all? ───────────────────────────────────────────
let stat;
try {
	stat = lstatSync(SYMLINK_PATH); // lstat does NOT follow symlinks
} catch {
	console.error(`
┌─────────────────────────────────────────────────────────────┐
│  ✗  Dev vault symlink not found                             │
└─────────────────────────────────────────────────────────────┘

Expected a symlink at:
  ${SYMLINK_ABS}

Run this command from the repo root to create it:

  ln -s "$(pwd)" "${SYMLINK_PATH}"

Then run \`npm run dev\` again.
`);
	process.exit(1);
}

// ── 2. Is it actually a symlink (not a real directory)? ──────────────────────
if (!stat.isSymbolicLink()) {
	console.error(`
┌─────────────────────────────────────────────────────────────┐
│  ✗  ${SYMLINK_PATH} exists but is not a symlink          │
└─────────────────────────────────────────────────────────────┘

It should be a symlink pointing to the repo root, not a real directory.
Remove it and recreate with:

  rm -rf "${SYMLINK_PATH}"
  ln -s "$(pwd)" "${SYMLINK_PATH}"
`);
	process.exit(1);
}

// ── 3. Does the symlink target actually exist? ───────────────────────────────
// existsSync follows symlinks — returns false if the target is missing.
if (!existsSync(SYMLINK_PATH)) {
	console.error(`
┌─────────────────────────────────────────────────────────────┐
│  ✗  Symlink exists but its target is missing                │
└─────────────────────────────────────────────────────────────┘

The symlink at:
  ${SYMLINK_ABS}

...points to a location that no longer exists. Delete and recreate:

  rm "${SYMLINK_PATH}"
  ln -s "$(pwd)" "${SYMLINK_PATH}"
`);
	process.exit(1);
}

// ── All good ─────────────────────────────────────────────────────────────────
console.log(`✓ Test vault symlink OK → ${SYMLINK_ABS}`);
