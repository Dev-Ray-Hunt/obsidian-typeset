// new-stylesheet-modal.ts — Prompt for a new stylesheet filename
// Implemented in Issue #35: Implement New Stylesheet command

import { App, Modal, Notice } from "obsidian";

/**
 * Validates a bare stylesheet name (without the .css extension).
 * Returns an error message string, or null if the name is valid.
 * Only blocks characters that are truly invalid in filenames or dangerous for path traversal.
 */
export function validateStylesheetName(name: string): string | null {
	if (!name.trim()) return "Name cannot be empty.";
	if (/[/\\]/.test(name)) return 'Name cannot contain slashes.';
	if (name === ".." || name === ".") return "That's not a valid name.";
	if (name.includes("..")) return 'Name cannot contain "..".';
	return null;
}

/**
 * Modal that asks the user for a new stylesheet name and calls
 * onSubmit(filename) with the sanitised "<name>.css" string.
 */
export class NewStylesheetModal extends Modal {
	private onSubmit: (filename: string) => void;

	constructor(app: App, onSubmit: (filename: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "New Stylesheet" });

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: "my-theme",
			cls: "typeset-new-stylesheet-input",
		});
		input.style.width = "100%";
		input.style.marginBottom = "8px";

		const errorEl = contentEl.createEl("p", { cls: "typeset-new-stylesheet-error" });
		errorEl.style.color = "var(--text-error)";
		errorEl.style.marginBottom = "8px";
		errorEl.style.minHeight = "1.2em";

		const submit = () => {
			const name = input.value.trim();
			const error = validateStylesheetName(name);
			if (error) {
				errorEl.setText(error);
				return;
			}
			this.close();
			this.onSubmit(`${name}.css`);
		};

		const btn = contentEl.createEl("button", { text: "Create" });
		btn.addEventListener("click", submit);
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") submit();
		});

		// Focus the input as soon as the modal opens.
		setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
