// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"mode-s/privy": "src/mode-s/privy.ts",
		"generated/index": "src/generated/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	target: "es2022",
	external: ["@privy-io/server-auth", "@solana/kit"],
});
