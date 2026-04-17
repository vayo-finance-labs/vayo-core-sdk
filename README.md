# @vayo/core-sdk

Official TypeScript SDK for the [Vayo Finance](https://vayo.finance) Partner
API. Lets partners deposit, redeem, and manage USDC lending positions on
Solana via Vayo's hardened multi-tenant platform. Partners sign every
redeem locally with their own signer; Vayo attaches a witness cosignature
that cryptographically binds the fee instructions so on-chain partner-fee
splitting is guaranteed.

> **Status:** 0.1.0 — Initial release. Partner v1 routes covered. Redeem
> `/build` + `/submit` are GA. The `?gasless=true` flag on redeem is not
> yet supported (returns `501`).

## Install

```bash
bun add @vayo/core-sdk
# or
npm install @vayo/core-sdk
# or
pnpm add @vayo/core-sdk
```

The SDK has **zero runtime dependencies**. The optional Privy signing
adapter (`@vayo/core-sdk/mode-s/privy`) is the only path that needs
`@privy-io/node` — and even there, the partner constructs the
`PrivyClient` themselves and passes it in, so the SDK only consumes Privy
*types*. Partners using other signers (Squads, Phantom, custom HSMs) pay
zero install cost.

## 60-second quickstart

```ts
import { createVayoPartnerClient } from '@vayo/core-sdk'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!, // issued via POST /admin/partners/:id/api-keys
})

// Read-only endpoints — no JWT required
const overview = await vayo.dashboard.overview()
const markets = await vayo.lending.markets()
const fees = await vayo.dashboard.partnerFees()
```

## Redeem — partners sign locally

Partner runs their own signer (Privy, Squads, Phantom, HSM, anything).
Vayo provides a witness cosignature that cryptographically binds the fee
instructions; the partner adds the user-wallet authority signature locally
and submits.

The `client.modeS.redeem()` orchestrator runs the full
`/build → verify → sign → /submit` flow. The signing step is a callback you
provide — works with any signer.

```ts
import { createVayoPartnerClient, U64_MAX, USDC_MINT } from '@vayo/core-sdk'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!,
})

const result = await vayo.modeS.redeem({
  privyDid: 'did:privy:cm...',
  marketAddress: 'H6rMUYR8XSUxsZWtpsAJSqQ4rk2pGMLFp4xJqFE9YjV1',
  tokenMint: USDC_MINT,
  amount: U64_MAX,

  // Defense-3 mirror — aborts before signing if recipients drift.
  // Strongly recommended.
  expectedFeeRecipients: {
    partnerPayoutAddress: 'YourPartnerPayoutWallet...',
    vayoTreasuryAddress: 'VayoTreasuryWallet...',
  },

  // Plug in any signer. Receives the partially-signed wire bytes (base64)
  // with Vayo's witness signature already attached, must return the
  // fully-signed wire bytes (base64) with the user authority added.
  signTransaction: async (serializedTxBase64) => {
    return await mySigner(serializedTxBase64)
  },
})

console.log(result.signature) // confirmed Solana signature
```

## Privy signer (one-liner)

For partners using Privy, the SDK ships an opt-in adapter at
`@vayo/core-sdk/mode-s/privy`. It bridges `@privy-io/node` to the
`signTransaction` callback so you don't have to write any signing code:

```ts
import { createVayoPartnerClient, U64_MAX, USDC_MINT } from '@vayo/core-sdk'
import { createPrivySigner } from '@vayo/core-sdk/mode-s/privy'
import { PrivyClient } from '@privy-io/node'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!,
})

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
})

const sign = createPrivySigner(privy, {
  walletId: userWalletId, // the user's Privy wallet id
  authorizationPrivateKeys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
})

const result = await vayo.modeS.redeem({
  privyDid: 'did:privy:cm...',
  marketAddress: 'H6...',
  tokenMint: USDC_MINT,
  amount: U64_MAX,
  signTransaction: sign,
  expectedFeeRecipients: {
    partnerPayoutAddress: 'YourPartnerPayoutWallet...',
    vayoTreasuryAddress: 'VayoTreasuryWallet...',
  },
})
```

`@privy-io/node` is declared as an **optional peer dependency** — install
it yourself only if you need the Privy adapter.

## Idempotency & retries

Every mutating partner v1 route requires an `Idempotency-Key` header. The
SDK auto-generates one (UUID v4) on each call by default. For safe retries,
pass your own stable key per logical operation:

```ts
const idemKey = crypto.randomUUID()
try {
  return await vayo.modeS.submitSignedRedeem({
    idempotencyKey: idemKey,
    body: { /* ... */ },
  })
} catch (networkError) {
  // Safe retry — Vayo replays the cached response if the original
  // call already succeeded server-side.
  return await vayo.modeS.submitSignedRedeem({
    idempotencyKey: idemKey,
    body: { /* ... */ },
  })
}
```

## Error handling

Non-2xx responses throw a structured `VayoApiError` with the API's
correlation id for log grepping:

```ts
import { VayoApiError } from '@vayo/core-sdk'

try {
  await vayo.modeS.submitSignedRedeem({ body })
} catch (err) {
  if (err instanceof VayoApiError) {
    console.error(`[vayo:${err.statusCode}] ${err.message} (${err.correlationId})`)
    if (err.statusCode === 403) {
      // market not in partner allowlist, JWT for wrong partner, etc.
    }
    if (err.statusCode === 429) {
      // rate limit — back off
    }
  }
  throw err
}
```

## Method reference

| Method | Route | Auth |
|---|---|---|
| `vayo.lending.markets()` | `GET /v1/lending/markets` | API key |
| `vayo.lending.reserves({ mints? })` | `GET /v1/lending/reserves` | API key |
| `vayo.modeS.buildRedeem({ body })` | `POST /v1/lending-operations/redeem-allocated/build` | API key |
| `vayo.modeS.submitSignedRedeem({ body })` | `POST /v1/lending-operations/redeem-allocated/submit` | API key |
| `vayo.modeS.redeem({ ... })` | (orchestrator) | API key |
| `vayo.payments.createOnramp({ body })` | `POST /onramp/` | API key |
| `vayo.payments.createOfframp({ body })` | `POST /offramp/` | API key |
| `vayo.payments.getOfframpStatus({ end2end })` | `GET /offramp/status/:end2end` | API key |
| `vayo.payments.paymentEvents({ type?, status?, limit?, offset? })` | `GET /payment-events/` | API key |
| `vayo.payments.transactions({ type?, status?, limit?, offset? })` | `GET /transactions/` | API key |
| `vayo.payments.prepareDeposit()` | `POST /transactions/prepare-deposit` | API key |
| `vayo.dashboard.overview()` | `GET /v1/dashboard/overview` | API key |
| `vayo.dashboard.users({ limit?, offset?, activeOnly? })` | `GET /v1/dashboard/users` | API key |
| `vayo.dashboard.transactions({ type?, status?, limit?, offset? })` | `GET /v1/dashboard/transactions` | API key |
| `vayo.dashboard.consumption()` | `GET /v1/dashboard/consumption` | API key |
| `vayo.dashboard.investmentPerformance()` | `GET /v1/dashboard/investment-performance` | API key |
| `vayo.dashboard.partnerFees()` | `GET /v1/dashboard/partner-fees` | API key |
| `vayo.dashboard.partnerFeesPayouts({ limit?, offset? })` | `GET /v1/dashboard/partner-fees/payouts` | API key |
| `vayo.dashboard.allowlist()` | `GET /v1/dashboard/allowlist` | API key |
| `vayo.dashboard.apiKeys()` | `GET /v1/dashboard/api-keys` | API key |
| `vayo.health.liveness()` | `GET /health` | (none) |
| `vayo.health.kora()` | `GET /health/kora` | (none) |
| `vayo.health.modeS()` | `GET /health/mode-s` | (none) |
| `vayo.health.ready()` | `GET /health/ready` | (none) |

## Custom fetch & runtime support

Works in Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge, and
browsers. Provide a custom `fetch` for instrumentation or older runtimes:

```ts
const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!,
  fetch: async (input, init) => {
    const start = Date.now()
    try {
      return await fetch(input, init)
    } finally {
      metrics.histogram('vayo.api.duration_ms', Date.now() - start)
    }
  },
})
```

## Going to production

Before flipping the switch:

- [ ] API key stored in your secrets manager (Vayo cannot recover it)
- [ ] `payoutWalletAddress` has an existing USDC ATA (validated at activation)
- [ ] You verified at least one redeem flow on staging end-to-end and inspected the on-chain `transferChecked` recipients
- [ ] `Idempotency-Key` is wired into your retry layer
- [ ] You catch `VayoApiError` and surface `correlationId` in your logs

## Optional: auto-rebalance proxy

Partners that want to authorize each rebalance redeem themselves (rather
than letting Vayo execute with cached credentials) can onboard a signing
proxy. Vayo HMAC-signs outbound requests to the partner's `rebalanceProxyUrl`,
the partner signs the wire bytes and submits on-chain, then reports the
result back via `POST /v1/rebalance/operations/:pendingOperationId/confirm`
authenticated with a scoped partner API key (`rebalance:operation:confirm`). See
[`docs-partners/guides/signing-modes.md`](../../docs-partners/guides/signing-modes.md)
and [`docs-partners/sdk/examples/rebalance-proxy.md`](../../docs-partners/sdk/examples/rebalance-proxy.md)
for the full contract. Partners without this configured have auto-rebalance
handled by Vayo directly.

## More documentation

- **Long-form quickstart** with curl examples: [`docs/quickstart.md`](./docs/quickstart.md)
- **Full OpenAPI 3.x spec** (regenerated from the live route definitions): [`openapi.json`](./openapi.json)
- **Postman collection** (mirrors the spec): [`docs/postman-collection.json`](./docs/postman-collection.json)
- **Mode S example** (uses this SDK): [`docs/examples/mode-s-redeem.ts`](./docs/examples/mode-s-redeem.ts)

## For AI coding assistants

This package ships two LLM-discovery files so AI coding assistants can integrate with Vayo without you copy-pasting docs into the chat:

- **[`SKILL.md`](./SKILL.md)** — A [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) that teaches Claude how to integrate with the Vayo Partner API/SDK end-to-end. Includes the method-group routing table, idempotency + error handling patterns, and the going-to-prod checklist. Drop the package into a Claude Code project and the skill auto-loads.
- **[`docs/llms.txt`](./docs/llms.txt)** — An [llmstxt.org](https://llmstxt.org/)-formatted index of every doc, example, and source file in the partner platform. Compatible with Cursor, Claude Code, ChatGPT, Cody, and any other AI assistant that understands the spec.

## License

[Apache License 2.0](./LICENSE) © Vayo Finance Labs.

Apache 2.0 includes an explicit patent grant (Section 3) — relevant for a
DeFi SDK where contributors and upstream projects may hold patents on
lending math, on-chain primitives, or SPL token flows. See
[`NOTICE`](./NOTICE) for the attribution notice that must accompany
redistributions.
