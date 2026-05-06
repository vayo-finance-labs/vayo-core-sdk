// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Response shapes for `client.positions.read()`. Hand-rolled to mirror
 * `apps/api/src/core/domain/entities/lending-reserve.ts` because Elysia's
 * exported swagger types responses as `any`.
 */

export interface PositionRewardEntry {
	rewardMint: string;
	rewardSymbol?: string;
	amount: string;
	usdValue: number;
}

export interface UserPosition {
	marketAddress: string;
	marketName: string;
	reserveAddress?: string;
	reserveName: string;
	mint?: string;
	decimals: number;
	exchangeRate: number;
	price: number;
	supplyAPY: number;
	suppliedFormatted: string;
	suppliedUsd: number;
	rewards: PositionRewardEntry[];
	/** Net USD deposited into this specific reserve. */
	netDepositedUsd?: number;
	/** Real accumulated yield: `suppliedUsd - netDepositedUsd`. */
	accumulatedYieldUsd?: number;
}

export interface ReadPositionsResponse {
	positions: UserPosition[];
	totalSuppliedUsd: number;
	netDepositedUsd: number;
	accumulatedYieldUsd: number;
	timestamp: string;
	investedSince: string | null;
}
