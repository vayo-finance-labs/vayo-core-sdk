// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: BUSL-1.1

/**
 * Layer 2 — `client.wallet.withdraw()` — async memo-challenge orchestrator.
 *
 * Withdrawals are gated by the user's embedded-wallet 2FA memo. The
 * orchestrator runs:
 *   1. POST /v1/wallet/withdraw/prepare
 *   2. Invoke partner's `signTransaction` with the unsigned memo skeleton
 *   3. POST /v1/wallet/withdraw/submit
 *
 * Vayo never broadcasts the signed memo — it's a proof-of-possession only.
 * The actual USDC transfer is broadcast by Vayo after verifying the memo.
 */

import type { CallOptions } from "../client";
import type { SignTransactionCallback } from "../mode-s/redeem";

export interface PrepareWithdrawalResponse {
	pendingWithdrawalId: string;
	memoChallenge: string;
	serializedMemoTransaction: string;
	userWalletAddress: string;
	expiresAt: string;
}

export interface SubmitWithdrawalResponse {
	signature: string;
	transactionId: string;
}

export interface WithdrawInput {
	privyDid: string;
	destinationAddress: string;
	amount: string;
	exactRecipientAmount?: boolean;
	signTransaction: SignTransactionCallback;
	idempotencyKey?: string;
	signal?: AbortSignal;
}

export interface WithdrawResult {
	signature: string;
	transactionId: string;
	pendingWithdrawalId: string;
	memoChallenge: string;
}

export interface WalletDependencies {
	prepareWithdrawal(args: {
		body: {
			privyDid: string;
			destinationAddress: string;
			amount: string;
			exactRecipientAmount?: boolean;
		};
		idempotencyKey?: string;
		signal?: AbortSignal;
	}): Promise<PrepareWithdrawalResponse>;
	submitWithdrawal(args: {
		body: { pendingWithdrawalId: string; signedIntentTransaction: string };
		idempotencyKey?: string;
		signal?: AbortSignal;
	}): Promise<SubmitWithdrawalResponse>;
}

export interface WalletHelper {
	withdraw(input: WithdrawInput, opts?: CallOptions): Promise<WithdrawResult>;
}

export function createWalletHelper(deps: WalletDependencies): WalletHelper {
	return {
		async withdraw(input) {
			const prepared = await deps.prepareWithdrawal({
				body: {
					privyDid: input.privyDid,
					destinationAddress: input.destinationAddress,
					amount: input.amount,
					exactRecipientAmount: input.exactRecipientAmount,
				},
				idempotencyKey: input.idempotencyKey,
				signal: input.signal,
			});

			const signedMemoTx = await input.signTransaction(
				prepared.serializedMemoTransaction,
			);
			if (typeof signedMemoTx !== "string" || signedMemoTx.length === 0) {
				throw new TypeError(
					"[vayo/core-sdk] signTransaction must return a non-empty base64 string",
				);
			}

			const submitted = await deps.submitWithdrawal({
				body: {
					pendingWithdrawalId: prepared.pendingWithdrawalId,
					signedIntentTransaction: signedMemoTx,
				},
				idempotencyKey: input.idempotencyKey,
				signal: input.signal,
			});

			return {
				signature: submitted.signature,
				transactionId: submitted.transactionId,
				pendingWithdrawalId: prepared.pendingWithdrawalId,
				memoChallenge: prepared.memoChallenge,
			};
		},
	};
}
