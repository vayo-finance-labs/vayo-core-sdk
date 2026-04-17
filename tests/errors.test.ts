// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Error handling — `VayoApiError.fromBody` parses the API's standard error
 * envelope into a structured Error subclass that partners can `instanceof`-
 * test in catch blocks.
 */

import { describe, expect, it } from "bun:test";

import { VayoApiError } from "../src/errors";

describe("VayoApiError.fromBody", () => {
	it("parses {statusCode, message, code, correlationId} into class fields", () => {
		const err = VayoApiError.fromBody(403, "Forbidden", {
			statusCode: 403,
			message: "Market not in partner allowlist",
			code: "MARKET_NOT_ALLOWED",
			correlationId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		});

		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(VayoApiError);
		expect(err.name).toBe("VayoApiError");
		expect(err.statusCode).toBe(403);
		expect(err.message).toBe("Market not in partner allowlist");
		expect(err.code).toBe("MARKET_NOT_ALLOWED");
		expect(err.correlationId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
	});

	it("falls back to status text when the body is empty", () => {
		const err = VayoApiError.fromBody(500, "Internal Server Error", null);
		expect(err.statusCode).toBe(500);
		expect(err.message).toBe("Internal Server Error");
		expect(err.code).toBeNull();
		expect(err.correlationId).toBeNull();
	});

	it('falls back to "HTTP <code>" when both body and status text are empty', () => {
		const err = VayoApiError.fromBody(418, "", null);
		expect(err.message).toBe("HTTP 418");
	});

	it("round-trips through instanceof after construction", () => {
		const err = new VayoApiError(429, "Rate limited");
		expect(err instanceof VayoApiError).toBe(true);
		expect(err instanceof Error).toBe(true);
	});
});
