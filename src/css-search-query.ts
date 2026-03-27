// css-search-query.ts — CSS editor search: query parser, block extractor,
// match evaluator, and CM6 decoration layer.
//
// This module is the foundation for all CSS editor search features. It is split
// into four independently-testable layers so future features (e.g. click-to-
// highlight from the preview pane) can reuse any layer without pulling in the
// rest. See REQUIREMENTS §4.3a for the full spec.
//
// ── Layer overview ────────────────────────────────────────────────────────────
//
//  1. QUERY PARSER  (parseQuery)
//     Raw search string → typed boolean AST (BoolExpr).
//     Operators: +  &  and  →  AND
//                |  or      →  OR
//                ( )        →  grouping
//     Terms are lowercased at parse time. Malformed input returns null (no
//     crash — the decoration layer treats null as "no search").
//
//  2. CSS BLOCK EXTRACTOR  (extractCssBlocks)
//     EditorState → CssBlock[].
//     Walks the Lezer syntax tree already built by @codemirror/lang-css.
//     Extracts every RuleSet: its selector text + char range, and each
//     Declaration inside it: property name + char range.
//
//  3. MATCH EVALUATOR  (evaluateQuery)
//     BoolExpr + CssBlock[] → { selectorRanges, propRanges }.
//     Each term is checked against selector text (case-insensitive substring)
//     and each declaration's property name. Ranges are deduplicated so the
//     same line is never highlighted twice.
//
//  4. CM6 DECORATION LAYER  (cssSearchField, setSearchQuery)
//     A CM6 StateField<SearchFieldState> that holds the current query string
//     and the corresponding DecorationSet.  Reacts to:
//       • setSearchQuery effect  →  new query, rebuild decorations
//       • doc change             →  re-run search on new content
//     Provides decorations to the editor view via EditorView.decorations.
//     Two CSS classes:
//       .typeset-search-selector  →  whole selector line(s)   (Colour A)
//       .typeset-search-property  →  matching property line(s) (Colour B)
//
// ─────────────────────────────────────────────────────────────────────────────

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// ══════════════════════════════════════════════════════════════════════════════
// Layer 1 — Query Parser
// ══════════════════════════════════════════════════════════════════════════════

/**
 * A boolean expression tree produced by parseQuery().
 * Every term value is already lowercased.
 */
export type BoolExpr =
	| { kind: "term"; value: string }
	| { kind: "and"; left: BoolExpr; right: BoolExpr }
	| { kind: "or"; left: BoolExpr; right: BoolExpr };

/**
 * Parses a search string into a boolean AST.
 * Returns null for empty input or unrecoverable syntax errors.
 *
 * Grammar (operator precedence: OR < AND):
 *   expr     = or_expr
 *   or_expr  = and_expr ( ("|" | "or")  and_expr )*
 *   and_expr = atom     ( ("+" | "&" | "and") atom )*
 *   atom     = "(" expr ")" | term
 *   term     = any token that is not an operator or parenthesis
 */
export function parseQuery(input: string): BoolExpr | null {
	const tokens = tokenize(input.trim());
	if (tokens.length === 0) return null;
	try {
		const parser = new QueryParser(tokens);
		const expr = parser.parseOr();
		return expr;
	} catch {
		return null;
	}
}

// ── Tokeniser ────────────────────────────────────────────────────────────────

/**
 * Splits a raw query string into a flat token array.
 * Single-character operators (+, &, |, (, )) are their own tokens.
 * Runs of non-operator, non-whitespace characters form word tokens.
 */
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if ("()+&|".includes(ch)) {
			tokens.push(ch);
			i++;
		} else {
			let j = i;
			while (j < input.length && !/[\s()+&|]/.test(input[j])) j++;
			tokens.push(input.slice(i, j));
			i = j;
		}
	}
	return tokens;
}

// ── Recursive-descent parser ─────────────────────────────────────────────────

class QueryParser {
	private pos = 0;
	constructor(private readonly tokens: string[]) {}

	parseOr(): BoolExpr {
		let left = this.parseAnd();
		while (this.isOr(this.peek())) {
			this.consume();
			left = { kind: "or", left, right: this.parseAnd() };
		}
		return left;
	}

	private parseAnd(): BoolExpr {
		let left = this.parseAtom();
		while (this.isAnd(this.peek())) {
			this.consume();
			left = { kind: "and", left, right: this.parseAtom() };
		}
		return left;
	}

	private parseAtom(): BoolExpr {
		if (this.peek() === "(") {
			this.consume();
			const expr = this.parseOr();
			if (this.peek() === ")") this.consume();
			return expr;
		}
		const t = this.consume();
		if (!t || t === ")") throw new Error("Expected term");
		return { kind: "term", value: t.toLowerCase() };
	}

	private peek(): string | undefined {
		return this.tokens[this.pos];
	}
	private consume(): string {
		return this.tokens[this.pos++] ?? "";
	}
	private isOr(t: string | undefined): boolean {
		return t === "|" || t?.toLowerCase() === "or";
	}
	private isAnd(t: string | undefined): boolean {
		return t === "+" || t === "&" || t?.toLowerCase() === "and";
	}
}

// ══════════════════════════════════════════════════════════════════════════════
// Layer 2 — CSS Block Extractor
// ══════════════════════════════════════════════════════════════════════════════

/** A single CSS declaration (property: value) within a rule block. */
export interface CssDeclaration {
	/** The property name, e.g. "font-size", "color". */
	property: string;
	/** Start offset (inclusive) of the whole Declaration node in the document. */
	from: number;
	/** End offset (exclusive) of the whole Declaration node. */
	to: number;
}

/** A CSS rule set: its selector text + character offsets + declarations. */
export interface CssBlock {
	/** Raw selector text, e.g. "h1, h2" or ".callout > p". */
	selectorText: string;
	/** Start offset of the selector (start of the RuleSet node). */
	selectorFrom: number;
	/** End offset of the selector (start of the opening brace). */
	selectorTo: number;
	/** End offset of the closing brace — used to highlight the full rule block. */
	blockTo: number;
	/** All declarations found inside the rule's block. */
	declarations: CssDeclaration[];
}

/**
 * Walks the Lezer syntax tree produced by @codemirror/lang-css and returns
 * every RuleSet in the document as a CssBlock.
 *
 * Works at any nesting depth so rules inside @media / @supports are included.
 * If the syntax tree is not yet available (e.g. during initial parse) the
 * function returns an empty array — no crash.
 */
export function extractCssBlocks(state: EditorState): CssBlock[] {
	const blocks: CssBlock[] = [];
	const tree = syntaxTree(state);

	tree.cursor().iterate(node => {
		if (node.name !== "RuleSet") return;

		const ruleSetNode = node.node;
		const blockNode = ruleSetNode.getChild("Block");
		if (!blockNode) return;

		const selectorFrom = node.from;
		const selectorTo = blockNode.from;
		const selectorText = state.doc
			.sliceString(selectorFrom, selectorTo)
			.trim();

		// Collect every Declaration directly inside this Block.
		const declarations: CssDeclaration[] = [];
		let child = blockNode.firstChild;
		while (child) {
			if (child.name === "Declaration") {
				const propNode = child.getChild("PropertyName");
				if (propNode) {
					declarations.push({
						property: state.doc.sliceString(propNode.from, propNode.to),
						from: child.from,
						to: child.to,
					});
				}
			}
			child = child.nextSibling;
		}

		blocks.push({ selectorText, selectorFrom, selectorTo, blockTo: blockNode.to, declarations });
	});

	return blocks;
}

// ══════════════════════════════════════════════════════════════════════════════
// Layer 3 — Match Evaluator
// ══════════════════════════════════════════════════════════════════════════════

interface CharRange {
	from: number;
	to: number;
}

interface EvalResult {
	matched: boolean;
	selectorRanges: CharRange[];
	propRanges: CharRange[];
}

/**
 * Evaluates a single BoolExpr against a single CssBlock.
 * Returns whether the block matched and which ranges should be highlighted.
 */
function evalExpr(expr: BoolExpr, block: CssBlock): EvalResult {
	switch (expr.kind) {
		case "term": {
			const term = expr.value; // already lowercase
			const selectorRanges: CharRange[] = [];
			const propRanges: CharRange[] = [];

			if (block.selectorText.toLowerCase().includes(term)) {
				// Highlight the entire rule block (selector + { ... }) not
				// just the selector line, so the user sees the full context.
				selectorRanges.push({
					from: block.selectorFrom,
					to: block.blockTo,
				});
			}
			for (const decl of block.declarations) {
				if (decl.property.toLowerCase().includes(term)) {
					propRanges.push({ from: decl.from, to: decl.to });
				}
			}

			return {
				matched: selectorRanges.length > 0 || propRanges.length > 0,
				selectorRanges,
				propRanges,
			};
		}

		case "and": {
			const l = evalExpr(expr.left, block);
			const r = evalExpr(expr.right, block);
			const matched = l.matched && r.matched;
			return {
				matched,
				selectorRanges: matched
					? [...l.selectorRanges, ...r.selectorRanges]
					: [],
				propRanges: matched ? [...l.propRanges, ...r.propRanges] : [],
			};
		}

		case "or": {
			const l = evalExpr(expr.left, block);
			const r = evalExpr(expr.right, block);
			const matched = l.matched || r.matched;
			// Collect ranges from whichever sides matched.
			const selectorRanges = [
				...(l.matched ? l.selectorRanges : []),
				...(r.matched ? r.selectorRanges : []),
			];
			const propRanges = [
				...(l.matched ? l.propRanges : []),
				...(r.matched ? r.propRanges : []),
			];
			return { matched, selectorRanges, propRanges };
		}
	}
}

/**
 * Evaluates the query against every CSS block in the document.
 * Deduplicates ranges so the same character range is never highlighted twice
 * (e.g. an OR expression matching the same selector from two branches).
 */
export function evaluateQuery(
	expr: BoolExpr,
	blocks: CssBlock[],
): { selectorRanges: CharRange[]; propRanges: CharRange[] } {
	const selSeen = new Set<string>();
	const propSeen = new Set<string>();
	const selectorRanges: CharRange[] = [];
	const propRanges: CharRange[] = [];

	for (const block of blocks) {
		const result = evalExpr(expr, block);
		if (!result.matched) continue;

		for (const r of result.selectorRanges) {
			const key = `${r.from}:${r.to}`;
			if (!selSeen.has(key)) {
				selSeen.add(key);
				selectorRanges.push(r);
			}
		}
		for (const r of result.propRanges) {
			const key = `${r.from}:${r.to}`;
			if (!propSeen.has(key)) {
				propSeen.add(key);
				propRanges.push(r);
			}
		}
	}

	return { selectorRanges, propRanges };
}

// ══════════════════════════════════════════════════════════════════════════════
// Layer 4 — CM6 Decoration Layer
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Dispatching this effect on an EditorView updates the active search query
 * and immediately rebuilds the highlight decorations.
 *
 * Usage:
 *   view.dispatch({ effects: setSearchQuery.of("h1 and font-size") });
 */
export const setSearchQuery = StateEffect.define<string>();

/** Internal state stored by cssSearchField. */
interface SearchFieldState {
	/** The current raw query string (empty = no search active). */
	query: string;
	/** The current set of highlight decorations. */
	decorations: DecorationSet;
}

/**
 * Builds a DecorationSet from a query string and the current editor state.
 * Returns Decoration.none for empty/invalid queries (no crash).
 */
function buildDecorations(state: EditorState, query: string): DecorationSet {
	if (!query.trim()) return Decoration.none;

	const expr = parseQuery(query);
	if (!expr) return Decoration.none;

	const blocks = extractCssBlocks(state);
	const { selectorRanges, propRanges } = evaluateQuery(expr, blocks);

	// Merge all ranges into a single sorted list for RangeSetBuilder.
	// RangeSetBuilder requires strict ascending order and no overlaps.
	const allRanges: { from: number; to: number; cls: string }[] = [];
	for (const r of selectorRanges) {
		allRanges.push({ ...r, cls: "typeset-search-selector" });
	}
	for (const r of propRanges) {
		allRanges.push({ ...r, cls: "typeset-search-property" });
	}
	allRanges.sort((a, b) => a.from - b.from || a.to - b.to);

	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to, cls } of allRanges) {
		if (from < to) {
			builder.add(from, to, Decoration.mark({ class: cls }));
		}
	}
	return builder.finish();
}

/**
 * CM6 StateField that tracks the current search query and its decorations.
 *
 * Add this to your EditorState extensions to enable search highlighting.
 * Reacts to:
 *   • setSearchQuery effect — stores new query, rebuilds decorations
 *   • document changes     — re-runs search against updated content
 *
 * Provides decorations automatically via EditorView.decorations.
 */
export const cssSearchField = StateField.define<SearchFieldState>({
	create: () => ({ query: "", decorations: Decoration.none }),

	update(value, tr) {
		let { query } = value;

		// Check for an incoming query change.
		for (const effect of tr.effects) {
			if (effect.is(setSearchQuery)) {
				query = effect.value;
			}
		}

		// Rebuild if the query changed or the document was edited.
		if (query !== value.query || tr.docChanged) {
			return { query, decorations: buildDecorations(tr.state, query) };
		}

		// Otherwise map existing decorations through document changes (no-op if
		// the document didn't change, safe to call regardless).
		return { query, decorations: value.decorations.map(tr.changes) };
	},

	// Provide this field's decorations to the EditorView.
	provide: field => EditorView.decorations.from(field, s => s.decorations),
});
