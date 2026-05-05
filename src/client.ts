// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Layer 1 — `createVayoPartnerClient()` — the ergonomic typed client.
 *
 * Wraps the kubb-generated raw client functions in a tag-grouped object so
 * partners get autocomplete that mirrors the OpenAPI tags
 * (`client.lending.markets()`, `client.modeS.buildRedeem()`, etc.). Auth,
 * idempotency-key generation, and structured errors are handled inside the
 * shared `http.ts` wrapper — this file is just plumbing.
 *
 * All partner endpoints authenticate with the `x-api-key` header alone; there
 * are no JWT-guarded routes in the current surface.
 *
 * Per-call options:
 *   - `idempotencyKey`  — caller-provided idempotency key. Required for safe
 *                         retries on mutating routes; auto-generated if absent.
 *   - `signal`          — AbortSignal to cancel in-flight requests.
 */

import type {
	GetV1DashboardPartnerFeesPayoutsQueryParams,
	GetV1DashboardTransactionsQueryParams,
	GetV1DashboardUsersQueryParams,
	GetV1LendingReservesQueryParams,
	PostV1LendingOperationsRedeemAllocatedBuildMutationRequest,
	PostV1LendingOperationsRedeemAllocatedBuildQueryParams,
	PostV1LendingOperationsRedeemAllocatedSubmitMutationRequest,
} from "./generated";

import {
	getHealthModeS,
	getV1DashboardAllowlist,
	getV1DashboardApiKeys,
	getV1DashboardConsumption,
	getV1DashboardInvestmentPerformance,
	getV1DashboardOverview,
	getV1DashboardPartnerFees,
	getV1DashboardPartnerFeesPayouts,
	getV1DashboardPerformanceFees,
	getV1DashboardTransactions,
	getV1DashboardUsers,
	getV1LendingMarkets,
	getV1LendingReserves,
	postV1LendingOperationsRedeemAllocatedBuild,
	postV1LendingOperationsRedeemAllocatedSubmit,
} from "./generated";
import type { ClientContext, RequestConfig } from "./http";
import { client as rawHttpClient } from "./http";
import { createModeSHelper, type ModeSHelper } from "./mode-s/redeem";
import {
	type BuildSupplyResponse,
	createModeSSupplyHelper,
	type ModeSSupplyHelper,
	type SubmitSignedSupplyResponse,
} from "./mode-s/supply";
import {
	createWalletHelper,
	type PrepareWithdrawalResponse,
	type SubmitWithdrawalResponse,
	type WalletHelper,
} from "./wallet/withdraw";
import type {
	CreateWebhookSubscriptionResponse,
	DispatchWebhookEventResponse,
	ListWebhookDeliveriesResponse,
	RotateWebhookSecretResponse,
	WebhookSubscription,
} from "./webhooks";

// ─── Public options ────────────────────────────────────────────────────

export interface VayoPartnerClientOptions {
	/** Vayo API base URL — e.g. `https://api.vayo.finance`. No trailing slash. */
	baseUrl: string;
	/** Partner API key issued via `POST /admin/partners/:id/api-keys`. */
	apiKey: string;
	/** Optional fetch override (Node 18-, edge runtimes, instrumentation). */
	fetch?: typeof fetch;
	/** Optional idempotency-key generator override (default: `crypto.randomUUID`). */
	generateIdempotencyKey?: () => string;
}

/** Common per-call options threaded through every method. */
export interface CallOptions {
	/** AbortSignal to cancel the request. */
	signal?: AbortSignal;
	/** Caller-provided idempotency key (mutating routes). Auto-generated if absent. */
	idempotencyKey?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function buildRequestConfig<TData = unknown>(
	ctxBase: Omit<ClientContext, "idempotencyKey">,
	opts: { idempotencyKey?: string; signal?: AbortSignal },
): Partial<RequestConfig<TData>> {
	return {
		signal: opts.signal,
		context: {
			...ctxBase,
			idempotencyKey: opts.idempotencyKey,
		},
	};
}

// ─── Method groups ─────────────────────────────────────────────────────

/** `client.lending.*` — read-only market/reserve data. */
export interface LendingMethods {
	/** List markets allowed by the partner's allowlist. @see GET /v1/lending/markets */
	markets(args?: CallOptions): Promise<unknown>;
	/** Flat reserves across markets, optionally filtered by mints. @see GET /v1/lending/reserves */
	reserves(
		args?: { mints?: string[] | string } & CallOptions,
	): Promise<unknown>;
}

/** `client.modeS.*` — build/submit + opinionated `redeem()` and `supply()` orchestrators. */
export interface ModeSMethods extends ModeSHelper, ModeSSupplyHelper {
	/**
	 * Build a partially-signed redeem tx with the witness cosignature.
	 * @see POST /v1/lending-operations/redeem-allocated/build
	 */
	buildRedeem(
		args: {
			body: PostV1LendingOperationsRedeemAllocatedBuildMutationRequest;
			query?: PostV1LendingOperationsRedeemAllocatedBuildQueryParams;
		} & CallOptions,
	): Promise<BuildRedeemResponse>;
	/**
	 * Submit a fully-signed redeem tx (Vayo re-verifies cosigners + relays).
	 * @see POST /v1/lending-operations/redeem-allocated/submit
	 */
	submitSignedRedeem(
		args: {
			body: PostV1LendingOperationsRedeemAllocatedSubmitMutationRequest;
		} & CallOptions,
	): Promise<SubmitSignedRedeemResponse>;
	/**
	 * Build a partially-signed supply tx with the witness cosignature.
	 * @see POST /v1/lending-operations/supply-allocated/build
	 */
	buildSupply(
		args: {
			body: {
				privyDid: string;
				marketAddress: string;
				tokenMint: string;
				amount: string;
				reserveAddress?: string;
			};
			query?: { gasless?: "true" | "false" };
		} & CallOptions,
	): Promise<BuildSupplyResponse>;
	/**
	 * Submit a fully-signed supply tx (Vayo re-verifies cosigners + relays).
	 * @see POST /v1/lending-operations/supply-allocated/submit
	 */
	submitSignedSupply(
		args: {
			body: { pendingSupplyId: string; serializedTx: string };
		} & CallOptions,
	): Promise<SubmitSignedSupplyResponse>;
}

/** `client.wallet.*` — async memo-challenge withdrawal. */
export interface WalletMethods extends WalletHelper {
	/** @see POST /v1/wallet/withdraw/prepare */
	prepareWithdrawal(
		args: {
			body: {
				privyDid: string;
				destinationAddress: string;
				amount: string;
				exactRecipientAmount?: boolean;
			};
		} & CallOptions,
	): Promise<PrepareWithdrawalResponse>;
	/** @see POST /v1/wallet/withdraw/submit */
	submitWithdrawal(
		args: {
			body: { pendingWithdrawalId: string; signedIntentTransaction: string };
		} & CallOptions,
	): Promise<SubmitWithdrawalResponse>;
}

/** `client.webhooks.*` — outbound event subscriptions. */
export interface WebhooksMethods {
	/** @see POST /v1/webhooks */
	create(
		args: {
			body: { url: string; events: string[]; description?: string };
		} & CallOptions,
	): Promise<CreateWebhookSubscriptionResponse>;
	/** @see GET /v1/webhooks */
	list(args?: CallOptions): Promise<WebhookSubscription[]>;
	/** @see DELETE /v1/webhooks/:subscriptionId */
	delete(
		args: { subscriptionId: string } & CallOptions,
	): Promise<{ deleted: true }>;
	/** @see POST /v1/webhooks/:subscriptionId/rotate-secret */
	rotateSecret(
		args: { subscriptionId: string } & CallOptions,
	): Promise<RotateWebhookSecretResponse>;
	/** @see POST /v1/webhooks/:subscriptionId/test */
	test(
		args: { subscriptionId: string } & CallOptions,
	): Promise<DispatchWebhookEventResponse>;
	/** @see GET /v1/webhooks/:subscriptionId/deliveries */
	deliveries(
		args: {
			subscriptionId: string;
			cursor?: string;
			limit?: number;
			status?: "pending" | "delivered" | "retrying" | "permanently_failed";
		} & CallOptions,
	): Promise<ListWebhookDeliveriesResponse>;
}

/** `client.dashboard.*` — partner self-service analytics. */
export interface DashboardMethods {
	/** @see GET /v1/dashboard/overview */
	overview(args?: CallOptions): Promise<unknown>;
	/** @see GET /v1/dashboard/users */
	users(args?: GetV1DashboardUsersQueryParams & CallOptions): Promise<unknown>;
	/** @see GET /v1/dashboard/transactions */
	transactions(
		args?: GetV1DashboardTransactionsQueryParams & CallOptions,
	): Promise<unknown>;
	/** @see GET /v1/dashboard/consumption */
	consumption(args?: CallOptions): Promise<unknown>;
	/** @see GET /v1/dashboard/investment-performance */
	investmentPerformance(args?: CallOptions): Promise<unknown>;
	/** @deprecated Legacy alias of `partnerFees`. @see GET /v1/dashboard/performance-fees */
	performanceFees(args?: CallOptions): Promise<unknown>;
	/** @see GET /v1/dashboard/partner-fees */
	partnerFees(args?: CallOptions): Promise<unknown>;
	/** @see GET /v1/dashboard/partner-fees/payouts */
	partnerFeesPayouts(
		args?: GetV1DashboardPartnerFeesPayoutsQueryParams & CallOptions,
	): Promise<unknown>;
	/** @see GET /v1/dashboard/allowlist */
	allowlist(args?: CallOptions): Promise<unknown>;
	/** @see GET /v1/dashboard/api-keys */
	apiKeys(args?: CallOptions): Promise<unknown>;
}

/** `client.health.*` — service + signing subsystem health. */
export interface HealthMethods {
	/** Basic liveness probe. @see GET /health */
	liveness(args?: CallOptions): Promise<unknown>;
	/** Readiness probe. @see GET /health/ready */
	ready(args?: CallOptions): Promise<unknown>;
	/** Kora gasless relayer health. @see GET /health/kora */
	kora(args?: CallOptions): Promise<unknown>;
	/** Mode S witness/cosigner health. @see GET /health/mode-s */
	modeS(args?: CallOptions): Promise<unknown>;
}

// ─── Response shapes for Mode S (typed by hand because the spec has them as `any`) ───

/**
 * Response shape of `POST /v1/lending-operations/redeem-allocated/build`.
 *
 * The OpenAPI spec types this as `any` because Elysia auto-generates schemas
 * from request validators only — response shapes aren't captured in the
 * exported swagger. We type it here so partners get autocomplete on the
 * redeem helper. Source of truth:
 * `apps/api/src/core/use-cases/build-redeem-transaction.ts:58`.
 */
export interface BuildRedeemResponse {
	/** Base64-encoded wire transaction with the witness signature attached. */
	serializedTx: string;
	/** Lookup key for `/submit`. Cached for 5 minutes. */
	pendingRedeemId: string;
	/** Embedded fee transfers — verify before user-signing. */
	expectedFeeRecipients: Array<{ address: string; amount: string }>;
	/** Cosigners attached at build time. Always includes 'witness'. */
	cosignersAttached: Array<"witness" | "kora">;
	expiresAt: string;
}

/**
 * Response shape of `POST /v1/lending-operations/redeem-allocated/submit`.
 * Same caveat as `BuildRedeemResponse` — typed by hand because the OpenAPI
 * spec returns `any`. Source: `apps/api/src/core/use-cases/submit-signed-redeem.ts:19`.
 */
export interface SubmitSignedRedeemResponse {
	signature: string;
	confirmed: boolean;
}

// ─── Top-level client interface ────────────────────────────────────────

export interface VayoPartnerClient {
	lending: LendingMethods;
	modeS: ModeSMethods;
	wallet: WalletMethods;
	webhooks: WebhooksMethods;
	dashboard: DashboardMethods;
	health: HealthMethods;
	/** Read-only view of the SDK options the client was constructed with. */
	readonly options: Readonly<VayoPartnerClientOptions>;
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createVayoPartnerClient(
	options: VayoPartnerClientOptions,
): VayoPartnerClient {
	if (!options.baseUrl) {
		throw new Error(
			"[vayo/core-sdk] createVayoPartnerClient: baseUrl is required",
		);
	}
	if (!options.apiKey) {
		throw new Error(
			"[vayo/core-sdk] createVayoPartnerClient: apiKey is required",
		);
	}

	// Strip trailing slash so route paths concatenate cleanly.
	const baseUrl = options.baseUrl.replace(/\/+$/, "");
	const ctxBase: Omit<ClientContext, "idempotencyKey"> = {
		baseUrl,
		apiKey: options.apiKey,
		fetch: options.fetch,
		generateIdempotencyKey: options.generateIdempotencyKey,
	};

	// Helper that builds the per-call config consistently for every method.
	const cfg = <T>(opts: { idempotencyKey?: string; signal?: AbortSignal }) =>
		buildRequestConfig<T>(ctxBase, opts);

	const lending: LendingMethods = {
		markets: (args) => getV1LendingMarkets(cfg({ signal: args?.signal })),
		reserves: (args) => {
			const { mints, signal } = args ?? {};
			const params: GetV1LendingReservesQueryParams | undefined = mints
				? { mints: Array.isArray(mints) ? mints.join(",") : mints }
				: undefined;
			return getV1LendingReserves(params, cfg({ signal }));
		},
	};

	const buildRedeem: ModeSMethods["buildRedeem"] = ({
		body,
		query,
		idempotencyKey,
		signal,
	}) =>
		postV1LendingOperationsRedeemAllocatedBuild(
			body,
			query,
			cfg({ idempotencyKey, signal }),
		) as Promise<BuildRedeemResponse>;

	const submitSignedRedeem: ModeSMethods["submitSignedRedeem"] = ({
		body,
		idempotencyKey,
		signal,
	}) =>
		postV1LendingOperationsRedeemAllocatedSubmit(
			body,
			cfg({ idempotencyKey, signal }),
		) as Promise<SubmitSignedRedeemResponse>;

	const modeSHelper = createModeSHelper({ buildRedeem, submitSignedRedeem });

	const rawCall = async <TResp>(
		method: "GET" | "POST" | "DELETE",
		url: string,
		opts: {
			body?: unknown;
			idempotencyKey?: string;
			signal?: AbortSignal;
		} = {},
	): Promise<TResp> => {
		const res = await rawHttpClient<TResp>({
			method,
			url,
			data: opts.body as never,
			signal: opts.signal,
			context: { ...ctxBase, idempotencyKey: opts.idempotencyKey },
		});
		return res.data;
	};

	const buildSupply: ModeSMethods["buildSupply"] = ({
		body,
		query,
		idempotencyKey,
		signal,
	}) => {
		const qs = query?.gasless ? `?gasless=${query.gasless}` : "";
		return rawCall<BuildSupplyResponse>(
			"POST",
			`/v1/lending-operations/supply-allocated/build${qs}`,
			{ body, idempotencyKey, signal },
		);
	};

	const submitSignedSupply: ModeSMethods["submitSignedSupply"] = ({
		body,
		idempotencyKey,
		signal,
	}) =>
		rawCall<SubmitSignedSupplyResponse>(
			"POST",
			"/v1/lending-operations/supply-allocated/submit",
			{ body, idempotencyKey, signal },
		);

	const modeSSupplyHelper = createModeSSupplyHelper({
		buildSupply,
		submitSignedSupply,
	});

	const modeS: ModeSMethods = {
		buildRedeem,
		submitSignedRedeem,
		redeem: modeSHelper.redeem,
		buildSupply,
		submitSignedSupply,
		supply: modeSSupplyHelper.supply,
	};

	const prepareWithdrawal: WalletMethods["prepareWithdrawal"] = ({
		body,
		idempotencyKey,
		signal,
	}) =>
		rawCall<PrepareWithdrawalResponse>("POST", "/v1/wallet/withdraw/prepare", {
			body,
			idempotencyKey,
			signal,
		});

	const submitWithdrawal: WalletMethods["submitWithdrawal"] = ({
		body,
		idempotencyKey,
		signal,
	}) =>
		rawCall<SubmitWithdrawalResponse>("POST", "/v1/wallet/withdraw/submit", {
			body,
			idempotencyKey,
			signal,
		});

	const walletHelper = createWalletHelper({
		prepareWithdrawal,
		submitWithdrawal,
	});

	const wallet: WalletMethods = {
		prepareWithdrawal,
		submitWithdrawal,
		withdraw: walletHelper.withdraw,
	};

	const webhooks: WebhooksMethods = {
		create: ({ body, idempotencyKey, signal }) =>
			rawCall<CreateWebhookSubscriptionResponse>("POST", "/v1/webhooks", {
				body,
				idempotencyKey,
				signal,
			}),
		list: (args) =>
			rawCall<WebhookSubscription[]>("GET", "/v1/webhooks", {
				signal: args?.signal,
			}),
		delete: ({ subscriptionId, idempotencyKey, signal }) =>
			rawCall<{ deleted: true }>("DELETE", `/v1/webhooks/${subscriptionId}`, {
				idempotencyKey,
				signal,
			}),
		rotateSecret: ({ subscriptionId, idempotencyKey, signal }) =>
			rawCall<RotateWebhookSecretResponse>(
				"POST",
				`/v1/webhooks/${subscriptionId}/rotate-secret`,
				{ idempotencyKey, signal },
			),
		test: ({ subscriptionId, idempotencyKey, signal }) =>
			rawCall<DispatchWebhookEventResponse>(
				"POST",
				`/v1/webhooks/${subscriptionId}/test`,
				{ idempotencyKey, signal },
			),
		deliveries: ({ subscriptionId, cursor, limit, status, signal }) => {
			const params = new URLSearchParams();
			if (cursor) params.set("cursor", cursor);
			if (limit !== undefined) params.set("limit", String(limit));
			if (status) params.set("status", status);
			const qs = params.toString();
			return rawCall<ListWebhookDeliveriesResponse>(
				"GET",
				`/v1/webhooks/${subscriptionId}/deliveries${qs ? `?${qs}` : ""}`,
				{ signal },
			);
		},
	};

	const dashboard: DashboardMethods = {
		overview: (args) => getV1DashboardOverview(cfg({ signal: args?.signal })),
		users: (args) => {
			const { signal, limit, offset, activeOnly } = args ?? {};
			const params: GetV1DashboardUsersQueryParams | undefined =
				limit !== undefined || offset !== undefined || activeOnly !== undefined
					? { limit, offset, activeOnly }
					: undefined;
			return getV1DashboardUsers(params, cfg({ signal }));
		},
		transactions: (args) => {
			const { signal, type, status, limit, offset } = args ?? {};
			const params: GetV1DashboardTransactionsQueryParams | undefined =
				type !== undefined ||
				status !== undefined ||
				limit !== undefined ||
				offset !== undefined
					? { type, status, limit, offset }
					: undefined;
			return getV1DashboardTransactions(params, cfg({ signal }));
		},
		consumption: (args) =>
			getV1DashboardConsumption(cfg({ signal: args?.signal })),
		investmentPerformance: (args) =>
			getV1DashboardInvestmentPerformance(cfg({ signal: args?.signal })),
		performanceFees: (args) =>
			getV1DashboardPerformanceFees(cfg({ signal: args?.signal })),
		partnerFees: (args) =>
			getV1DashboardPartnerFees(cfg({ signal: args?.signal })),
		partnerFeesPayouts: (args) => {
			const { signal, limit, offset } = args ?? {};
			const params: GetV1DashboardPartnerFeesPayoutsQueryParams | undefined =
				limit !== undefined || offset !== undefined
					? { limit, offset }
					: undefined;
			return getV1DashboardPartnerFeesPayouts(params, cfg({ signal }));
		},
		allowlist: (args) => getV1DashboardAllowlist(cfg({ signal: args?.signal })),
		apiKeys: (args) => getV1DashboardApiKeys(cfg({ signal: args?.signal })),
	};

	// Health subprobes outside `/health/mode-s` are not in the OpenAPI spec, so
	// they're not kubb-generated — call the raw http client directly.
	const healthGet = async (url: string, signal?: AbortSignal) => {
		const res = await rawHttpClient<unknown>({
			method: "GET",
			url,
			signal,
			context: { ...ctxBase, idempotencyKey: undefined },
		});
		return res.data;
	};

	const health: HealthMethods = {
		liveness: (args) => healthGet("/health", args?.signal),
		ready: (args) => healthGet("/health/ready", args?.signal),
		kora: (args) => healthGet("/health/kora", args?.signal),
		modeS: (args) => getHealthModeS(cfg({ signal: args?.signal })),
	};

	return {
		lending,
		modeS,
		wallet,
		webhooks,
		dashboard,
		health,
		options: Object.freeze({ ...options }),
	};
}
