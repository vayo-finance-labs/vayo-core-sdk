---
name: vayo-core-sdk
description: Use when the user is integrating with the Vayo Finance Partner API to deposit, redeem, or manage USDC lending positions on Solana via Kamino — partners sign redeems locally and Vayo attaches a witness cosignature binding the fee instructions. Triggers on requests like "integrate Vayo", "use the Vayo SDK", "redeem through Vayo", "supply to Kamino through Vayo", "partner fee split", "createVayoPartnerClient", or any reference to `@vayolabs/core-sdk`.
---

# Vayo Finance Partner SDK Integration

## Background

Vayo Finance is a multi-tenant Solana lending platform built on top of Kamino. Partners integrate via the **Partner v1 API** and earn an automatic on-chain share of every redeem via multi-recipient `transferChecked` instructions — no off-chain ledger, no claim flow.

**Partners sign every redeem locally.** Vayo never holds partner signing keys. The redeem flow is `POST /v1/lending-operations/redeem-allocated/build` → partner signs the returned wire bytes → `POST /v1/lending-operations/redeem-allocated/submit`. Vayo's witness signature binds the fee instructions so the partner cannot strip them without invalidating the signature.

There are **two fee models** (mutually exclusive, picked once):

- `performance_split` — Vayo splits its performance fee with the partner (default 50/50, server-capped via `VAYO_PERFORMANCE_FEE_SHARE_BPS`)
- `builder_code` — Hyperliquid-style. Partner takes a small slice of *gross* yield, capped via `BUILDER_CODE_MAX_BPS` (default 10 bps)

The official TypeScript SDK is **[`@vayolabs/core-sdk`](README.md)** (this directory). It wraps the partner routes in a typed client grouped by tag, ships an opinionated `redeem()` orchestrator, and provides an opt-in `@vayolabs/core-sdk/mode-s/privy` adapter for Privy users. Zero runtime dependencies.

## When to Use

Use this skill when the user:

- Asks how to deposit, redeem, or manage USDC positions through Vayo
- Wants to integrate the `@vayolabs/core-sdk` package into their backend
- Is debugging a build/sign/submit redeem flow
- Mentions Privy + Vayo, on-chain fee splits, partner allowlists, idempotency keys, or `Idempotency-Key` headers
- Wants to query the partner dashboard (users, transactions, fees, payouts)
- Asks for a quickstart, example, or "how do I X with Vayo"

Do NOT use this skill when the user is working on Vayo's first-party webapp/admin internals — that's a different surface (`apps/api`, `apps/web`) with its own auth model.

## Procedure

When invoked, follow these steps in order. Skip steps that are already established in the conversation.

### 1. Determine the partner's fee model

If the user hasn't already told you, **ask** before writing any code:

- **Fee model?** `performance_split` is the default and most common. Use `builder_code` only if they explicitly mention a flat builder fee.

If the user is just exploring, default to **`performance_split`** and call it out.

All partners sign redeems locally — there is no Vayo-signs alternative in the current partner surface. Partners who previously relied on Vayo-managed signing have migrated off that path.

### 2. Read the canonical reference files BEFORE writing code

Always read at least:

- [`README.md`](README.md) — full method reference + redeem example + going-to-prod checklist
- [`docs/quickstart.md`](docs/quickstart.md) — long-form walkthrough with curl + SDK side-by-side

For redeem/signing work also read:

- [`src/mode-s/redeem.ts`](src/mode-s/redeem.ts) — the orchestrator's actual contract (`RedeemModeSInput`, `SignTransactionCallback`, `RedeemModeSResult`)
- [`src/mode-s/verify-fee-recipients.ts`](src/mode-s/verify-fee-recipients.ts) — Defense-3 mirror
- [`src/mode-s/privy.ts`](src/mode-s/privy.ts) — the Privy adapter signature
- [`docs/examples/mode-s-redeem.ts`](docs/examples/mode-s-redeem.ts) — runnable end-to-end example

For schema-level questions, hand the user the OpenAPI spec instead of guessing types: [`openapi.json`](openapi.json) (lives at the package root).

### 3. Install + bootstrap

```bash
bun add @vayolabs/core-sdk
# or: npm install @vayolabs/core-sdk
# or: pnpm add @vayolabs/core-sdk
```

Partners typically also install their signer:

```bash
# Privy signer
bun add @vayolabs/core-sdk @privy-io/node
```

`@privy-io/node` is an **optional peer dependency** — partners using other signers (Squads, custom HSMs) skip it entirely.

### 4. Construct the client

```ts
import { createVayoPartnerClient } from '@vayolabs/core-sdk'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!, // issued via POST /admin/partners/:id/api-keys
})
```

The `apiKey` is shown **once** at issuance. Tell the user to store it in a secrets manager — Vayo only stores the SHA-256 hash and cannot recover it.

For deterministic tests, override `generateIdempotencyKey`. For instrumentation/edge runtimes, override `fetch`.

### 5. Wire the right method group

Group the user's task by OpenAPI tag — that's how the SDK is organized:

| Task | Method | Auth |
|---|---|---|
| List markets | `vayo.lending.markets()` | API key |
| List reserves (filter by mints) | `vayo.lending.reserves({ mints })` | API key |
| Build redeem (raw) | `vayo.modeS.buildRedeem({ body })` | API key |
| Submit signed redeem (raw) | `vayo.modeS.submitSignedRedeem({ body })` | API key |
| **Full redeem flow** | **`vayo.modeS.redeem({ ..., signTransaction })`** | API key |
| Create PIX onramp link | `vayo.payments.createOnramp({ body })` | API key |
| Create PIX offramp link | `vayo.payments.createOfframp({ body })` | API key |
| Poll offramp status | `vayo.payments.getOfframpStatus({ end2end })` | API key |
| List payment events / transactions | `vayo.payments.{paymentEvents,transactions}` | API key |
| Prepare Privy-funding deposit record | `vayo.payments.prepareDeposit()` | API key |
| Dashboard overview | `vayo.dashboard.overview()` | API key |
| Users / transactions / consumption / fees | `vayo.dashboard.{users,transactions,consumption,partnerFees,partnerFeesPayouts}` | API key |
| Health probes | `vayo.health.{liveness,kora,modeS,ready}` | (none) |

All partner endpoints authenticate via the `x-api-key` header only — there are no JWT-guarded routes in the current public surface.

### 6. Supply flow (Mode V)

Multi-market supply is no longer exposed on the partner SDK — supply is handled server-side via Vayo-managed user accounts outside the partner API surface. Partners redeem via Mode S (below).

Use `U64_MAX` (exported from the SDK) for full redeems.

### 7. Redeem — the orchestrator pattern

**Always prefer `vayo.modeS.redeem()`** over hand-rolling `buildRedeem` + `submitSignedRedeem`. The orchestrator runs the full `/build → verify-fee-recipients → sign → /submit` flow with the Defense-3 mirror and an optional direct-RPC fallback. Hand-rolling skips safety checks.

```ts
import { createVayoPartnerClient, U64_MAX, USDC_MINT } from '@vayolabs/core-sdk'
import { createPrivySigner } from '@vayolabs/core-sdk/mode-s/privy'
import { PrivyClient } from '@privy-io/node'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!,
})

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

const result = await vayo.modeS.redeem({
  privyDid: 'did:privy:cm...',
  marketAddress: 'H6rMUYR8XSUxsZWtpsAJSqQ4rk2pGMLFp4xJqFE9YjV1',
  tokenMint: USDC_MINT,
  amount: U64_MAX,
  signTransaction: createPrivySigner(privy, {
    walletId: userWalletId,
    authorizationPrivateKeys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
  }),
  // STRONGLY RECOMMENDED — aborts before signing if Vayo's fee math drifts
  expectedFeeRecipients: {
    partnerPayoutAddress: 'YourPartnerPayoutWallet...',
    vayoTreasuryAddress: 'VayoTreasuryWallet...',
  },
  // Optional — broadcasts directly to RPC if /submit fails
  fallbackRpcUrl: 'https://api.mainnet-beta.solana.com',
})

// result: { signature, pendingRedeemId, expectedFeeRecipients, cosignersAttached, viaFallbackRpc }
```

For non-Privy signers, replace `createPrivySigner(...)` with any function `(serializedTxBase64: string) => Promise<string>` — the contract is in `SignTransactionCallback`. The function receives the partially-signed wire bytes (Vayo's witness signature already attached) and must return the fully-signed wire bytes with the user authority added.

### 8. Idempotency & retries

Every mutating route requires `Idempotency-Key`. The SDK auto-generates one per call. For safe retries, **explicitly pass a stable key** per logical operation:

```ts
const idemKey = crypto.randomUUID()
try {
  return await vayo.modeS.submitSignedRedeem({ idempotencyKey: idemKey, body })
} catch (err) {
  // Safe to retry — Vayo replays the cached response if the original call succeeded server-side
  return await vayo.modeS.submitSignedRedeem({ idempotencyKey: idemKey, body })
}
```

The `Idempotency-Key` cache TTL is 24h server-side.

### 9. Error handling

Always type-narrow with `instanceof VayoApiError` and surface `correlationId` in logs:

```ts
import { VayoApiError } from '@vayolabs/core-sdk'

try {
  await vayo.modeS.redeem({ /* ... */ })
} catch (err) {
  if (err instanceof VayoApiError) {
    console.error(`[vayo:${err.statusCode}] ${err.message} (correlationId=${err.correlationId})`)
    if (err.statusCode === 403) {
      // market not in partner allowlist, JWT for wrong partner, etc.
    }
    if (err.statusCode === 429) {
      // partner rate limit exceeded — back off
    }
  }
  throw err
}
```

The redeem orchestrator additionally throws a plain `RangeError` (with `'fee recipients'` in the message) when the Defense-3 mirror trips before signing — handle that specifically if you want a different UX from generic API errors.

### 10. Going to production checklist

Before flipping the switch, verify:

- [ ] API key stored in the partner's secrets manager (not in code or env files committed to git)
- [ ] `payoutWalletAddress` has an existing USDC ATA (validated at activation by Vayo)
- [ ] At least one supply + redeem flow verified end-to-end on staging, with the on-chain `transferChecked` recipients inspected manually
- [ ] `Idempotency-Key` is wired into the partner's retry layer
- [ ] `VayoApiError` is caught and `correlationId` is included in logs
- [ ] `client.dashboard.consumption()` is checked periodically to track API usage vs the partner's rate limit

## Response Format

When the user asks "how do I do X with Vayo", structure your reply as:

1. **One-line answer** — which method group + method to call
2. **Code snippet** — minimal, copy-pasteable, importing only what's needed
3. **Caveats** — auth requirements, idempotency, allowlist constraints
4. **Reference link(s)** — to the relevant section of `README.md`, `quickstart.md`, or `openapi.json`

Example:

> **You want to redeem a position from Kamino.** Use `vayo.modeS.redeem()` — the opinionated orchestrator that handles `/build → sign → /submit` with the Defense-3 fee-recipient verification.
>
> ```ts
> // ... code snippet ...
> ```
>
> **Caveats:**
> - Single market only (multi-market redeem is not supported in MVP)
> - `?gasless=true` is not yet implemented (returns `501`)
> - `signTransaction` must return the **fully-signed** base64 wire bytes, not just the user's signature
>
> See [`README.md` — Redeem section](README.md) and [`docs/examples/mode-s-redeem.ts`](docs/examples/mode-s-redeem.ts).

## Important Notes

- **Never hand-write the HTTP client.** The SDK already injects `x-api-key`, `Authorization: Bearer`, `Idempotency-Key`, and parses `VayoApiError` envelopes. Anything you re-implement is a regression.
- **Never bypass the Defense-3 mirror.** If the user pushes back on `expectedFeeRecipients`, explain that it's a 0-cost local sanity check that aborts before any signing call wastes a Privy/HSM request.
- **`?gasless=true` on redeem returns `501`** — the SDK exposes the parameter but the API hasn't shipped Kora cosigning for `/build` yet. Don't suggest it.
- **Response types for `modeS.buildRedeem` / `modeS.submitSignedRedeem`** are typed by hand in the SDK (`BuildRedeemResponse`, `SubmitSignedRedeemResponse`) because Elysia's swagger only captures request schemas. Other route response types fall back to `unknown` until the API adds TypeBox response validators.
- **Admin endpoints (`/admin/...`) are NOT exposed by the SDK** and are intentionally excluded from `openapi.json`. They're Vayo-internal — partners can never call them directly. If a user asks how to create their own partner record or rotate their own API key, the answer is "ask Vayo ops via partners@vayo.finance".
- **`@privy-io/node` is an optional peer dep.** Don't add it to a non-Privy partner's `dependencies`. Only the `@vayolabs/core-sdk/mode-s/privy` sub-export needs it, and only if the partner uses Privy.
- **Optional auto-rebalance proxy** — partners can onboard an HMAC-signed webhook contract so Vayo delegates rebalance signing back to them. See `docs-partners/guides/signing-modes.md` and `docs-partners/sdk/examples/rebalance-proxy.md`. Not configured by default.
- **First-party Vayo internals** (Vayo's own backend/webapp, hexagonal use cases, CRONs) are out of scope for this skill. If the user is clearly working on Vayo internals rather than consuming the SDK as a partner, stop and defer to the host project's own conventions.
- **Commit-time:** if you generate code that imports from `@vayolabs/core-sdk`, run `bun lint` and `bun typecheck` from the repo root before declaring done. The SDK is strict about `noUncheckedIndexedAccess` and biome formatting.
