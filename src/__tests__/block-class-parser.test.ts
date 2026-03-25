// block-class-parser.test.ts — Unit tests for parseBlockClasses
// Issue #25: Write unit tests for block class parser (Vitest)

import { describe, it, expect } from "vitest";
import { parseBlockClasses, applyCalloutClasses } from "../block-class-parser";

describe("parseBlockClasses", () => {
	// 1. Single class applied to a paragraph
	it("applies a single class to the preceding paragraph", () => {
		const input = `<p>This paragraph gets a class.</p>\n{.highlight}`;
		const output = parseBlockClasses(input);
		expect(output).toContain('<p class="highlight">');
		expect(output).not.toContain("{.highlight}");
	});

	// 2. Single class applied to a table
	it("applies a single class to the preceding table", () => {
		const input = `<table>\n<tr><td>data</td></tr>\n</table>\n{.stat-block}`;
		const output = parseBlockClasses(input);
		expect(output).toContain('<table class="stat-block">');
		expect(output).not.toContain("{.stat-block}");
	});

	// 3. Multiple classes applied to a single block
	it("applies multiple classes to the preceding block", () => {
		const input = `<p>Styled paragraph.</p>\n{.class1 .class2}`;
		const output = parseBlockClasses(input);
		expect(output).toContain('<p class="class1 class2">');
		expect(output).not.toContain("{.class1 .class2}");
	});

	// 4. Annotation at document start (no preceding block) → safely stripped
	it("safely strips an annotation with no preceding block", () => {
		const input = `{.orphan}\n<p>Some content.</p>`;
		const output = parseBlockClasses(input);
		expect(output).not.toContain("{.orphan}");
		expect(output).toContain("<p>Some content.</p>");
	});

	// 5. Malformed annotation (no dot) → ignored, left in place
	it("leaves malformed annotations without a dot prefix in place", () => {
		const input = `<p>A paragraph.</p>\n{classname}`;
		const output = parseBlockClasses(input);
		expect(output).toContain("{classname}");
		expect(output).toContain("<p>A paragraph.</p>");
	});

	// 6. Two consecutive annotations → each applies to its preceding block
	it("applies two annotations each to their own preceding block", () => {
		const input = [
			"<p>First paragraph.</p>",
			"{.first}",
			"<p>Second paragraph.</p>",
			"{.second}",
		].join("\n");
		const output = parseBlockClasses(input);
		expect(output).toContain('<p class="first">First paragraph.</p>');
		expect(output).toContain('<p class="second">Second paragraph.</p>');
	});

	// 7. Annotation after a heading
	it("applies a class to the preceding heading", () => {
		const input = `<h2>Chapter Title</h2>\n{.chapter-heading}`;
		const output = parseBlockClasses(input);
		expect(output).toContain('<h2 class="chapter-heading">');
		expect(output).not.toContain("{.chapter-heading}");
	});

	// 8. Empty document → returns empty string
	it("returns an empty string for empty input", () => {
		expect(parseBlockClasses("")).toBe("");
	});

	// 9. Document with no annotations → returned unchanged
	it("returns the document unchanged when there are no annotations", () => {
		const input = `<h1>Title</h1>\n<p>A paragraph.</p>\n<table><tr><td>data</td></tr></table>`;
		expect(parseBlockClasses(input)).toBe(input);
	});

	// 10. Class names with hyphens ({.stat-block})
	it("handles hyphenated class names correctly", () => {
		const input = `<table>\n<tr><td>data</td></tr>\n</table>\n{.stat-block}`;
		const output = parseBlockClasses(input);
		expect(output).toContain('<table class="stat-block">');
	});

	// Bonus: Javalent-style spacing { .class } also works
	it("handles Javalent-style spacing { .class } inside braces", () => {
		const input = `<p>A paragraph.</p>\n{ .javalent-class }`;
		const output = parseBlockClasses(input);
		expect(output).toContain('<p class="javalent-class">');
		expect(output).not.toContain("{ .javalent-class }");
	});

	// Bonus: existing class attribute is appended, not replaced
	it("appends to an existing class attribute on the target element", () => {
		const input = `<p class="existing">A paragraph.</p>\n{.new-class}`;
		const output = parseBlockClasses(input);
		expect(output).toContain('class="existing new-class"');
	});
});

describe("applyCalloutClasses", () => {
	// Custom callout type gets callout-<type> class
	it("adds callout-stat-block class to a stat-block callout", () => {
		const input = `<div class="callout" data-callout="stat-block"><p>content</p></div>`;
		const output = applyCalloutClasses(input);
		expect(output).toContain("callout-stat-block");
		expect(output).toContain('class="callout callout-stat-block"');
	});

	// Built-in callout type
	it("adds callout-note class to a note callout", () => {
		const input = `<div class="callout" data-callout="note"><p>content</p></div>`;
		const output = applyCalloutClasses(input);
		expect(output).toContain('class="callout callout-note"');
	});

	// Hyphenated custom type
	it("handles hyphenated callout types like read-aloud", () => {
		const input = `<div class="callout" data-callout="read-aloud"><p>content</p></div>`;
		const output = applyCalloutClasses(input);
		expect(output).toContain("callout-read-aloud");
	});

	// Existing classes are preserved
	it("preserves all existing classes when adding the callout class", () => {
		const input = `<div class="callout is-collapsible" data-callout="warning"><p>content</p></div>`;
		const output = applyCalloutClasses(input);
		expect(output).toContain("callout");
		expect(output).toContain("is-collapsible");
		expect(output).toContain("callout-warning");
	});

	// No callout divs → unchanged
	it("returns the document unchanged when there are no callout divs", () => {
		const input = `<p>No callouts here.</p>`;
		expect(applyCalloutClasses(input)).toBe(input);
	});

	// Multiple callouts in one document
	it("applies classes to all callout divs in the document", () => {
		const input = [
			`<div class="callout" data-callout="note"><p>Note</p></div>`,
			`<div class="callout" data-callout="warning"><p>Warning</p></div>`,
		].join("\n");
		const output = applyCalloutClasses(input);
		expect(output).toContain("callout-note");
		expect(output).toContain("callout-warning");
	});
});
