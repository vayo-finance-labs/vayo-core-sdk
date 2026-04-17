// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "@kubb/core";
import { pluginClient } from "@kubb/plugin-client";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";

/**
 * Generates the framework-agnostic TypeScript client + types for the Vayo
 * Finance Partner API from the vendored OpenAPI spec (`./openapi.json`).
 *
 * Output: `src/generated/` (gitignored, regenerated on every `bun run gen`).
 *
 * The spec is vendored inside the package (rather than read from
 * `../../docs/core-sdk/openapi.json`) so the public mirror repo is
 * self-contained: contributors to the mirror can run `bun run gen` without
 * needing access to the private monorepo. The file is kept in sync by the
 * `export-partner-openapi` script in the private monorepo.
 *
 * Differences from `apps/web/kubb.config.ts`:
 *   - Reads the static spec, not a live `/swagger/json` endpoint
 *   - No react-query plugin (SDK is framework-agnostic)
 *   - No zod plugin (keep runtime deps at zero)
 *   - `pluginClient.importPath` points at the SDK's internal `src/http.ts`
 *     wrapper instead of the webapp's `kubb-client.ts`
 */
export default defineConfig({
	root: ".",
	input: { path: "./openapi.json" },
	output: { path: "./src/generated", clean: true },
	plugins: [
		pluginOas(),
		pluginTs({
			output: { path: "./types" },
			enumType: "asConst",
		}),
		pluginClient({
			output: { path: "./clients" },
			importPath: "../../http",
		}),
	],
});
