// preview-view.ts — Split-pane print preview Obsidian View
// Implemented in Issue #39: Create preview-view.ts

import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_PREVIEW = "typeset-preview";

export class TypesetPreviewView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PREVIEW;
	}

	getDisplayText(): string {
		return "Print Preview";
	}

	getIcon(): string {
		return "lucide-layout-template";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("typeset-preview-view");
		contentEl.createEl("p", {
			text: "Open a note to preview",
			cls: "typeset-preview-placeholder",
		});
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}
