// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Layer 2 — `client.modeS.redeem()` — opinionated Mode S orchestrator.
 *
 * Runs the full build → verify → sign → submit flow that every Mode S
 * partner needs. Built so the only piece partners must implement themselves
 * is the `signTransaction` callback (typically backed by `@privy-io/node`,
 * Squads, an HSM, or any other Solana signer).
 *
 * Sequence:
 *   1. POST /v1/lending-operations/redeem-allocated/build
 *   2. (Optional) Verify embedded fee recipients match the partner's expectation
 *   3. Invoke `signTransaction` with the partially-signed wire bytes (base64)
 *   4. POST /v1/lending-operations/redeem-allocated/submit
 *   5. (Optional) On /submit failure, fall back to broadcasting via the
 *      partner's own RPC URL — the witness signature is still load-bearing
 *      so the cryptographic guarantee holds either way.
 *
 * The orchestrator is intentionally callback-driven (not coupled to a
 * specific signer) so the same code path works for Privy users, Squads
 * users, partners with custom HSMs, and future signers.
 */

import type { CallOptions } from "../client";
import {
	assertFeeRecipientsMatch,
	type ExpectedFeeRecipients,
} from "./verify-fee-recipients";

/**
 * The signing callback partners provide. Receives the base64-encoded
 * partially-signed transaction (with Vayo's witness signature already
 * attached) and must return the base64-encoded fully-signed transaction
 * with the user-wallet authority signature added.
 *
 * Implementations typically:
 *   1. Decode the base64 → wire bytes
 *   2. Hand to a signer SDK (Privy, Squads, etc.)
 *   3. Re-encode the resulting fully-signed transaction → base64
 *
 * For Privy users, see `@vayolabs/core-sdk/mode-s/privy` which exports a
 * pre-built `createPrivySigner()` adapter.
 */
export type SignTransactionCallback = (
	serializedTxBase64: string,
) => Promise<string>;

/** Lazily-loaded fetch — for the optional direct-RPC fallback. */
type FetchLike = typeof fetch;

export interface RedeemModeSInput {
	/** Privy DID of the user (in the partner's Privy app). */
	privyDid: string;
	/** Single market — multi-market not supported in MVP because each redeem is its own tx. */
	marketAddress: string;
	/** Token mint (e.g. USDC). */
	tokenMint: string;
	/**
	 * Token base units. Pass `U64_MAX` (from `@vayolabs/core-sdk`) for a full
	 * redeem. Defaults to `U64_MAX` if omitted.
	 */
	amount?: string;
	/** Optional reserve override (for markets with multiple reserves of the same mint). */
	reserveAddress?: string;

	/** Partner-supplied signer. See `SignTransactionCallback` for the contract. */
	signTransaction: SignTransactionCallback;

	/**
	 * Optional Defense-3 mirror. When provided, the orchestrator verifies the
	 * embedded fee transfers match these addresses BEFORE invoking
	 * `signTransaction`. Strongly recommended.
	 */
	expectedFeeRecipients?: ExpectedFeeRecipients;

	/**
	 * Optional fallback. When `/submit` fails (e.g. Vayo transient error), the
	 * orchestrator broadcasts the signed tx directly to this RPC URL via
	 * `sendTransaction`. The reconciliation CRON later picks up the on-chain
	 * signature and writes the partner_fee_payouts row.
	 */
	fallbackRpcUrl?: string;

	/** Caller-provided idempotency key. Reused across both /build and /submit. */
	idempotencyKey?: string;

	/** AbortSignal — propagated to both /build and /submit. */
	signal?: AbortSignal;
}

export interface RedeemModeSResult {
	/** Confirmed (or freshly-submitted) transaction signature. */
	signature: string;
	/** The cached pendingRedeemId from /build (useful for log correlation). */
	pendingRedeemId: string;
	/** The fee recipients that were embedded by Vayo and signed off-chain. */
	expectedFeeRecipients: ReadonlyArray<{ address: string; amount: string }>;
	/** Cosigners that were attached at build time. */
	cosignersAttached: ReadonlyArray<"witness" | "kora">;
	/** True when the result came from the direct-RPC fallback path. */
	viaFallbackRpc: boolean;
}

/**
 * The shape of the build/submit functions the orchestrator depends on.
 * Defining it as an interface (not just `typeof client.modeS.buildRedeem`)
 * keeps the orchestrator unit-testable with mocked dependencies.
 */
export interface ModeSDependencies {
	buildRedeem(args: {
		body: {
			privyDid: string;
			marketAddress: string;
			tokenMint: string;
			amount: string;
			reserveAddress?: string;
		};
		idempotencyKey?: string;
		signal?: AbortSignal;
	}): Promise<{
		serializedTx: string;
		pendingRedeemId: string;
		expectedFeeRecipients: Array<{ address: string; amount: string }>;
		cosignersAttached: Array<"witness" | "kora">;
		expiresAt: string;
	}>;
	submitSignedRedeem(args: {
		body: { pendingRedeemId: string; serializedTx: string };
		idempotencyKey?: string;
		signal?: AbortSignal;
	}): Promise<{ signature: string; confirmed: boolean }>;
}

export interface ModeSHelper {
	/** Run the full Mode S redeem flow. See `RedeemModeSInput` for options. */
	redeem(
		input: RedeemModeSInput,
		opts?: CallOptions,
	): Promise<RedeemModeSResult>;
}

const U64_MAX = "18446744073709551615";

/**
 * Internal factory used by `createVayoPartnerClient()`. Partners shouldn't
 * call this directly — they get a pre-wired `client.modeS.redeem` from the
 * top-level client.
 */
export function createModeSHelper(deps: ModeSDependencies): ModeSHelper {
	return {
		async redeem(input) {
			// Step 1 — POST /build
			const built = await deps.buildRedeem({
				body: {
					privyDid: input.privyDid,
					marketAddress: input.marketAddress,
					tokenMint: input.tokenMint,
					amount: input.amount ?? U64_MAX,
					reserveAddress: input.reserveAddress,
				},
				idempotencyKey: input.idempotencyKey,
				signal: input.signal,
			});

			// Step 2 — Defense-3 mirror (optional)
			if (input.expectedFeeRecipients) {
				assertFeeRecipientsMatch(
					built.expectedFeeRecipients,
					input.expectedFeeRecipients,
				);
			}

			// Step 3 — partner-supplied signing callback
			const signedTx = await input.signTransaction(built.serializedTx);
			if (typeof signedTx !== "string" || signedTx.length === 0) {
				throw new TypeError(
					"[vayo/core-sdk] signTransaction must return a non-empty base64 string",
				);
			}

			// Step 4 — POST /submit
			try {
				const submitted = await deps.submitSignedRedeem({
					body: {
						pendingRedeemId: built.pendingRedeemId,
						serializedTx: signedTx,
					},
					idempotencyKey: input.idempotencyKey,
					signal: input.signal,
				});
				return {
					signature: submitted.signature,
					pendingRedeemId: built.pendingRedeemId,
					expectedFeeRecipients: built.expectedFeeRecipients,
					cosignersAttached: built.cosignersAttached,
					viaFallbackRpc: false,
				};
			} catch (err) {
				// Step 5 — fallback to direct RPC if configured. The witness signature
				// is still binding so the on-chain transfers are safe; the only thing
				// we lose by skipping /submit is the fail-fast 2b verification.
				if (!input.fallbackRpcUrl) throw err;
				const signature = await broadcastViaRpc(
					input.fallbackRpcUrl,
					signedTx,
					input.signal,
				);
				return {
					signature,
					pendingRedeemId: built.pendingRedeemId,
					expectedFeeRecipients: built.expectedFeeRecipients,
					cosignersAttached: built.cosignersAttached,
					viaFallbackRpc: true,
				};
			}
		},
	};
}

/**
 * Bare-bones Solana JSON-RPC `sendTransaction` call. We deliberately do NOT
 * import `@solana/kit` here — that would force the dependency on every Mode S
 * partner. The fallback path is rarely hit and uses the JSON-RPC wire format
 * directly so it works in any runtime with `fetch`.
 */
async function broadcastViaRpc(
	rpcUrl: string,
	serializedTxBase64: string,
	signal?: AbortSignal,
): Promise<string> {
	const fetchImpl: FetchLike = fetch;
	const res = await fetchImpl(rpcUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "sendTransaction",
			params: [
				serializedTxBase64,
				{ encoding: "base64", skipPreflight: false },
			],
		}),
		signal,
	});
	if (!res.ok) {
		throw new Error(
			`[vayo/core-sdk] direct RPC fallback failed: ${res.status} ${res.statusText}`,
		);
	}
	const body = (await res.json()) as {
		result?: string;
		error?: { code: number; message: string };
	};
	if (body.error) {
		throw new Error(
			`[vayo/core-sdk] direct RPC sendTransaction error: ${body.error.message}`,
		);
	}
	if (!body.result) {
		throw new Error("[vayo/core-sdk] direct RPC returned empty result");
	}
	return body.result;
}
