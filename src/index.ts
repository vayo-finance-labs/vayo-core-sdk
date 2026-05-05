// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * @vayo/core-sdk — official TypeScript SDK for the Vayo Finance Partner API.
 *
 * Three layers:
 *   1. **Generated** — raw kubb-generated client functions (advanced users
 *      can reach in via the `@vayo/core-sdk/generated` sub-export).
 *   2. **Typed client** — `createVayoPartnerClient()`, grouped by tag.
 *   3. **Mode S helper** — `client.modeS.redeem()` orchestrator with a
 *      pluggable `signTransaction` callback.
 *
 * For the optional Privy adapter:
 *   `import { createPrivySigner } from '@vayo/core-sdk/mode-s/privy'`
 *
 * Quickstart, the full Mode S walkthrough, and the OpenAPI spec live in
 * the monorepo at `docs/core-sdk/`.
 */

export {
	type BuildRedeemResponse,
	type CallOptions,
	createVayoPartnerClient,
	type DashboardMethods,
	type HealthMethods,
	type LendingMethods,
	type ModeSMethods,
	type SubmitSignedRedeemResponse,
	type VayoPartnerClient,
	type VayoPartnerClientOptions,
	type WalletMethods,
	type WebhooksMethods,
} from "./client";
export { U64_MAX, USDC_MINT } from "./constants";
export { VayoApiError, type VayoErrorBody } from "./errors";
// Re-export the kubb-generated request types so partners get autocomplete on
// method args without reaching into the `/generated` sub-export.
export type {
	GetV1DashboardPartnerFeesPayoutsQueryParams,
	GetV1DashboardTransactionsQueryParams,
	GetV1DashboardUsersQueryParams,
	GetV1LendingReservesQueryParams,
	PostV1LendingOperationsRedeemAllocatedBuildMutationRequest,
	PostV1LendingOperationsRedeemAllocatedBuildQueryParams,
	PostV1LendingOperationsRedeemAllocatedSubmitMutationRequest,
} from "./generated";

export type {
	ModeSHelper,
	RedeemModeSInput,
	RedeemModeSResult,
	SignTransactionCallback,
} from "./mode-s/redeem";
export type {
	BuildSupplyResponse,
	ModeSSupplyHelper,
	SubmitSignedSupplyResponse,
	SupplyModeSInput,
	SupplyModeSResult,
} from "./mode-s/supply";
export {
	assertFeeRecipientsMatch,
	type ExpectedFeeRecipients,
	type ObservedFeeRecipient,
} from "./mode-s/verify-fee-recipients";
export type {
	PrepareWithdrawalResponse,
	SubmitWithdrawalResponse,
	WalletHelper,
	WithdrawInput,
	WithdrawResult,
} from "./wallet/withdraw";
export {
	type CreateWebhookSubscriptionResponse,
	type DispatchWebhookEventResponse,
	type ListWebhookDeliveriesResponse,
	type RotateWebhookSecretResponse,
	verifyWebhookSignature,
	type WebhookDelivery,
	type WebhookSubscription,
} from "./webhooks";
