// pdf-exporter.ts — Core PDF export pipeline

import { Notice, Platform, TFile } from "obsidian";
import { TypesetSettings } from "./types";

export class PdfExporter {
	constructor(private settings: TypesetSettings) {}

	async export(file: TFile): Promise<void> {
		if (!Platform.isDesktop) {
			new Notice("PDF export requires Obsidian Desktop.");
			return;
		}

		// Platform confirmed — subsequent issues will implement the full pipeline:
		// Issue #19: render Markdown → HTML
		// Issue #20: pass HTML to Electron printToPDF
		console.log(
			`Typeset: Desktop confirmed — export will proceed for "${file.name}"`,
		);
	}
}
