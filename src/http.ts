// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Internal fetch wrapper consumed by the kubb-generated client functions in
 * `src/generated/clients/`. The shape (`client`, `Client`, `RequestConfig`,
 * `ResponseConfig`, `ResponseErrorConfig`) is dictated by the kubb plugin —
 * generated files import these exact names.
 *
 * Adapted from `apps/web/src/shared/api/kubb-client.ts`. Differences:
 *   - Parameterized over a `ClientContext` (baseUrl + apiKey + custom fetch +
 *     idempotency-key generator) supplied by `createVayoPartnerClient()`.
 *     The context is threaded through `RequestConfig.context`.
 *   - Injects `x-api-key` instead of `Authorization: Bearer` for partner auth
 *   - Auto-generates `Idempotency-Key` for mutating routes when not provided
 *   - Throws a structured `VayoApiError` instead of the raw response body
 *
 * This module is NOT a public export — partners interact with the high-level
 * `createVayoPartnerClient()` from `src/client.ts`.
 */

import { VayoApiError, type VayoErrorBody } from "./errors";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NO_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Per-request context injected by `createVayoPartnerClient()` into every
 * generated client call via `RequestConfig.context`. Holds connection
 * details, auth, and fetch overrides.
 */
export interface ClientContext {
	baseUrl: string;
	apiKey: string;
	/** Per-call idempotency key. Auto-generated for mutating routes if absent. */
	idempotencyKey?: string;
	/** Custom fetch (e.g. for Node 18-, edge runtimes, instrumentation). */
	fetch?: typeof fetch;
	/** Override the default UUID v4 generator (useful for deterministic tests). */
	generateIdempotencyKey?: () => string;
}

export type RequestConfig<TData = unknown> = {
	baseURL?: string;
	url?: string;
	method?: "GET" | "PUT" | "PATCH" | "POST" | "DELETE" | "OPTIONS" | "HEAD";
	params?: unknown;
	data?: TData | FormData;
	responseType?:
		| "arraybuffer"
		| "blob"
		| "document"
		| "json"
		| "text"
		| "stream";
	signal?: AbortSignal;
	headers?: [string, string][] | Record<string, string>;
	credentials?: RequestCredentials;
	/**
	 * Per-call SDK context. Injected by `createVayoPartnerClient()` — not part
	 * of the kubb-generated function signatures, partners never set this
	 * directly.
	 */
	context?: ClientContext;
};

export type ResponseConfig<TData = unknown> = {
	data: TData;
	status: number;
	statusText: string;
	headers: Headers;
};

export type ResponseErrorConfig<TError = unknown> = TError;

function buildUrl(baseURL: string, url?: string, params?: unknown): string {
	const fullUrl = [baseURL, url].filter(Boolean).join("");
	if (!params || typeof params !== "object") return fullUrl;
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(
		params as Record<string, unknown>,
	)) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) {
			// Comma-join arrays — matches the spec's `?mints=a,b,c` style.
			searchParams.append(key, value.join(","));
		} else {
			searchParams.append(key, String(value));
		}
	}
	const queryString = searchParams.toString();
	return queryString ? `${fullUrl}?${queryString}` : fullUrl;
}

function normalizeHeaders(
	headers?: [string, string][] | Record<string, string>,
): Record<string, string> {
	if (!headers) return {};
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return { ...headers };
}

function defaultIdempotencyKey(): string {
	// Browsers and Node 19+ expose `crypto.randomUUID`. Fall back to a
	// pseudo-random value for older Node — partners can override via
	// `generateIdempotencyKey` in `createVayoPartnerClient` options.
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function client<
	TResponseData,
	_TError = unknown,
	TRequestData = unknown,
>(config: RequestConfig<TRequestData>): Promise<ResponseConfig<TResponseData>> {
	const ctx = config.context;
	if (!ctx) {
		throw new Error(
			"[vayo/core-sdk] internal: RequestConfig.context is missing. " +
				"Generated clients must be invoked through createVayoPartnerClient().",
		);
	}

	const baseURL = config.baseURL ?? ctx.baseUrl;
	const url = buildUrl(baseURL, config.url, config.params);
	const headers = normalizeHeaders(config.headers);
	const method = (config.method ?? "GET").toUpperCase();

	// Always inject the partner API key.
	headers["x-api-key"] = ctx.apiKey;

	// Idempotency-Key — required by the partner v1 mutating routes. Honor an
	// explicit caller-provided value (so retries can replay), otherwise auto-
	// generate one for mutating methods only (reads never need it).
	if (MUTATING_METHODS.has(method) && !headers["Idempotency-Key"]) {
		headers["Idempotency-Key"] =
			ctx.idempotencyKey ??
			(ctx.generateIdempotencyKey ?? defaultIdempotencyKey)();
	}

	if (!headers["Content-Type"] && !(config.data instanceof FormData)) {
		headers["Content-Type"] = "application/json";
	}

	let body: BodyInit | undefined;
	if (config.data instanceof FormData) {
		body = config.data;
	} else if (config.data !== undefined) {
		body = JSON.stringify(config.data);
	}

	const fetchImpl = ctx.fetch ?? fetch;
	const response = await fetchImpl(url, {
		method,
		headers,
		body,
		signal: config.signal,
		// Default to 'omit' (not 'include') because partners never share cookies
		// cross-origin with Vayo. The webapp uses 'include' for first-party flows
		// — partners use header auth.
		credentials: config.credentials ?? "omit",
	});

	let data: unknown;
	if (NO_BODY_STATUSES.has(response.status)) {
		data = {};
	} else {
		data = await response.json().catch(() => ({}));
	}

	if (!response.ok) {
		throw VayoApiError.fromBody(
			response.status,
			response.statusText,
			data as VayoErrorBody | null,
		);
	}

	return {
		data: data as TResponseData,
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	};
}

export type Client = typeof client;

export default client;
