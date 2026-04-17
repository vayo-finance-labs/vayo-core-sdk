// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Defense-3 mirror — local verification of the fee recipients embedded in
 * the partially-signed transaction returned by `/build`.
 */

import { describe, expect, it } from "bun:test";

import { assertFeeRecipientsMatch } from "../src/mode-s/verify-fee-recipients";

const PARTNER = "PARTNERPAYOUTwallet11111111111111111111111111";
const TREASURY = "VAYOTREASURYwallet1111111111111111111111111";
const ATTACKER = "ATTACKERwallet1111111111111111111111111111111";

describe("assertFeeRecipientsMatch", () => {
	it("passes when both partner and treasury are present", () => {
		expect(() =>
			assertFeeRecipientsMatch(
				[
					{ address: PARTNER, amount: "100" },
					{ address: TREASURY, amount: "100" },
				],
				{ partnerPayoutAddress: PARTNER, vayoTreasuryAddress: TREASURY },
			),
		).not.toThrow();
	});

	it("throws RangeError when the partner payout is missing", () => {
		expect(() =>
			assertFeeRecipientsMatch([{ address: TREASURY, amount: "200" }], {
				partnerPayoutAddress: PARTNER,
				vayoTreasuryAddress: TREASURY,
			}),
		).toThrow(RangeError);
		expect(() =>
			assertFeeRecipientsMatch([{ address: TREASURY, amount: "200" }], {
				partnerPayoutAddress: PARTNER,
				vayoTreasuryAddress: TREASURY,
			}),
		).toThrow(/partner payout/);
	});

	it("throws when the Vayo treasury is missing", () => {
		expect(() =>
			assertFeeRecipientsMatch([{ address: PARTNER, amount: "200" }], {
				partnerPayoutAddress: PARTNER,
				vayoTreasuryAddress: TREASURY,
			}),
		).toThrow(/Vayo treasury/);
	});

	it("throws when both are missing (single error listing both)", () => {
		let captured: unknown;
		try {
			assertFeeRecipientsMatch([{ address: ATTACKER, amount: "500" }], {
				partnerPayoutAddress: PARTNER,
				vayoTreasuryAddress: TREASURY,
			});
		} catch (err) {
			captured = err;
		}
		expect(captured).toBeInstanceOf(RangeError);
		const msg = (captured as Error).message;
		expect(msg).toContain("partner payout");
		expect(msg).toContain("Vayo treasury");
	});

	it("ignores extra recipients beyond the required two", () => {
		expect(() =>
			assertFeeRecipientsMatch(
				[
					{ address: PARTNER, amount: "100" },
					{ address: TREASURY, amount: "100" },
					{ address: ATTACKER, amount: "0" }, // attacker injection — still passes the local check, the witness signature will reject on-chain
				],
				{ partnerPayoutAddress: PARTNER, vayoTreasuryAddress: TREASURY },
			),
		).not.toThrow();
	});
});
