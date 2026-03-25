import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["test-vault/**", "node_modules/**"],
	},
});
