# Changelog

All notable changes to `@vayolabs/core-sdk` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-04-10

Initial public release.

### Added

- **`createVayoPartnerClient(options)`** — ergonomic typed client grouped by
  OpenAPI tag. Auto-injects `x-api-key` and `Idempotency-Key` headers,
  forwards `Authorization: Bearer <jwt>` per call where required, throws
  structured `VayoApiError` on non-2xx.
- **20 routes covered** across 7 method groups:
  `auth.callback`, `auth.me`, `wallets.me`, `lending.markets`,
  `lending.reserves`, `lendingOperations.supplyAllocated`,
  `lendingOperations.redeemAllocated`, `modeS.buildRedeem`,
  `modeS.submitSignedRedeem`, `dashboard.{overview, users, transactions,
  consumption, investmentPerformance, performanceFees, partnerFees,
  partnerFeesPayouts, allowlist, apiKeys}`, `health.modeS`.
- **`client.modeS.redeem()`** — opinionated Mode S orchestrator that runs
  the full `/build → verify-fee-recipients → sign → /submit` flow with a
  pluggable `signTransaction` callback. Optional direct-RPC fallback when
  `/submit` fails.
- **`assertFeeRecipientsMatch()`** — exported Defense-3 mirror so partners
  can verify fee recipients independently of the orchestrator.
- **`@vayolabs/core-sdk/mode-s/privy`** sub-export with
  `createPrivySigner(privy, { walletId, authorizationPrivateKeys? })` for
  Privy users. `@privy-io/node` is an **optional peer dep** — non-Privy
  partners pay zero install cost.
- **`@vayolabs/core-sdk/generated`** sub-export exposing the raw kubb
  client functions for advanced users who want lower-level access.
- **`VayoApiError`** with `statusCode`, `code`, `correlationId` for log
  grepping.
- **Custom `fetch` override** in `createVayoPartnerClient` for
  instrumentation, edge runtimes, and Node < 18 polyfills.
- **`U64_MAX`** and **`USDC_MINT`** constants for Mode S full redeems and
  the canonical Solana USDC mint.
- **22 unit tests** covering happy paths, error envelope parsing, fee
  recipient verification (including missing-partner / missing-treasury /
  attacker-injection cases), Mode S orchestrator (build → sign → submit),
  and the direct-RPC fallback path. All tests run via `bun test` with no
  network, no DB, no Privy.
- **Dual ESM + CJS build** via tsup with `.d.ts` and source maps for both
  formats. ESM bundle ~21 KB, CJS ~21 KB.
- **Zero runtime dependencies** in the main bundle.

### Coverage notes

- Spec is generated from
  `apps/api/src/scripts/export-partner-openapi.ts` → `docs/core-sdk/openapi.json`.
  Re-run `bun run gen` from `packages/core-sdk` to refresh after API changes.
- Response shapes for `modeS.buildRedeem` and `modeS.submitSignedRedeem`
  are typed by hand (`BuildRedeemResponse`, `SubmitSignedRedeemResponse`)
  because Elysia's auto-generated swagger doesn't capture response schemas.
  All other response types fall back to `unknown` until the API adds
  TypeBox response validators.
- Mode S `?gasless=true` (Kora cosigning) is **not** yet supported — the
  API returns `501 Not Implemented` for that flag.
