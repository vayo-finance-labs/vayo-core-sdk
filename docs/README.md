# Vayo Finance Partner SDK & Documentation

Self-contained documentation package for partners integrating against the
Vayo Finance Partner API. This is what we hand to a new partner during
onboarding. **Vayo-internal admin endpoints are intentionally excluded** —
they live behind `adminGuard` and are not part of the partner contract.

## Contents

| File | What it is | Audience |
|---|---|---|
| **[`@vayo/core-sdk`](../README.md)** | **Official TypeScript SDK** — `bun add @vayo/core-sdk`. Typed client grouped by tag, opinionated `redeem()` orchestrator, optional Privy adapter sub-export. Zero runtime deps. | Partner engineers (TypeScript) |
| [`quickstart.md`](./quickstart.md) | 30-minute walkthrough — get provisioned, first auth, first supply, first redeem, going-to-prod checklist. SDK + curl examples side by side | Partner engineers, day 1 |
| [`../openapi.json`](../openapi.json) | **Generated** OpenAPI 3.x spec — partner v1 routes. Source of truth, regenerated from the live route definitions. Also feeds the SDK's kubb codegen | Partner engineers (codegen), QA |
| [`postman-collection.json`](./postman-collection.json) | Postman v2.1 collection mirroring `openapi.json` — pre-wired `x-api-key` auth, pre-request script that auto-generates `Idempotency-Key`, and a `/build → /submit` redeem chain that stashes `pendingRedeemId` between requests | QA, partner engineers debugging integrations |
| [`examples/mode-s-redeem.ts`](./examples/mode-s-redeem.ts) | Runnable TypeScript example of the `/build` + sign + `/submit` redeem flow built on `@vayo/core-sdk` + `@vayo/core-sdk/mode-s/privy`. ~70 lines including all error handling | Partner engineers |
| [`llms.txt`](./llms.txt) | LLM-friendly index of every doc, example, and source file in this directory — follows the [llmstxt.org](https://llmstxt.org/) spec. Drop into Cursor / Claude / ChatGPT / any AI coding assistant so it can find the right reference instantly | AI coding assistants |
| [`../SKILL.md`](../SKILL.md) | Claude Code skill that teaches an AI assistant how to integrate with the Vayo Partner API/SDK end-to-end — when to use which method, and the going-to-prod checklist | Claude Code users |

## Routes

Partner v1 routes, grouped by OpenAPI tag:

- **Partner v1 — Auth** — `POST /v1/auth/callback`, `GET /v1/auth/me`
- **Partner v1 — Wallets** — `GET /v1/agent-wallets/me`
- **Partner v1 — Lending read** — `/v1/lending/markets`, `/v1/lending/reserves`, `/v1/dashboard/allowlist`
- **Partner v1 — Lending Operations** — `supply-allocated`, `redeem-allocated/build`, `redeem-allocated/submit` (partners sign the redeem locally)
- **Partner v1 — Dashboard** — `overview`, `users`, `transactions`, `consumption`, `investment-performance`, `performance-fees`, `partner-fees`, `partner-fees/payouts`, `api-keys`
- **Health** — `GET /health/mode-s`


## Using the SDK in your own project

The official SDK is the easiest way to integrate. It's built from this same
spec via Kubb and adds an ergonomic typed client + Mode S orchestrator on
top:

```bash
bun add @vayo/core-sdk
# or: npm install @vayo/core-sdk
```

```ts
import { createVayoPartnerClient, USDC_MINT } from '@vayo/core-sdk'

const vayo = createVayoPartnerClient({
  baseUrl: 'https://api.vayo.finance',
  apiKey: process.env.VAYO_API_KEY!,
})

const overview = await vayo.dashboard.overview()
```

Full method reference, the redeem walkthrough, and the optional Privy
adapter docs live in [the SDK README](../README.md).

## How to use the spec for codegen (advanced)

Partners building non-TypeScript clients (or wanting their own typed
wrapper) can drop `openapi.json` into any OpenAPI codegen tool. After
`bun add @vayo/core-sdk`, the spec is available at
`node_modules/@vayo/core-sdk/openapi.json`:

```bash
# typed fetch client
npx openapi-typescript ./node_modules/@vayo/core-sdk/openapi.json -o partner-types.ts

# Java/Kotlin/Go/etc.
npx @openapitools/openapi-generator-cli generate \
  -i ./node_modules/@vayo/core-sdk/openapi.json \
  -g typescript-fetch \
  -o ./gen
```

For long-running production integrations, prefer pinning the spec to a
tagged release of `@vayo/core-sdk` rather than tracking `latest`.
