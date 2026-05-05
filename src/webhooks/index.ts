// Copyright 2026 Vayo Finance Labs
// SPDX-License-Identifier: Apache-2.0

/**
 * Webhook receiver helpers.
 *
 * Partners receive POSTs from Vayo with the body signed via HMAC-SHA256. Use
 * `verifyWebhookSignature()` on every inbound delivery to reject forgeries
 * before processing the payload.
 *
 * Canonical body shape (alphabetically-sorted top-level keys):
 *   { eventId, eventType, partnerId, payload }
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookSubscription {
	id: string;
	partnerId: string;
	url: string;
	events: string[];
	description: string | null;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CreateWebhookSubscriptionResponse extends WebhookSubscription {
	secret: string;
}

export interface RotateWebhookSecretResponse {
	id: string;
	secret: string;
	rotatedAt: string;
}

export interface DispatchWebhookEventResponse {
	eventId: string;
	deliveriesEnqueued: number;
}

export interface WebhookDelivery {
	id: string;
	eventId: string;
	eventType: string;
	status: "pending" | "delivered" | "retrying" | "permanently_failed";
	attempts: number;
	nextRetryAt: string | null;
	lastAttemptAt: string | null;
	responseStatus: number | null;
	createdAt: string;
}

export interface ListWebhookDeliveriesResponse {
	items: WebhookDelivery[];
	nextCursor: string | null;
}

/**
 * Verify a webhook delivery's HMAC signature.
 *
 * @param secret  The signing secret returned at subscription creation (or rotation)
 * @param body    The raw request body bytes you received (DO NOT re-stringify)
 * @param signatureHeader  Value of the `X-Vayo-Signature` header (e.g. `sha256=abc...`)
 * @returns true when the signature matches; false otherwise
 */
export function verifyWebhookSignature(
	secret: string,
	body: string,
	signatureHeader: string | null | undefined,
): boolean {
	if (!signatureHeader) return false;
	const prefix = "sha256=";
	if (!signatureHeader.startsWith(prefix)) return false;
	const expected = signatureHeader.slice(prefix.length);
	const computed = createHmac("sha256", secret).update(body).digest("hex");
	if (expected.length !== computed.length) return false;
	try {
		return timingSafeEqual(Buffer.from(expected), Buffer.from(computed));
	} catch {
		return false;
	}
}
