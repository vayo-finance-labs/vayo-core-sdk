// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * createVayoPartnerClient — happy-path coverage of:
 *   - x-api-key injection on every request
 *   - Idempotency-Key auto-generation on mutating routes (and respect for caller-provided values)
 *   - Trailing slash stripping on baseUrl
 *   - Query string serialization (including comma-joined arrays)
 *   - VayoApiError thrown on non-2xx
 *   - Top-level client surface matches the current (post-Mode-V-removal) shape
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createVayoPartnerClient } from "../src/client";
import { VayoApiError } from "../src/errors";

interface CapturedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

const captured: CapturedRequest[] = [];

function makeJsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function makeFakeFetch(
	responder: (req: CapturedRequest) => Response = () =>
		makeJsonResponse({ ok: true }),
): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const req: CapturedRequest = {
			url: typeof input === "string" ? input : input.toString(),
			method: (init?.method ?? "GET").toString(),
			headers: normalizeHeaders(init?.headers),
			body: init?.body !== undefined ? safeJson(init.body) : undefined,
		};
		captured.push(req);
		return responder(req);
	}) as unknown as typeof fetch;
}

function normalizeHeaders(
	headers: HeadersInit | undefined,
): Record<string, string> {
	if (!headers) return {};
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((v, k) => {
			out[k.toLowerCase()] = v;
		});
		return out;
	}
	if (Array.isArray(headers)) {
		return Object.fromEntries(headers.map(([k, v]) => [k.toLowerCase(), v]));
	}
	return Object.fromEntries(
		Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
	);
}

function safeJson(body: BodyInit): unknown {
	if (typeof body !== "string") return body;
	try {
		return JSON.parse(body);
	} catch {
		return body;
	}
}

beforeEach(() => {
	captured.length = 0;
});
afterEach(() => {
	captured.length = 0;
});

describe("createVayoPartnerClient", () => {
	it("throws when baseUrl or apiKey is missing", () => {
		expect(() => createVayoPartnerClient({ baseUrl: "", apiKey: "k" })).toThrow(
			/baseUrl/,
		);
		expect(() =>
			createVayoPartnerClient({ baseUrl: "https://x", apiKey: "" }),
		).toThrow(/apiKey/);
	});

	it("strips trailing slashes from baseUrl", async () => {
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance///",
			apiKey: "vayo_pk_test",
			fetch: makeFakeFetch(),
		});
		await client.dashboard.overview();
		expect(captured[0]?.url).toBe(
			"https://api.vayo.finance/v1/dashboard/overview",
		);
	});

	it("injects x-api-key on read endpoints (no JWT, no idempotency-key)", async () => {
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance",
			apiKey: "vayo_pk_abc",
			fetch: makeFakeFetch(),
		});
		await client.dashboard.overview();

		const req = captured[0];
		expect(req).toBeDefined();
		expect(req?.method).toBe("GET");
		expect(req?.headers["x-api-key"]).toBe("vayo_pk_abc");
		expect(req?.headers.authorization).toBeUndefined();
		expect(req?.headers["idempotency-key"]).toBeUndefined();
	});

	it("exposes only the current partner surface (no auth/wallets/lendingOperations)", () => {
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance",
			apiKey: "vayo_pk_abc",
			fetch: makeFakeFetch(),
		});
		expect(client.lending).toBeDefined();
		expect(client.modeS).toBeDefined();
		expect(client.dashboard).toBeDefined();
		expect(client.health).toBeDefined();
		// Mode V + payments surface removed.
		expect(
			(client as unknown as Record<string, unknown>).payments,
		).toBeUndefined();
		expect((client as unknown as Record<string, unknown>).auth).toBeUndefined();
		expect(
			(client as unknown as Record<string, unknown>).wallets,
		).toBeUndefined();
		expect(
			(client as unknown as Record<string, unknown>).lendingOperations,
		).toBeUndefined();
		// Health exposes all four subprobes.
		expect(typeof client.health.liveness).toBe("function");
		expect(typeof client.health.kora).toBe("function");
		expect(typeof client.health.modeS).toBe("function");
		expect(typeof client.health.ready).toBe("function");
	});

	it("auto-generates Idempotency-Key on mutating routes via the override hook", async () => {
		let counter = 0;
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance",
			apiKey: "vayo_pk_abc",
			fetch: makeFakeFetch(),
			generateIdempotencyKey: () => `test-idem-${++counter}`,
		});

		await client.modeS.buildRedeem({
			body: {} as never,
		});
		expect(captured[0]?.headers["idempotency-key"]).toBe("test-idem-1");
		expect(captured[0]?.method).toBe("POST");
		expect(captured[0]?.headers["content-type"]).toBe("application/json");
		expect(captured[0]?.headers["x-api-key"]).toBe("vayo_pk_abc");
		// No JWT is threaded through the public surface anymore.
		expect(captured[0]?.headers.authorization).toBeUndefined();

		// Reuses the override hook on each call (proves no caching across calls).
		await client.modeS.buildRedeem({
			body: {} as never,
		});
		expect(captured[1]?.headers["idempotency-key"]).toBe("test-idem-2");
	});

	it("honors a caller-provided idempotency key (for retries)", async () => {
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance",
			apiKey: "vayo_pk_abc",
			fetch: makeFakeFetch(),
			generateIdempotencyKey: () => "auto-should-not-be-used",
		});
		await client.modeS.buildRedeem({
			idempotencyKey: "caller-key-123",
			body: {} as never,
		});
		expect(captured[0]?.headers["idempotency-key"]).toBe("caller-key-123");
	});

	it("serializes lending.reserves array params as a comma-joined query string", async () => {
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance",
			apiKey: "vayo_pk_abc",
			fetch: makeFakeFetch(),
		});
		await client.lending.reserves({
			mints: [
				"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				"So11111111111111111111111111111111111111112",
			],
		});
		const url = captured[0]?.url ?? "";
		expect(url).toContain("/v1/lending/reserves");
		expect(url).toContain(
			"mints=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v%2CSo11111111111111111111111111111111111111112",
		);
	});

	it("throws VayoApiError with statusCode/message/correlationId on non-2xx", async () => {
		const client = createVayoPartnerClient({
			baseUrl: "https://api.vayo.finance",
			apiKey: "vayo_pk_abc",
			fetch: makeFakeFetch(() =>
				makeJsonResponse(
					{
						statusCode: 403,
						message: "Market not in partner allowlist",
						correlationId: "corr-1",
					},
					{ status: 403 },
				),
			),
		});

		let captured: unknown;
		try {
			await client.dashboard.overview();
		} catch (err) {
			captured = err;
		}
		expect(captured).toBeInstanceOf(VayoApiError);
		const err = captured as VayoApiError;
		expect(err.statusCode).toBe(403);
		expect(err.message).toBe("Market not in partner allowlist");
		expect(err.correlationId).toBe("corr-1");
	});
});
