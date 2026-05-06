/* biome-ignore-all lint/suspicious/noConsole: example script — console output is the intended UX */

/**
 * Vayo Finance Partner SDK — Mode S redeem example
 *
 * Demonstrates the full Mode S `/build → verify → sign → /submit` flow on
 * top of `@vayolabs/core-sdk`. This file used to be ~250 lines of hand-rolled
 * fetch + Privy plumbing — now it's a single `client.modeS.redeem()` call.
 *
 * Run:
 *   bun run docs/core-sdk/examples/mode-s-redeem.ts
 *
 * Required env:
 *   VAYO_API_KEY                       — issued via POST /admin/partners/:id/api-keys
 *   PRIVY_APP_ID, PRIVY_APP_SECRET     — partner's own Privy app
 *   PRIVY_AUTHORIZATION_PRIVATE_KEY    — wallet authorization key
 *   USER_PRIVY_DID                     — the user being redeemed for
 *   USER_WALLET_ID                     — the user's Privy walletId
 *   PARTNER_PAYOUT_ADDRESS             — your partner payout wallet
 *   VAYO_TREASURY_ADDRESS              — Vayo's treasury wallet
 *
 * Optional env:
 *   VAYO_BASE_URL                      — default: https://api.vayo.finance
 *   FALLBACK_RPC_URL                   — direct-RPC fallback if /submit fails
 *   MARKET_ADDRESS                     — Kamino market to redeem from
 */

import { PrivyClient } from "@privy-io/node";
import {
	createVayoPartnerClient,
	U64_MAX,
	USDC_MINT,
	VayoApiError,
} from "@vayolabs/core-sdk";
import { createPrivySigner } from "@vayolabs/core-sdk/mode-s/privy";

function required(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`Missing required env var: ${key}`);
	return value;
}

async function main() {
	const vayo = createVayoPartnerClient({
		baseUrl: process.env.VAYO_BASE_URL ?? "https://api.vayo.finance",
		apiKey: required("VAYO_API_KEY"),
	});

	// Build a Privy signer for the user's wallet. The SDK only depends on
	// PrivyClient as a TYPE, so the partner constructs it themselves and
	// passes it in. Non-Privy partners would skip this and supply their own
	// `signTransaction: async (txB64) => Promise<string>` callback instead.
	const privy = new PrivyClient({
		appId: required("PRIVY_APP_ID"),
		appSecret: required("PRIVY_APP_SECRET"),
	});
	const sign = createPrivySigner(privy, {
		walletId: required("USER_WALLET_ID"),
		authorizationPrivateKeys: [required("PRIVY_AUTHORIZATION_PRIVATE_KEY")],
	});

	try {
		const result = await vayo.modeS.redeem({
			privyDid: required("USER_PRIVY_DID"),
			marketAddress:
				process.env.MARKET_ADDRESS ??
				"H6rMUYR8XSUxsZWtpsAJSqQ4rk2pGMLFp4xJqFE9YjV1",
			tokenMint: USDC_MINT,
			amount: U64_MAX, // full redeem
			signTransaction: sign,
			expectedFeeRecipients: {
				partnerPayoutAddress: required("PARTNER_PAYOUT_ADDRESS"),
				vayoTreasuryAddress: required("VAYO_TREASURY_ADDRESS"),
			},
			// Optional: if /submit fails (e.g. transient Vayo error), broadcast
			// directly to your own RPC. The witness signature still binds the
			// fee instructions on-chain so this path is just as safe.
			fallbackRpcUrl: process.env.FALLBACK_RPC_URL,
		});

		console.log("[vayo] redeem confirmed", {
			signature: result.signature,
			pendingRedeemId: result.pendingRedeemId,
			feeRecipients: result.expectedFeeRecipients,
			cosignersAttached: result.cosignersAttached,
			viaFallbackRpc: result.viaFallbackRpc,
		});
	} catch (err) {
		if (err instanceof VayoApiError) {
			console.error(
				`[vayo] API error ${err.statusCode}: ${err.message}` +
					(err.correlationId ? ` (correlationId=${err.correlationId})` : ""),
			);
		} else if (
			err instanceof RangeError &&
			err.message.includes("fee recipients")
		) {
			// Defense-3 mirror tripped — Vayo's fee math drifted vs. our local
			// expectation. The orchestrator aborted before signing.
			console.error("[vayo] fee recipient drift detected:", err.message);
		} else {
			console.error("[vayo] unexpected error:", err);
		}
		process.exit(1);
	}
}

main();
