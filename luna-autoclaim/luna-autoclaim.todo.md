luna-autoclaim/luna-autoclaim.todo.md

Claim Pipeline Completeness

- Epic redemption flawless.
- Only one direct Luna game available so far, so direct-claim behavior is hard to evaluate.
- GOG stops after exposing the keys, by design since 0.12.0 — the user redeems on gog.com by hand (GOG User Agreement §11.1(e) bans scripts interacting with GOG services; see archive/gog-redeem/REPORT.md).
- Legacy Games stops after exposing keys. Recoverable state. Will not be pursuing development actively. If support is wanted, submit a request or PR for review.

- Rate-limit testing still needed to confirm whether autoclaiming hits notable limits.

Listing Store Filter (0.8.0)

- "Open All" / "Auto Claim All" now resolve each entry's store on the listing (p[title] inside the entry's .item-card-details, matched against STORE_PATTERNS) and don't open entries whose store is set to Skip. The status line shows opened · skipped · store-unknown counts.
- UNVERIFIED against live markup: no capture of the /claims/home listing exists yet. It is not known whether a listing card exposes the "on <Store>" p[title] label at all. If it doesn't, every entry reports "store unknown" and is still opened, with the toggle enforced on the claim page as before. Nothing is guessed from the game name.
- TODO: capture a live listing (a card for each store) into luna-autoclaim.dev.resources/ and confirm or fix getListingStore()'s selector.
- TODO: if the listing doesn't expose the store, fall back to open-then-close (depends on the tab-closing task).
- TODO (decision pending): Amazon Games entries finish on Luna with no key to redeem. Before deciding whether they should be opened as claim pages at all, confirm the behaviour on a live listing. For now they follow the normal Amazon Games toggle.

GOG Handoff — same tab, follow "Claim code" (0.9.0) — WITHDRAWN in 0.12.0 except the same-tab claim click

- A GOG claim now stays in the claim tab: the claim click drops any target="_blank" on the button's anchor and, for 10s, turns the page's window.open() into a same-tab navigation (needs @grant unsafeWindow; exportFunction on Firefox).
- A per-tab sessionStorage flag (lac_gog_handoff_v1, 2 min TTL) marks the tab as mid-GOG-claim, so the flow resumes after Luna navigates the tab, whatever route exposes the key.
- The script then waits up to 20s for the "Claim code" target: first any <a> whose href is https://www.gog.com/redeem/<game_key>, else an element whose text is "Claim code" (clicked in the same tab; a GOG URL it opens is taken over). It navigates this tab to the redeem URL. No link → red status "finish on this page", nothing else happens.
- UNVERIFIED ordering: no live capture of the Luna GOG claim/key page exists in luna-autoclaim.dev.resources/ yet. It is not known whether the "Claim code" href is in the DOM before the key is revealed, or only after. The watcher polls after the claim click, so either ordering works — but if the href exists *before* the claim (e.g. rendered hidden), the handoff could fire before Luna has registered the claim. TODO: capture the DOOM + DOOM II claim page before and after the claim click and record which it is.
- UNVERIFIED mechanism: which of target="_blank" or window.open() Luna uses to open the second claim page. If it's neither (e.g. a form target), the original tab still opens a second one — capture and check.

GOG Redemption on gog.com — Continue, then Redeem (0.10.0) — WITHDRAWN in 0.12.0 (archive/gog-redeem)

- Adds @match https://www.gog.com/* (both .user.js and .meta.js) plus GM_getValue/GM_setValue/GM_deleteValue.
- Carrier decision: the key travels in the redeem URL itself (/redeem/<game_key>); no extra URL param is added to GOG's URL. Permission to act travels in GM storage: the Luna side writes lac_gog_pending_v1:<KEY> just before navigating. The gog.com side does nothing on any page unless that exact key has a fresh entry (10 min TTL), so browsing GOG by hand is never touched and the update check doesn't run there.
- Flow: wait (≤20s) for a single visible "Continue" → refuse if a prefilled input holds a different code → click → wait (≤20s) until Continue is gone, the page reads "You are about to redeem", and there's exactly one visible "Redeem" → Redeem.
- Exactly-once: the entry is stamped stage "redeem-clicked" *before* Redeem is clicked, and a stamped entry is never clicked again (reload, second tab, double click on the panel button). The entry is deleted only after GOG's Redeem button goes away. Every unexpected state stops with a red status; nothing retries.
- Open question answered with a setting: home panel → Stores → "GOG final Redeem": "Ask first" (default — stops on the confirmation page with a "✔ Redeem on GOG" panel button) or "Automatic". Stored in GM storage so gog.com can read it.
- UNVERIFIED: selectors are from the user's two screenshots, not a DOM capture. TODO: capture both GOG pages into luna-autoclaim.dev.resources/. Check in particular that (a) the key stays in the path after GOG loads (a redirect to a locale prefix is handled; a redirect that drops the key is not — the script then stays silent), (b) the buttons' textContent is exactly "Continue" / "Redeem", (c) the confirmation copy contains "You are about to redeem", (d) what GOG shows after Redeem (success vs. "code already used") so a success check can replace "button went away".

Claim Verification (0.10.1)

- claimCurrentGame() no longer sleeps and reports "Claim submitted". After the click it polls (250ms, ≤15s) for a signal and reports one of: "✓ Claimed — <signal>" (green) or "⚠ Claim not confirmed: <reason>. Reload and check." (red). A failure never closes or navigates the tab, and a GOG claim that isn't confirmed is not handed off to gog.com.
- Signals: error = a new (not present before the click) [role=alert|alertdialog|dialog]/[aria-live] notice or a changed claim-button label reading like an error; success = the claim button's label changes to "Claimed"/"Redeemed", a new notice says so, or (GOG) the Claim code link appears. Nothing else counts, so an unknown success signal shows up as "not confirmed" — the safe direction.
- UNVERIFIED: no before/after capture of a successful claim, or of the error popup a too-short redeem delay produces, exists in luna-autoclaim.dev.resources/. TODO: capture both and tighten CLAIM_SUCCESS_RE / CLAIM_ERROR_RE and the notice selectors to what Luna really renders. Until then expect some real successes to read "not confirmed" (with the button's new label shown so they're easy to spot).
- Both entry points share claimCurrentGame(), so the ?lac_autoclaim=1 handoff and the panel's Claim button report identically. The result is also prefixed onto the tab title (✓ / ⚠) so Auto Claim All's background tabs can be triaged from the tab strip.
- Is the panel status line enough once tabs can auto-close? No. It lives and dies with the claim tab, so an auto-closed tab takes its result with it. Before auto-closing claim tabs: write each result to GM storage (per claim, with game + reason) and have the home panel read and summarise them (e.g. "8 claimed · 1 not confirmed — open"), and only close tabs whose result was ✓.

Microsoft Store + Refuse Unknown Stores (0.11.0)

- Microsoft Store added to KNOWN_STORES (so it gets a Claim/Skip toggle automatically) and STORE_PATTERNS as "on Microsoft Store".
- UNVERIFIED: "on Microsoft Store" is a guess — no live capture of a Microsoft Store claim page exists. TODO: capture the DOOM + DOOM II (Windows logo) claim page into luna-autoclaim.dev.resources/ and fix the pattern to the exact p[title] Luna renders. A wrong guess no longer claims anything: it shows up as "Store: not recognised (saw "on <whatever>")", which is also the quickest way to read the real string off a live page.
- Hard stop: claimRefusal() blocks a null store (and a Skip store) on both the ?lac_autoclaim=1 path and the panel's Claim button, re-checked at click time. The claim page panel shows "Store: <name>" or "Store: not recognised (saw …)" and, for an unknown store, no Claim button and a red status — so "unknown" and "detected but set to Skip" read differently.
- Listing: entries with an unknown store are still opened (the listing's store label is itself unverified); the claim page then refuses them.
- Out of scope, for a follow-up: like GOG, a Microsoft Store key is redeemed off-site (microsoft.com / redeem.microsoft.com). Claiming it on Luna exposes the key and stops there; a full Microsoft flow needs its own handoff task.

GOG Walk-back (0.12.0)

- Removed: the handoff to gog.com (sessionStorage flag, following "Claim code"), the gog.com Continue/Redeem clicker, the "GOG final Redeem" setting, @match www.gog.com and the GM_getValue/GM_setValue/GM_deleteValue grants. Leftover lac_gog_* GM values from earlier versions are harmless and never read.
- Kept: the same-tab claim click (Luna-side only) so the claim can still be verified; the "Claim code" link is read as the success signal, never followed.
- Pending: ask GOG support whether a one-action-per-click helper is acceptable.
- Pending: confirm the Amazon Luna Terms of Use wording on automated access ("robots").
