luna-autoclaim/luna-autoclaim.todo.md

Claim Pipeline Completeness

- Epic redemption flawless.
- Only one direct Luna game available so far, so direct-claim behavior is hard to evaluate.
- GOG stops after exposing the keys. Recoverable state. New step needed to redeem key on GOG site.
- Legacy Games stops after exposing keys. Recoverable state. Will not be pursuing development actively. If support is wanted, submit a request or PR for review.

- Rate-limit testing still needed to confirm whether autoclaiming hits notable limits.

Listing Store Filter (0.8.0)

- "Open All" / "Auto Claim All" now resolve each entry's store on the listing (p[title] inside the entry's .item-card-details, matched against STORE_PATTERNS) and don't open entries whose store is set to Skip. The status line shows opened · skipped · store-unknown counts.
- UNVERIFIED against live markup: no capture of the /claims/home listing exists yet. It is not known whether a listing card exposes the "on <Store>" p[title] label at all. If it doesn't, every entry reports "store unknown" and is still opened, with the toggle enforced on the claim page as before. Nothing is guessed from the game name.
- TODO: capture a live listing (a card for each store) into luna-autoclaim.dev.resources/ and confirm or fix getListingStore()'s selector.
- TODO: if the listing doesn't expose the store, fall back to open-then-close (depends on the tab-closing task).
- TODO (decision pending): Amazon Games entries finish on Luna with no key to redeem. Before deciding whether they should be opened as claim pages at all, confirm the behaviour on a live listing. For now they follow the normal Amazon Games toggle.
