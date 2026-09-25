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

GOG Handoff — same tab, follow "Claim code" (0.9.0)

- A GOG claim now stays in the claim tab: the claim click drops any target="_blank" on the button's anchor and, for 10s, turns the page's window.open() into a same-tab navigation (needs @grant unsafeWindow; exportFunction on Firefox).
- A per-tab sessionStorage flag (lac_gog_handoff_v1, 2 min TTL) marks the tab as mid-GOG-claim, so the flow resumes after Luna navigates the tab, whatever route exposes the key.
- The script then waits up to 20s for the "Claim code" target: first any <a> whose href is https://www.gog.com/redeem/<game_key>, else an element whose text is "Claim code" (clicked in the same tab; a GOG URL it opens is taken over). It navigates this tab to the redeem URL. No link → red status "finish on this page", nothing else happens.
- UNVERIFIED ordering: no live capture of the Luna GOG claim/key page exists in luna-autoclaim.dev.resources/ yet. It is not known whether the "Claim code" href is in the DOM before the key is revealed, or only after. The watcher polls after the claim click, so either ordering works — but if the href exists *before* the claim (e.g. rendered hidden), the handoff could fire before Luna has registered the claim. TODO: capture the DOOM + DOOM II claim page before and after the claim click and record which it is.
- UNVERIFIED mechanism: which of target="_blank" or window.open() Luna uses to open the second claim page. If it's neither (e.g. a form target), the original tab still opens a second one — capture and check.
