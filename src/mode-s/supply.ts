// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Layer 2 — `client.modeS.supply()` — Mode S supply orchestrator.
 *
 * Mirrors the Mode S redeem flow for supplies:
 *   1. POST /v1/lending-operations/supply-allocated/build
 *   2. Invoke partner's `signTransaction` with the partially-signed tx
 *   3. POST /v1/lending-operations/supply-allocated/submit
 */

import type { CallOptions } from "../client";
import type { SignTransactionCallback } from "./redeem";

export interface BuildSupplyResponse {
	serializedTx: string;
	pendingSupplyId: string;
	cosignersAttached: Array<"witness" | "kora">;
	expiresAt: string;
}

export interface SubmitSignedSupplyResponse {
	signature: string;
	confirmed: boolean;
}

export interface SupplyModeSInput {
	privyDid: string;
	marketAddress: string;
	tokenMint: string;
	amount: string;
	reserveAddress?: string;
	signTransaction: SignTransactionCallback;
	idempotencyKey?: string;
	signal?: AbortSignal;
}

export interface SupplyModeSResult {
	signature: string;
	pendingSupplyId: string;
	cosignersAttached: ReadonlyArray<"witness" | "kora">;
}

export interface ModeSSupplyDependencies {
	buildSupply(args: {
		body: {
			privyDid: string;
			marketAddress: string;
			tokenMint: string;
			amount: string;
			reserveAddress?: string;
		};
		idempotencyKey?: string;
		signal?: AbortSignal;
	}): Promise<BuildSupplyResponse>;
	submitSignedSupply(args: {
		body: { pendingSupplyId: string; serializedTx: string };
		idempotencyKey?: string;
		signal?: AbortSignal;
	}): Promise<SubmitSignedSupplyResponse>;
}

export interface ModeSSupplyHelper {
	supply(
		input: SupplyModeSInput,
		opts?: CallOptions,
	): Promise<SupplyModeSResult>;
}

export function createModeSSupplyHelper(
	deps: ModeSSupplyDependencies,
): ModeSSupplyHelper {
	return {
		async supply(input) {
			const built = await deps.buildSupply({
				body: {
					privyDid: input.privyDid,
					marketAddress: input.marketAddress,
					tokenMint: input.tokenMint,
					amount: input.amount,
					reserveAddress: input.reserveAddress,
				},
				idempotencyKey: input.idempotencyKey,
				signal: input.signal,
			});

			const signedTx = await input.signTransaction(built.serializedTx);
			if (typeof signedTx !== "string" || signedTx.length === 0) {
				throw new TypeError(
					"[vayo/core-sdk] signTransaction must return a non-empty base64 string",
				);
			}

			const submitted = await deps.submitSignedSupply({
				body: {
					pendingSupplyId: built.pendingSupplyId,
					serializedTx: signedTx,
				},
				idempotencyKey: input.idempotencyKey,
				signal: input.signal,
			});

			return {
				signature: submitted.signature,
				pendingSupplyId: built.pendingSupplyId,
				cosignersAttached: built.cosignersAttached,
			};
		},
	};
}
