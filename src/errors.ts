// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Structured error thrown by the SDK on any non-2xx response. Partners can
 * `catch (err) { if (err instanceof VayoApiError) ... }` to discriminate from
 * arbitrary network/runtime failures.
 *
 * Mirrors the error envelope returned by the Vayo API's central
 * `errorHandler` middleware: `{ statusCode, message, code?, correlationId? }`.
 */

export interface VayoErrorBody {
	statusCode?: number;
	message?: string;
	code?: string | null;
	correlationId?: string | null;
}

export class VayoApiError extends Error {
	override readonly name = "VayoApiError";

	constructor(
		/** HTTP status code from the response. */
		readonly statusCode: number,
		/** Server-provided message, or a fallback HTTP status text. */
		message: string,
		/** Server-provided error code (e.g. `INVALID_API_KEY`), if present. */
		readonly code: string | null = null,
		/** Server-side correlation id for grepping logs. */
		readonly correlationId: string | null = null,
	) {
		super(message);
		// Ensure `instanceof VayoApiError` works after transpilation.
		Object.setPrototypeOf(this, VayoApiError.prototype);
	}

	/**
	 * Factory used by the internal HTTP wrapper. Tolerant of malformed bodies —
	 * if the server returns HTML or empty content, we still construct a useful
	 * error from the status alone.
	 */
	static fromBody(
		statusCode: number,
		statusText: string,
		body: VayoErrorBody | null,
	): VayoApiError {
		// Treat empty strings as missing — `??` only handles null/undefined.
		const message =
			(body?.message && body.message.length > 0 ? body.message : null) ??
			(statusText && statusText.length > 0 ? statusText : null) ??
			`HTTP ${statusCode}`;
		return new VayoApiError(
			statusCode,
			message,
			body?.code ?? null,
			body?.correlationId ?? null,
		);
	}
}
