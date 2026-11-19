# Store terms review for fanatical-autoclaim

This is documentation, not legal advice. Text was copied by the repo owner from
Fanatical and Steam and read on 2026-10-03 and 2026-10-23 (audits `Tb42eac6a`,
`Tc17f3e0a`, and `T9f846ac1`).

## Sources

- Fanatical Terms & Conditions: `https://www.fanatical.com/en/terms-and-conditions`
  (read 2026-10-03; re-checked 2026-10-23)
- Steam Subscriber Agreement: `https://store.steampowered.com/subscriber_agreement/`
  (Section 4.C, read 2026-10-23)

## Relevant clauses

### Fanatical Terms & Conditions (read 2026-10-03 / 2026-10-23)

Fanatical's Terms & Conditions govern account usage, order purchase, and key
delivery to the purchasing account holder. The terms read on 2026-10-03 contain
no bot or script prohibition clause forbidding an authenticated user from
revealing keys on their own purchased order page. General service-integrity and
acceptable-use expectations still apply: automated bursts without pacing or
error handling can degrade the service or trip rate limiting.

### Steam Subscriber Agreement — Section 4.C (read 2026-10-23)

> You may not use Cheats, automation software (bots), mods, hacks, or any other
> unauthorized third-party software, to modify or automate any Subscription
> Marketplace process, the process of Steam account creation or otherwise in
> interacting with or controlling the processes or user interface of Steam,
> except to the degree expressly permitted.

In addition, Steam enforces an activation rate limit (unofficial cooldown lockout
after repeated key activation attempts in a short window).

## What this means for `fanatical-autoclaim`

| Clause / constraint | Script behaviour |
| --- | --- |
| Steam Subscriber Agreement s4.C (no bots, scripts, or macros automating Steam processes) | Bulk **Redeem All** (`redeemAllOnSteam`) and **Reveal + Redeem All** (`revealAndRedeem`) were removed in v1.5.0 (`T9f846ac1`). **Redeem Next** opens at most one `https://store.steampowered.com/account/registerkey?key=...` tab per direct human click (`Opened X of Y`). No userscript code executes on `store.steampowered.com` (`@match` is limited to `https://www.fanatical.com/*`), and the user confirms each activation on Steam manually. |
| Fanatical order-page key reveal (`Reveal All`) & repo Third-Party Services standard | **Reveal All** only clicks Fanatical's own Reveal buttons on the user's authenticated order page, enforces a minimum delay cap between clicks, verifies that each click reveals a key before advancing, backs off exponentially on failure, halting loudly after consecutive failures, and aborts if the panel is closed or the page navigates away. |
