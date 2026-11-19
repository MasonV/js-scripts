# Store terms review for luna-autoclaim

This is documentation, not legal advice. Text was copied by the repo owner from
Amazon, Amazon Luna, Steam, and GOG and read first-hand on 2026-10-23 (Blip
`docs/key-vault-terms.md`, PR #237, tasks `Tc17f3e0a` and `T581014ef`).

## Sources

- Amazon Conditions of Use: `https://www.amazon.com/gp/help/customer/display.html?nodeId=GLSBYFE9MGKKQXXM`
  ("Agents" section and License and Access, read 2026-10-23)
- Amazon Luna Terms of Use: `https://www.amazon.com/gp/help/customer/display.html?nodeId=G233673895679698`
  (Sections 6a and 7a, read 2026-10-23)
- Steam Subscriber Agreement: `https://store.steampowered.com/subscriber_agreement/`
  (Section 4.C, read 2026-10-23)
- GOG User Agreement: `https://support.gog.com/hc/en-us/articles/212632089-User-Agreement`
  (Section 11.1(e), read 2026-10-23)

## Relevant clauses

### Amazon Conditions of Use — Agents / License and Access (read 2026-10-23)

Amazon's Conditions of Use ("Agents" clause) require automated agents acting on
Amazon properties to identify themselves with `Agent/<name>` in the HTTP
User-Agent header, forbid mimicking human pacing or disguising automated
traffic, and prohibit bypassing technical controls or acting without direct
human initiation. A browser userscript running inside the user's normal browser
session cannot set a custom `Agent/<name>` User-Agent on page navigation and
cannot satisfy the automated-agent requirements for unattended claiming.

### Amazon Luna Terms of Use — Sections 6a and 7a (read 2026-10-23)

Sections 6a and 7a incorporate the Amazon Conditions of Use and specify that
violations of the terms or unauthorized use of the service can result in
termination or suspension of Luna access as well as broader Amazon and linked
Twitch account privileges.

### Steam Subscriber Agreement — Section 4.C (read 2026-10-23)

> You may not use Cheats, automation software (bots), mods, hacks, or any other
> unauthorized third-party software, to modify or automate any Subscription
> Marketplace process, the process of Steam account creation or otherwise in
> interacting with or controlling the processes or user interface of Steam,
> except to the degree expressly permitted.

### GOG User Agreement — Section 11.1(e) (read 2026-10-23)

> You agree not to [...] use any automation software (bots), hacks, mods or any
> other unauthorized third-party software designed to modify the GOG services
> or any GOG game experience.

## What this means for `luna-autoclaim`

| Clause / constraint | Script behaviour |
| --- | --- |
| Amazon Conditions of Use ("Agents" section) & Luna ToU s6a/s7a | **Auto Claim All**, the `?lac_autoclaim=1` cross-tab parameter, and automated `claimCurrentGame()` CTA clicking on individual claim pages were removed in v0.12.0 (`T581014ef`). |
| GOG User Agreement s11.1(e) & Steam Subscriber Agreement s4.C | Automated GOG redemption handoff (`gog-redeem` block and `@match https://www.gog.com/*`) was removed in v0.12.0 (`T581014ef`), and the unused `tools/blocks/gog-redeem.template.js` template was deleted (`T74b7050b`). No code runs on GOG, Steam, or Epic store pages. |
| Human-in-the-loop tab opening (`T1883f1bf`) | On `/claims/home`, **Open Next** opens at most one claim page tab per direct human click. Every claim and external store redemption action requires the user's own click on the destination page. |
