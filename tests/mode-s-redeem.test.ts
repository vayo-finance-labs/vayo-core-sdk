// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Mode S orchestrator — verifies the build → verify → sign → submit flow with
 * stubbed dependencies (no real network, no real Privy, no real Solana RPC).
 */

import { describe, expect, it } from "bun:test";

import {
	createModeSHelper,
	type ModeSDependencies,
} from "../src/mode-s/redeem";

const PARTNER = "PARTNERPAYOUTwallet11111111111111111111111111";
const TREASURY = "VAYOTREASURYwallet1111111111111111111111111";

function makeBuildResponse(
	overrides: Partial<{ pendingRedeemId: string; serializedTx: string }> = {},
) {
	return {
		serializedTx: overrides.serializedTx ?? "BUILD_BYTES_BASE64",
		pendingRedeemId: overrides.pendingRedeemId ?? "pending-uuid-1",
		expectedFeeRecipients: [
			{ address: PARTNER, amount: "500" },
			{ address: TREASURY, amount: "500" },
		],
		cosignersAttached: ["witness"] as Array<"witness" | "kora">,
		expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
	};
}

interface CallLog {
	build: number;
	submit: number;
	signedWith: string[];
	submittedSerializedTx: string[];
}

function makeDeps(opts: { submitFails?: boolean }): {
	deps: ModeSDependencies;
	log: CallLog;
} {
	const log: CallLog = {
		build: 0,
		submit: 0,
		signedWith: [],
		submittedSerializedTx: [],
	};
	const deps: ModeSDependencies = {
		async buildRedeem(_args) {
			log.build++;
			return makeBuildResponse();
		},
		async submitSignedRedeem(args) {
			log.submit++;
			log.submittedSerializedTx.push(args.body.serializedTx);
			if (opts.submitFails) {
				throw new Error("simulated /submit failure");
			}
			return { signature: "CONFIRMED_SIG_BASE58", confirmed: true };
		},
	};
	return { deps, log };
}

describe("createModeSHelper.redeem", () => {
	it("runs build → verify → sign → submit and returns the signature", async () => {
		const { deps, log } = makeDeps({});
		const helper = createModeSHelper(deps);

		const result = await helper.redeem({
			privyDid: "did:privy:cm-test",
			marketAddress: "H6rMUYR8XSUxsZWtpsAJSqQ4rk2pGMLFp4xJqFE9YjV1",
			tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
			signTransaction: async (txB64) => {
				log.signedWith.push(txB64);
				return `SIGNED:${txB64}`;
			},
			expectedFeeRecipients: {
				partnerPayoutAddress: PARTNER,
				vayoTreasuryAddress: TREASURY,
			},
		});

		expect(log.build).toBe(1);
		expect(log.submit).toBe(1);
		expect(log.signedWith).toEqual(["BUILD_BYTES_BASE64"]);
		expect(log.submittedSerializedTx).toEqual(["SIGNED:BUILD_BYTES_BASE64"]);
		expect(result.signature).toBe("CONFIRMED_SIG_BASE58");
		expect(result.pendingRedeemId).toBe("pending-uuid-1");
		expect(result.viaFallbackRpc).toBe(false);
	});

	it("aborts before signing when expectedFeeRecipients drift", async () => {
		const { deps, log } = makeDeps({});
		const helper = createModeSHelper(deps);

		let signCalled = 0;
		let captured: unknown;
		try {
			await helper.redeem({
				privyDid: "did:privy:cm-test",
				marketAddress: "H6...",
				tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				signTransaction: async () => {
					signCalled++;
					return "SIGNED";
				},
				expectedFeeRecipients: {
					partnerPayoutAddress: "WRONG_PARTNER_ADDRESS",
					vayoTreasuryAddress: TREASURY,
				},
			});
		} catch (err) {
			captured = err;
		}

		expect(captured).toBeInstanceOf(RangeError);
		expect(log.build).toBe(1);
		expect(signCalled).toBe(0);
		expect(log.submit).toBe(0);
	});

	it("rejects an empty signTransaction return value", async () => {
		const { deps } = makeDeps({});
		const helper = createModeSHelper(deps);
		let captured: unknown;
		try {
			await helper.redeem({
				privyDid: "did:privy:cm-test",
				marketAddress: "H6...",
				tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				signTransaction: async () => "",
			});
		} catch (err) {
			captured = err;
		}
		expect(captured).toBeInstanceOf(TypeError);
	});

	it("rethrows the /submit error when no fallbackRpcUrl is provided", async () => {
		const { deps } = makeDeps({ submitFails: true });
		const helper = createModeSHelper(deps);
		let captured: unknown;
		try {
			await helper.redeem({
				privyDid: "did:privy:cm-test",
				marketAddress: "H6...",
				tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				signTransaction: async () => "SIGNED_OK",
			});
		} catch (err) {
			captured = err;
		}
		expect((captured as Error).message).toContain("simulated /submit failure");
	});

	it("falls back to direct RPC when /submit fails and fallbackRpcUrl is set", async () => {
		const { deps } = makeDeps({ submitFails: true });
		const helper = createModeSHelper(deps);

		const originalFetch = globalThis.fetch;
		let rpcRequest: { url: string; body: unknown } | null = null;
		globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
			rpcRequest = {
				url: url.toString(),
				body: init?.body ? JSON.parse(init.body as string) : null,
			};
			return new Response(
				JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					result: "FALLBACK_SIG_BASE58",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		try {
			const result = await helper.redeem({
				privyDid: "did:privy:cm-test",
				marketAddress: "H6...",
				tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
				signTransaction: async () => "SIGNED_FALLBACK",
				fallbackRpcUrl: "https://api.mainnet-beta.solana.com",
			});

			expect(result.signature).toBe("FALLBACK_SIG_BASE58");
			expect(result.viaFallbackRpc).toBe(true);
			const captured = rpcRequest as unknown as {
				url: string;
				body: { method: string; params: unknown[] };
			} | null;
			expect(captured).not.toBeNull();
			expect(captured?.url).toBe("https://api.mainnet-beta.solana.com");
			expect(captured?.body.method).toBe("sendTransaction");
			expect(captured?.body.params[0]).toBe("SIGNED_FALLBACK");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
