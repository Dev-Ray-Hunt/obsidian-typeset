import { Plugin } from "obsidian";
import { TypesetSettings } from "./types";
import {
	loadSettings,
	saveSettings,
	TypesetSettingTab,
} from "./settings";

// TypesetPlugin is the entry point Obsidian calls when your plugin loads.
// Every Obsidian plugin must export a single class that extends Plugin.
//
// Obsidian calls two lifecycle methods:
//   onload()   — plugin is enabled (Obsidian starts, or user enables it in settings)
//   onunload() — plugin is disabled (Obsidian quits, or user disables it in settings)
//
// Future issues will add commands, settings, and views inside onload().
// Resources registered via this.addCommand(), this.registerEvent(), etc. are
// automatically cleaned up by Obsidian when onunload() fires — no manual teardown
// needed for those. Anything we allocate manually must be cleaned up in onunload().

export default class TypesetPlugin extends Plugin {
	settings!: TypesetSettings;

	async onload(): Promise<void> {
		this.settings = await loadSettings(this);

		this.addSettingTab(
			new TypesetSettingTab(this.app, this, this.settings, settings =>
				saveSettings(this, settings),
			),
		);

		console.log(`Typeset: plugin loaded (v${this.manifest.version})`);
	}

	onunload(): void {
		console.log("Typeset: plugin unloaded");
	}
}
