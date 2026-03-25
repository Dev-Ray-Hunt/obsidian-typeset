// block-class-parser.ts — Parses {.classname} block syntax
// Implemented in Issue #24: Create block-class-parser.ts

// Matches a standalone annotation line like {.class1 .class2} or { .class1 .class2 }
// Supports optional whitespace inside braces for Javalent Markdown Attributes compatibility
// Must be the entire line, each class prefixed with a dot, valid CSS identifiers
const ANNOTATION_REGEX = /^\{\s*(\.[a-zA-Z_][\w-]*(?:\s+\.[a-zA-Z_][\w-]*)*)\s*\}\s*$/;

// Matches any block-level opening or closing tag
const BLOCK_TAGS = "p|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|pre|div|figure|figcaption|section|article|aside|header|footer|main";
const TAG_RE = new RegExp(`<(/?)(?:${BLOCK_TAGS})(\\s[^>]*)?>`, "g");

/**
 * Parses {.classname} annotations in HTML and applies them as CSS classes
 * to the immediately preceding block-level element.
 *
 * Uses a nesting-depth approach when walking backwards: closing tags increase
 * depth, opening tags decrease it. When depth reaches 0 at an opening tag,
 * that is the outermost preceding block — our target.
 *
 * Annotation lines are always removed from output, whether or not they match
 * a preceding block. Malformed/invalid annotation-like lines are left as-is.
 */
export function parseBlockClasses(html: string): string {
	const lines = html.split("\n");
	const result: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = line.match(ANNOTATION_REGEX);

		if (!match) {
			result.push(line);
			continue;
		}

		// Parse class names from ".class1 .class2" → ["class1", "class2"]
		const classes = match[1].split(/\s+/).map((c) => c.slice(1));

		// Walk backwards through result lines tracking nesting depth.
		// Closing tags increase depth, opening tags decrease it.
		// When depth reaches 0 at an opening tag, that is the outermost
		// preceding block — the correct target for the annotation.
		let depth = 0;
		let applied = false;

		outer: for (let j = result.length - 1; j >= 0; j--) {
			const resultLine = result[j];

			// Collect all block-level tags on this line with their positions
			const tags: Array<{ isClose: boolean; tagName: string; start: number; full: string }> = [];
			for (const m of resultLine.matchAll(TAG_RE)) {
				tags.push({
					isClose: m[1] === "/",
					tagName: m[0].match(/^<\/?([a-zA-Z0-9]+)/)?.[1] ?? "",
					start: m.index!,
					full: m[0],
				});
			}

			// Process tags right to left (we are walking the document backwards)
			for (let k = tags.length - 1; k >= 0; k--) {
				const tag = tags[k];
				if (tag.isClose) {
					depth++;
				} else {
					depth--;
					if (depth === 0) {
						// This opening tag is the outermost preceding block — apply here
						result[j] = injectClassAtPosition(resultLine, tag, classes);
						applied = true;
						break outer;
					}
					if (depth < 0) {
						// Unclosed opening tag above the annotation — do not target it
						depth = 0;
					}
				}
			}
		}

		// Annotation line is always consumed (not pushed to result),
		// whether or not it was applied. If no preceding block, silently dropped.
		void applied;
	}

	return result.join("\n");
}

/**
 * Injects CSS class names directly at a known tag position within a line.
 * Appends to an existing class attribute if present, otherwise adds one.
 */
function injectClassAtPosition(
	line: string,
	tag: { start: number; full: string },
	classes: string[]
): string {
	const classStr = classes.join(" ");
	let newTag: string;

	if (/\bclass="[^"]*"/i.test(tag.full)) {
		newTag = tag.full.replace(/\bclass="([^"]*)"/i, `class="$1 ${classStr}"`);
	} else {
		// Insert class attribute before the closing >
		newTag = tag.full.replace(/>$/, ` class="${classStr}">`);
	}

	return line.slice(0, tag.start) + newTag + line.slice(tag.start + tag.full.length);
}
