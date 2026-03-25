// block-class-parser.ts — Parses {.classname} block syntax
// Implemented in Issue #24: Create block-class-parser.ts

// Matches a standalone annotation line like {.class1 .class2}
// Must be the entire line, each class prefixed with a dot, valid CSS identifiers
const ANNOTATION_REGEX = /^\{(\.[a-zA-Z_][\w-]*(?:\s+\.[a-zA-Z_][\w-]*)*)\}\s*$/;

/**
 * Parses {.classname} annotations in HTML and applies them as CSS classes
 * to the immediately preceding block-level element.
 *
 * Annotation lines are always removed from output, whether or not they match
 * a preceding block. Malformed/invalid annotation-like lines are left as-is.
 */
export function parseBlockClasses(html: string): string {
	// Split on block-level tags so we can work line-by-line within each segment.
	// Strategy: split the HTML into lines, then for each annotation line find
	// the closest preceding opening block tag and inject the class there.
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
		const classes = match[1]
			.split(/\s+/)
			.map((c) => c.slice(1)); // strip leading dot

		// Walk backwards through result to find the last line containing a
		// block-level opening tag to inject the classes into.
		let applied = false;
		for (let j = result.length - 1; j >= 0; j--) {
			const blockTagMatch = result[j].match(
				/<(p|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|pre|div|figure|figcaption|section|article|aside|header|footer|main)(\s[^>]*)?>/
			);
			if (blockTagMatch) {
				result[j] = injectClasses(result[j], blockTagMatch[1], classes);
				applied = true;
				break;
			}
		}

		// Annotation line is always consumed (not pushed to result),
		// whether or not it was applied. If not applied (no preceding block),
		// it is silently dropped.
		void applied;
	}

	return result.join("\n");
}

/**
 * Injects CSS class names into the first matching opening tag in a line.
 * If the tag already has a class attribute, the new classes are appended.
 * If not, a class attribute is added.
 */
function injectClasses(line: string, tagName: string, classes: string[]): string {
	const classStr = classes.join(" ");

	// Try to append to an existing class attribute
	const withExistingClass = line.replace(
		new RegExp(`(<${tagName}[^>]*\\bclass=")([^"]*)"`, "i"),
		(_, open, existing) => `${open}${existing} ${classStr}"`
	);

	if (withExistingClass !== line) return withExistingClass;

	// No existing class — inject class attribute after the tag name
	return line.replace(
		new RegExp(`(<${tagName})(\\s|>)`, "i"),
		(_, tag, after) => `${tag} class="${classStr}"${after}`
	);
}
