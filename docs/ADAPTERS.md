# Exchange adapters

Core code only sees `NormalizedTrader` records (`src/adapters/index.js`). Exchange-specific
ingestion lives behind an adapter, so scoring, API and UI never change when a connector is added.

## Status

| Adapter                                     | Status      | Notes                                                                                 |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `demo` (fixtures)                           | **demo**    | Synthetic, deterministic. Traders sit on fictional `demo-alpha/beta/gamma` exchanges. |
| Binance, Bybit, OKX, Bitget, BingX, Deribit | **planned** | Registered, return **no data**. Nothing about their APIs or terms is verified.        |

No live adapter exists. Do not describe any exchange integration as live until it is implemented,
tested against real responses, and its terms are cleared.

## Contract

An adapter exposes `exchange: { id, name, status, restrictions }` and
`listTraders({ now }) => Promise<NormalizedTrader[]>`. A record must carry `source.kind`
(`demo` | `verified_live` | `unverified_live`); `assertNormalizedTrader` rejects anything unlabeled.
Observations are `{ ts: ISO-8601, ret: simple period return }`. Never convert missing data to `0`.

## Checklist before enabling a live adapter

Document each item in the adapter's own file header **before** setting its status to `live`:

1. **Capabilities** — which of trader list, performance history, follower counts are available.
2. **Source and provenance** — official API vs. public page; set `source.kind` honestly.
3. **Authentication** — keys needed, scopes. Use read-only credentials only. CopyCart must never
   request or store trading permission or withdrawal permission, and secrets stay in the environment.
4. **Rate limits and retry** — documented limits, backoff, and what happens on 429/5xx.
5. **Pagination and history depth** — page size, cursor behaviour, how far back data goes.
6. **Error handling** — a failing adapter must degrade to "source unavailable", never to fake or
   stale data presented as fresh.
7. **Freshness** — expected update cadence; the scorer already penalises stale data.
8. **Terms** — whether public display, API redistribution and commercial use of the data are
   permitted. Do not scrape pages the terms forbid. Needs legal review (see `COMPLIANCE.md`).
9. **Outbound destination** — add the exchange's own domain to the allow-list in
   `src/analytics.js`; referral URLs must be https on that domain.
10. **Tests** — recorded real-response fixtures, clearly named as fixtures.
