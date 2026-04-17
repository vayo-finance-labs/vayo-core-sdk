# Security Policy

`@vayo/core-sdk` is part of Vayo Finance's production integration surface
for partners moving real USDC on Solana mainnet. We take security reports
seriously — thank you for helping keep partners and their users safe.

## Scope

**In scope for this repository:**

- Bugs in the `@vayo/core-sdk` npm package that could cause partners to
  sign incorrect transactions, expose API keys, leak user JWTs, bypass the
  Defense-3 fee recipient verification, or otherwise compromise funds or
  credentials.
- Supply-chain concerns affecting this package (typosquatting, compromised
  dependencies, unauthorized maintainer access).
- Issues in the Mode S `redeem()` orchestrator, the Privy signer adapter,
  the fetch wrapper (`src/http.ts`), the error envelope (`src/errors.ts`),
  and the kubb-generated client code.
- Documentation that could mislead a partner into an insecure integration.

**Out of scope for this repository — report via other channels:**

- Vulnerabilities in the Vayo Partner API itself (server-side bugs, auth
  bypass, rate-limit bypass, fee math errors, Kamino integration flaws,
  on-chain Defense-1/2/3/4 weaknesses). → **security@vayo.finance**
- Vulnerabilities in first-party Vayo applications (`app.vayo.finance`,
  admin panel, mobile app). → **security@vayo.finance**
- Vulnerabilities in upstream dependencies (`@privy-io/node`, `@solana/kit`,
  Kamino SDK). → Report directly to the respective maintainers, then
  notify us so we can pin a safe version.

If you are not sure whether an issue is in scope here or in the broader
Vayo platform, send it to **security@vayo.finance** and we will route it.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.** Please use one of
these channels:

1. **Preferred — GitHub Private Security Advisory**
   [Open a new security advisory](https://github.com/vayo-finance-labs/vayo-core-sdk/security/advisories/new)
   on the public mirror repository. This gives you a private collaboration
   space with the maintainers.

2. **Email — security@vayo.finance**
   Encrypt with our PGP key if the report contains exploitable details.
   PGP fingerprint and key are published at
   [https://vayo.finance/.well-known/security.txt](https://vayo.finance/.well-known/security.txt).

Please include:

- A clear description of the issue and the affected file(s) / function(s)
- Reproduction steps or a minimal proof-of-concept
- Your assessment of the impact (e.g. "enables fee-bypass for Mode S partners",
  "leaks API key into telemetry", "allows SSRF via custom fetch")
- Your name / handle / GitHub account if you want public credit after fix
- Whether you plan to disclose publicly, and on what timeline

**Do not include the exploit details in any public channel** (GitHub
issues, Discord, Twitter/X, etc.) until we have coordinated a fix and
disclosure window.

## Response timeline

| Stage | SLA |
|---|---|
| Acknowledgement of receipt | Within **2 business days** |
| Initial severity assessment + triage | Within **5 business days** |
| Fix or mitigation for confirmed critical issues | Within **14 calendar days** |
| Public disclosure (coordinated) | Up to **90 days** after the initial report, or sooner if a fix is live and widely deployed |

We follow a **90-day coordinated disclosure** model by default, aligned
with industry standard practice (Google Project Zero / CERT/CC). If a fix
ships before 90 days and enough partners have upgraded, we will disclose
earlier. If a fix requires longer than 90 days (e.g. a coordinated on-chain
migration), we will negotiate an extension with the reporter.

## What to expect from us

- We acknowledge every valid report and keep the reporter updated at least
  weekly until a fix ships.
- We credit reporters in the CVE advisory, `CHANGELOG.md`, and the
  corresponding GitHub Security Advisory — unless you request anonymity.
- For high-severity reports that directly affect partner or user funds, we
  will push out an emergency release and notify all known partners via our
  partner mailing list.
- We do **not** currently run a paid bug bounty program for the SDK, but
  we will send Vayo swag and a public thank-you to valid reporters. If the
  scope changes, this policy will be updated.

## Safe harbor

Vayo Finance Labs supports good-faith security research. We will not
pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction,
  and interruption or degradation of our services
- Only interact with accounts they own or have explicit permission to
  access (including testnet / devnet wallets)
- Do not exploit a vulnerability beyond the minimum necessary to
  demonstrate it
- Give us reasonable time to investigate and mitigate before public
  disclosure
- Do not engage in social engineering, phishing, or physical attacks
  against Vayo Finance Labs employees or infrastructure

Reports that meet the above criteria are covered by this safe harbor. If
you have any uncertainty about whether your research is within scope,
contact **security@vayo.finance** before you start.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ Active — security fixes + feature updates |
| < 0.1.0 | ❌ Not published |

Only the latest minor version is supported for security patches during
the 0.x series. Once the SDK reaches 1.0, we will support the current
major and the previous major for at least 12 months.

## Dependency security

The SDK has **zero runtime dependencies** to minimize supply-chain risk.
The optional Privy signer adapter (`@vayo/core-sdk/mode-s/privy`) loads
`@privy-io/node` only when imported — non-Privy partners are not exposed
to that dependency at all.

We monitor the SDK's dev dependencies via:

- GitHub Dependabot alerts on the public mirror
- Regular `bun pm untrusted` checks during release prep
- Pinning of the Kubb toolchain version across the monorepo

If you discover a compromised version of any dependency we use, please
treat it as an in-scope report and contact us immediately.
