# Vayo Finance Partner Platform — Quickstart

> A 30-minute walkthrough of integrating the Vayo Finance Partner API. Covers
> onboarding and a first end-to-end supply + redeem. Partners sign every
> redeem locally; Vayo attaches a witness cosignature that binds the fee
> instructions.

This guide assumes you have already signed a partnership agreement with Vayo
and received an `admin` to provision your tenant. If not, contact
**partners@vayo.finance** first.

---

## 0. Install the official SDK (TypeScript)

If you're integrating in TypeScript or JavaScript, install the official
SDK — it absorbs all the boilerplate this guide would otherwise have you
write by hand (`x-api-key` injection, `Idempotency-Key` plumbing, structured
errors, the `/build → sign → /submit` redeem orchestration with Defense-3
fee verification):

```bash
bun add @vayolabs/core-sdk
# or: npm install @vayolabs/core-sdk
```

```ts
import { createVayoPartnerClient } from '@vayolabs/core-sdk'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!,
})

const overview = await vayo.dashboard.overview()
```

The SDK has **zero runtime dependencies** and ships with an opt-in
`@vayolabs/core-sdk/mode-s/privy` adapter for Privy users. Full method
reference + redeem walkthrough: [`../README.md`](../README.md).

The remainder of this guide shows the underlying HTTP / curl flows so
non-TypeScript partners (Go, Python, Java, etc.) can integrate against the
[OpenAPI spec](../openapi.json) directly.

---

## 1. How signing works

Partners sign every redeem transaction locally with their own signer
(Privy, Squads, Phantom, HSM, etc.). Vayo never holds partner signing keys.

- **Redeem flow:** `POST /v1/lending-operations/redeem-allocated/build` → partner signs the returned wire bytes → `POST /v1/lending-operations/redeem-allocated/submit`
- **Fee-bypass protection:** Vayo's witness signature binds the message hash at `/build` — any modification to the fee-instruction bytes invalidates the witness cosignature, so the network rejects the transaction
- **User-wallet authority:** held by the partner (or the partner's Privy app), never shared with Vayo

Fees are charged atomically on-chain in the same redeem transaction via
multi-recipient `transferChecked` instructions. There is no off-chain
ledger and no claim flow — your share lands in `payoutWalletAddress` the
moment the redeem confirms.

> **Optional auto-rebalance proxy.** If the partner wants to approve each
> bot-initiated rebalance redeem too, they can onboard an HMAC-signed
> webhook contract via `rebalanceProxyUrl`. Without it, Vayo's autonomous
> rebalancer does not touch partner-signed positions. See
> [`docs-partners/guides/signing-modes.md`](../../../docs-partners/guides/signing-modes.md).

### Choose between two fee models

Independent of signing mode, you also pick **one** fee model:

- **`performance_split`** — Vayo splits its performance fee with you.
  Default 50/50, server-side capped via `VAYO_PERFORMANCE_FEE_SHARE_BPS`.
  Best when you want predictable share of yield-on-yield.
- **`builder_code`** — Hyperliquid-style. You take a small slice of the user's
  *gross* yield (max `BUILDER_CODE_MAX_BPS`, default 10 bps). Best when you
  want a flat builder fee independent of Vayo's pricing.

You will be asked for both at partner creation. Fee math is implemented
server-side by Vayo and is exhaustively unit-tested — partners only need to
know which model they chose and what the resulting recipients/amounts
should look like on-chain.

---

## 2. Get provisioned

Vayo ops will create your partner record via the admin API:

```bash
POST /admin/partners/
{
  "name": "Acme Capital",
  "slug": "acme",
  "feeModel": "performance_split",
  "feeSplitBps": 5000,
  "payoutWalletAddress": "<your USDC ATA owner>",
  "rebalanceProxyUrl": null,                   // optional — HMAC-signed rebalance webhook
  "corsOrigins": ["https://app.acme.example"],
  "rateLimitMax": 500,
  "rateLimitWindowMs": 60000,
  "allowedMarketAddresses": null               // null = inherit Vayo's global whitelist
}
```

You will then ask Vayo to issue your first API key:

```bash
POST /admin/partners/{partnerId}/api-keys
{ "label": "Production" }
```

The response includes a `plaintext` field that is **shown only once**. Store
it in your secrets manager immediately — Vayo only stores its SHA-256 hash.
After this point, the plaintext is unrecoverable.

```json
{
  "apiKey": { "id": "...", "keyPrefix": "vayo_pk_ab", "label": "Production", ... },
  "plaintext": "vayo_pk_abcdef0123456789abcdef0123456789"
}
```

---

## 3. Make your first authenticated request

Every partner v1 request must carry the `x-api-key` header. Read-only
dashboard endpoints need only that. Endpoints that operate on a specific user
wallet (auth, wallets, lending-operations) additionally need a partner-user
JWT in the `Authorization: Bearer <token>` header.

Sanity-check your key against the dashboard:

```bash
curl https://api.vayo.finance/v1/dashboard/overview \
  -H "x-api-key: $VAYO_API_KEY"
```

Successful response:

```json
{
  "partner": { "id": "...", "name": "Acme Capital", "feeModel": "performance_split", ... },
  "users":   { "total": 0, "active": 0 },
  "volume":  { "depositsUsdc": "0", "redemptionsUsdc": "0" },
  "fees":    { "totalEarned": "0", "payoutCount": 0 }
}
```

If you get `401`, the key is wrong or inactive. If you get `403`, the call
is hitting an endpoint that needs a JWT too.

---

## 4. User onboarding

Partners sign every user-initiated operation locally with their own Privy
SDK (or HSM). Vayo does not hold partner-user wallet keys. The partner SDK
surface is intentionally narrow: read-only market/dashboard data, payments
(on/off-ramp), and the Mode S build/submit redeem flow below.

Vayo learns about a new user the moment their `privyDid` first appears in
a `/build` request — no explicit partner-side onboarding call is required.

---

## 5. Redeem — build + sign + submit

Redeem is two HTTPS calls separated by one local signing step on the
partner's side. Full TypeScript example: [`./examples/mode-s-redeem.ts`](./examples/mode-s-redeem.ts).

Sequence:

```text
   ┌── Partner backend ──┐               ┌──────── Vayo API ────────┐
   │                      │               │                          │
   │ 1. POST /build  ────────────────────►│ Build tx + witness sign  │
   │                      │               │ Cache message hash       │
   │                  ◄───────────────────│ Return wire bytes + id   │
   │                      │               │                          │
   │ 2. Verify expectedFeeRecipients      │                          │
   │ 3. Add user-wallet authority sig    │                          │
   │    via partner's Privy SDK           │                          │
   │                      │               │                          │
   │ 4. POST /submit ────────────────────►│ Re-verify message hash   │
   │                      │               │ Defense 2b — relay to RPC│
   │                  ◄───────────────────│ Return signature         │
   │                      │               │                          │
   └──────────────────────┘               └──────────────────────────┘
```

The key invariant: **Vayo's witness signs the message hash before the partner
ever sees it.** Any modification to the message bytes (instruction reorder,
fee transfer removal, recipient swap) invalidates the witness signature, so
the network rejects the transaction. The `/submit` re-check is a fail-fast
layer that gives Vayo a security signal but is not load-bearing for safety.

> **Optional `/submit`.** Partners may skip `/submit` entirely and
> broadcast the signed tx via their own RPC. The cryptographic guarantee
> holds either way. The reconciliation CRON later observes the on-chain
> signature and writes the `partner_fee_payouts` row.

---

## 6. Idempotency

Every partner v1 mutating route requires the `Idempotency-Key` header.
Replays within 24h return the cached response from `idempotency_keys`. The
recommended format is a v4 UUID per *logical* operation:

```ts
const idemKey = crypto.randomUUID()
try {
  return await vayo.modeS.redeem({ idempotencyKey: idemKey, /* ... */ })
} catch (networkError) {
  // Safe to retry with the SAME idempotency key — Vayo will replay the
  // cached response if the original call succeeded server-side.
  return await vayo.modeS.redeem({ idempotencyKey: idemKey, /* ... */ })
}
```

---

## 7. Rate limits, CORS, audit logs

Each partner has its own rate limit window (default `500` requests per
`60000` ms). Per-partner CORS is enforced from `corsOrigins`. Every request
is logged to `partner_audit_logs` with method, path, status, IP, user agent,
duration and correlation ID — visible at:

```bash
GET /v1/dashboard/consumption
GET /admin/partners/{id}/audit-logs   # admin only
```

---

## 8. Going to production checklist

- [ ] API key stored in your secrets manager (Vayo cannot recover it)
- [ ] `payoutWalletAddress` has an existing USDC ATA (validated at activation)
- [ ] `corsOrigins` contains only your production domains
- [ ] You verified at least one redeem flow on staging end-to-end and inspected
      the on-chain `transferChecked` recipients
- [ ] `Idempotency-Key` is wired into your retry layer
- [ ] You have a plan for rotating the API key (use
      `POST /admin/partners/{id}/api-keys/{keyId}/rotate` — never lets you
      go without an active key)

---

## Reference

- [`../openapi.json`](../openapi.json) — generated OpenAPI spec for the partner v1 routes
- [`./postman-collection.json`](./postman-collection.json) — Postman v2.1, mirrors the spec
- [`./examples/mode-s-redeem.ts`](./examples/mode-s-redeem.ts) — runnable redeem walkthrough
- [`../README.md`](../README.md) — full SDK method reference + redeem example
