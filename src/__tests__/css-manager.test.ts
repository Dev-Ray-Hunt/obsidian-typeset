// css-manager.test.ts — Unit tests for parseLayoutOverride
// Issue #27: Create css-manager.ts

import { describe, it, expect } from "vitest";
import { parseLayoutOverride } from "../css-manager";

describe("parseLayoutOverride", () => {
	it("returns null when there is no layout override comment", () => {
		const css = `body { color: red; }`;
		expect(parseLayoutOverride(css)).toBeNull();
	});

	it("parses size", () => {
		const css = `/* typeset-layout: size=Letter */\nbody {}`;
		const result = parseLayoutOverride(css);
		expect(result?.size).toBe("Letter");
	});

	it("parses orientation", () => {
		const css = `/* typeset-layout: orientation=Landscape */\nbody {}`;
		const result = parseLayoutOverride(css);
		expect(result?.orientation).toBe("Landscape");
	});

	it("parses margins in mm", () => {
		const css = `/* typeset-layout: margins=20mm */\nbody {}`;
		const result = parseLayoutOverride(css);
		expect(result?.margins).toEqual({ top: 20, right: 20, bottom: 20, left: 20, unit: "mm" });
	});

	it("parses margins in inches", () => {
		const css = `/* typeset-layout: margins=1in */\nbody {}`;
		const result = parseLayoutOverride(css);
		expect(result?.margins?.unit).toBe("in");
		expect(result?.margins?.top).toBe(1);
	});

	it("parses all three fields together", () => {
		const css = `/* typeset-layout: size=A4, orientation=Portrait, margins=15mm */\nbody {}`;
		const result = parseLayoutOverride(css);
		expect(result?.size).toBe("A4");
		expect(result?.orientation).toBe("Portrait");
		expect(result?.margins?.top).toBe(15);
	});

	it("ignores unknown size values", () => {
		const css = `/* typeset-layout: size=Tabloid */\nbody {}`;
		const result = parseLayoutOverride(css);
		expect(result?.size).toBeUndefined();
	});

	it("returns null when comment is present but no valid fields parsed", () => {
		const css = `/* typeset-layout: color=red */\nbody {}`;
		expect(parseLayoutOverride(css)).toBeNull();
	});

	it("ignores a layout comment buried beyond the first 500 characters", () => {
		const padding = "a".repeat(501);
		const css = `${padding}/* typeset-layout: size=A4 */`;
		expect(parseLayoutOverride(css)).toBeNull();
	});
});
