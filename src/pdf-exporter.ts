// pdf-exporter.ts — Core PDF export pipeline

import { App, Component, MarkdownRenderer, Notice, Platform, TFile } from "obsidian";
import { TypesetSettings } from "./types";

export class PdfExporter {
	constructor(private app: App, private settings: TypesetSettings) {}

	async export(file: TFile): Promise<void> {
		if (!Platform.isDesktop) {
			new Notice("PDF export requires Obsidian Desktop.");
			return;
		}

		// Step 1: Read the raw Markdown from the vault
		const markdown = await this.app.vault.read(file);

		// Step 2: Create a temporary DOM element for Obsidian to render into.
		// MarkdownRenderer writes real HTML into this container — it never
		// touches the visible document, so there are no flashes or side effects.
		const container = document.createElement("div");

		// Step 3: MarkdownRenderer requires a Component to track any
		// subscriptions it creates (e.g. live embeds). We create a minimal
		// one, load it, then unload it immediately after rendering so nothing
		// leaks into the plugin's lifecycle.
		const component = new Component();
		component.load();

		// Step 4: Render Markdown → HTML.
		// - app       : needed for wikilink resolution, vault access
		// - markdown  : raw file content
		// - container : target DOM node
		// - file.path : source path — lets Obsidian resolve relative links
		// - component : lifecycle owner (cleaned up below)
		await MarkdownRenderer.render(
			this.app,
			markdown,
			container,
			file.path,
			component,
		);

		component.unload();

		// Step 5: Pull the finished HTML string out of the container.
		// Issue #20 will pass this to Electron's printToPDF instead of logging.
		const html = container.innerHTML;
		console.log(`Typeset: Rendered HTML for "${file.name}":\n`, html);
	}
}
