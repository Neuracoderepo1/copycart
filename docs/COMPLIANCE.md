# Compliance and trust notes

This is an engineering checklist, **not legal advice**. Adding a disclaimer does not make a product
compliant. The items below need review by qualified legal and compliance advisers for the intended
jurisdictions before any public launch, live data, or commercial arrangement.

## Needs specialist review

- **Data licensing** — rights to display, cache, score and redistribute each exchange's data,
  including through the commercial API. Public availability does not imply a licence.
- **Exchange terms** — API terms, scraping restrictions, branding and trademark use.
- **Financial promotions** — rankings, scores and "discover traders" copy can be regulated
  promotion or advice in some jurisdictions (including UK/EU/US regimes). Jurisdiction and audience
  are undecided.
- **Affiliate disclosure** — if referral codes are configured (`REFERRAL_URL_<EXCHANGE>`), clear
  disclosure of commissions is required next to the outbound link. None is configured now and the UI
  carries no such disclosure yet; add it before enabling any.
- **Privacy** — the app stores no IPs, cookies, user agents, or search text. Analytics events hold
  only ids, enumerated filters, sanitised UTM values and a timestamp. Confirm whether this still
  counts as personal data in target jurisdictions and whether consent notices are needed. The page
  loads Google Fonts, which sends visitor IPs to a third party; self-host fonts or obtain consent.
- **Scoring claims** — weights are provisional and unvalidated. Do not market the score as
  predictive, "AI", or "verified" until backtested and independently reviewed.
- **Anomaly flags** — flags are statistical prompts. Any public accusation of wash trading or fraud
  requires evidence and legal review.

## Implemented controls (verified by tests)

- Outbound redirects only reach allow-listed https exchange domains; look-alike and credentialed
  URLs are refused; synthetic traders have no outbound destination.
- Clicks are recorded as clicks only. No registration or conversion is reported until verified
  partner data exists (`conversions: null`).
- Privileged endpoints require an API key (SHA-256 hashes in env, constant-time compare); access
  and denials are audit-logged without keys or addresses.
- Input validation on all query/body fields; body size cap; per-client rate limits; security
  headers including a strict CSP.

## Known gaps

- Analytics and audit entries live in memory/stdout only. They reset on restart.
- No dependency audit was run (registry unreachable in the build sandbox); the app has no runtime
  dependencies, but dev tooling should be audited when installed.
- No penetration test and no accessibility audit. Only desktop and mobile viewport rendering was
  checked in a browser; keyboard navigation and screen-reader behaviour were not tested.
