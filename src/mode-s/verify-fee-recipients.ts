// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Defense-3 mirror — local verification of the fee recipients embedded in
 * the partially-signed transaction returned by `/build`.
 *
 * Catches the (unlikely) case where Vayo's fee math drifted vs. what the
 * partner is expecting in their dashboard, before the partner wastes a
 * Privy/HSM signing call. The cryptographic safety net (witness signature
 * binding the message hash) is still the load-bearing check — this is just
 * a fast-fail surface that gives partners a clear error message.
 */

export interface ExpectedFeeRecipients {
	/** Partner's payout wallet (USDC ATA owner). */
	partnerPayoutAddress: string;
	/** Vayo's treasury wallet. */
	vayoTreasuryAddress: string;
}

export interface ObservedFeeRecipient {
	address: string;
	amount: string;
}

/**
 * Asserts that both the partner payout address AND Vayo treasury address
 * appear among the fee transfers Vayo embedded. Throws a `RangeError` with
 * a clear message listing the missing addresses if either is absent.
 */
export function assertFeeRecipientsMatch(
	observed: readonly ObservedFeeRecipient[],
	expected: ExpectedFeeRecipients,
): void {
	const observedAddresses = new Set(observed.map((r) => r.address));
	const missing: string[] = [];
	if (!observedAddresses.has(expected.partnerPayoutAddress)) {
		missing.push(`partner payout (${expected.partnerPayoutAddress})`);
	}
	if (!observedAddresses.has(expected.vayoTreasuryAddress)) {
		missing.push(`Vayo treasury (${expected.vayoTreasuryAddress})`);
	}
	if (missing.length > 0) {
		throw new RangeError(
			`[vayo/core-sdk] /build response is missing expected fee recipients: ${missing.join(
				", ",
			)}. Refusing to sign — contact partners@vayo.finance.`,
		);
	}
}
