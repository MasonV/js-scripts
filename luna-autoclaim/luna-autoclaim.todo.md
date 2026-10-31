luna-autoclaim/luna-autoclaim.todo.md

One-Tab-Per-Click Claim Opening (0.12.0)

- Removed "Auto Claim All" and all automated claim/redeem clicking on Luna and GOG (per Amazon Conditions of Use Agents clause, Luna ToU s6a/s7a, Steam Subscriber Agreement s4.C, and GOG User Agreement s11.1(e)).
- Replaced bulk "Open All" with per-click "Open Next": each click opens one eligible claim page in a background tab and updates progress ("Opened 3 of 12"), while the user clicks Claim themselves on the claim page.

Listing Store Filter (0.8.0+)

- "Open Next" resolves each entry's store on the listing (p[title] inside the entry's .item-card-details, matched against STORE_PATTERNS) and skips entries whose store is set to Skip. The status line shows opened · skipped · store-unknown counts.
- UNVERIFIED against live markup: no capture of the /claims/home listing exists yet. It is not known whether a listing card exposes the "on <Store>" p[title] label at all. If it doesn't, every entry reports "store unknown" and is still opened so the user can check the claim page. Nothing is guessed from the game name.
- TODO: capture a live listing (a card for each store) into luna-autoclaim.dev.resources/ and confirm or fix getListingStore()'s selector.

Microsoft Store Detection (0.11.0+)

- Microsoft Store is in KNOWN_STORES (with a Claim/Skip toggle) and STORE_PATTERNS as "on Microsoft Store".
- UNVERIFIED: "on Microsoft Store" is unconfirmed against a live Microsoft Store claim page capture. Unrecognised stores are shown in the claim-page panel as "Store: not recognised (saw "on <whatever>")".
