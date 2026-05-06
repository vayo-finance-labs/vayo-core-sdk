// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Optional Privy signer adapter — `@vayolabs/core-sdk/mode-s/privy`.
 *
 * Bridges `@privy-io/node` to the SDK's `SignTransactionCallback` so Privy
 * partners can plug their wallet into `client.modeS.redeem()` in one line:
 *
 * ```ts
 * import { createVayoPartnerClient, U64_MAX } from '@vayolabs/core-sdk'
 * import { createPrivySigner } from '@vayolabs/core-sdk/mode-s/privy'
 * import { PrivyClient } from '@privy-io/node'
 *
 * const privy = new PrivyClient({ appId: '...', appSecret: '...' })
 * const sign = createPrivySigner(privy, { walletId: 'cl...' })
 *
 * const result = await client.modeS.redeem({
 *   privyDid: 'did:privy:...',
 *   marketAddress: '...',
 *   tokenMint: USDC_MINT,
 *   amount: U64_MAX,
 *   signTransaction: sign,
 *   expectedFeeRecipients: { partnerPayoutAddress, vayoTreasuryAddress },
 * })
 * ```
 *
 * **This is the only file in the SDK that imports `@privy-io/node`.** The
 * package is declared as an OPTIONAL peer dep — non-Privy partners that
 * never import this sub-export pay zero install cost. Bundlers/tsup mark
 * `@privy-io/node` as external so the main SDK bundle stays lean.
 *
 * Authorization keys: when the partner's wallet has a delegation/policy
 * requiring signature authorization (the typical Vayo Mode S setup), pass
 * `authorizationPrivateKeys` to construct an authorization context. The
 * adapter forwards it to `privy.wallets().solana().signTransaction()`.
 */

import type { PrivyClient } from "@privy-io/node";

import type { SignTransactionCallback } from "./redeem";

export interface CreatePrivySignerOptions {
	/**
	 * Privy walletId of the user's Solana wallet (the value Privy returns at
	 * wallet creation, e.g. `cl0abc...`).
	 */
	walletId: string;
	/**
	 * Optional authorization private keys. Pass when the wallet's policy
	 * requires authorization signatures (the standard Vayo Mode S setup).
	 * Each key is a Privy-formatted authorization key string —
	 * `wallet-auth:...` or PEM, depending on how the partner generated it.
	 */
	authorizationPrivateKeys?: readonly string[];
}

/**
 * Builds a `SignTransactionCallback` backed by Privy's
 * `wallets().solana().signTransaction()` RPC. Pass the returned function
 * directly as the `signTransaction` field of `client.modeS.redeem()`.
 */
export function createPrivySigner(
	privy: PrivyClient,
	options: CreatePrivySignerOptions,
): SignTransactionCallback {
	if (!options.walletId) {
		throw new Error(
			"[vayo/core-sdk/mode-s/privy] createPrivySigner: walletId is required",
		);
	}

	const authorizationContext = options.authorizationPrivateKeys?.length
		? {
				authorization_private_keys: [...options.authorizationPrivateKeys],
			}
		: undefined;

	return async (serializedTxBase64) => {
		const response = await privy
			.wallets()
			.solana()
			.signTransaction(options.walletId, {
				transaction: serializedTxBase64,
				encoding: "base64",
				...(authorizationContext
					? { authorization_context: authorizationContext }
					: {}),
			} as Parameters<
				ReturnType<
					ReturnType<PrivyClient["wallets"]>["solana"]
				>["signTransaction"]
			>[1]);

		if (!response?.signed_transaction) {
			throw new Error(
				"[vayo/core-sdk/mode-s/privy] Privy returned an empty signed_transaction",
			);
		}
		return response.signed_transaction;
	};
}
