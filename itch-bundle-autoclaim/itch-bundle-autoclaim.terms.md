# itch.io terms review for itch-bundle-autoclaim

This is documentation, not legal advice. Text was copied by the repo owner from
itch.io and read on 2026-10-23.

- Source: itch.io Terms of Service, https://itch.io/docs/legal/terms
  (URL not captured in the pasted text; confirm when next visiting)
- Version: "Updated April 15 2023" (payment-processor link change only)
- Evidence: first-hand, owner-copied from itch.io

## Relevant clauses

| Clause | Wording | Bearing on this script |
| --- | --- | --- |
| §3 Acceptable Use (intro) | Content or actions that, "in the Company's sole discretion, degrades the experience of others may result in account termination without prior notice." The listed prohibited actions are "not limited to" the list. | Termination is discretionary and needs no notice, so keep load low. |
| §3 | "Hacking, maliciously manipulating, or misrepresenting itch.io's interface in any way" | The script submits the same form the Claim button submits; it does not forge or bypass anything. Not malicious manipulation on a plain reading. |
| §3 | "Uploading viruses or malicious code or acting in any manner to restrict or inhibit any other user from using and enjoying the Service" | Stay paced; do not hammer the server (see follow-up). |
| §3 | "Soliciting, harvesting or collecting information about others" | Not applicable: the script touches only the user's own bundle claims. |
| §8 | "Use of IP proxies or other methods to disguise your place of residence, whether to circumvent geographic restrictions … is a violation" | Not related to the script; do not run it through a VPN to change region pricing or availability. |
| §13 | Accounts "may not be transferred, sold, or assigned to a third party". | Not applicable. |
| §18 | Terms may change "at any time and without notice". | Re-check periodically. |

## Not present

No clause mentions bots, scripts, automation, macros, scraping, or rate limits.
The Privacy Policy and "other legal notices" (§18) were not reviewed.

## Verdict

Scripted claiming of the user's own bundle entitlements is not prohibited by the
text as read. The script POSTs the same form as the Claim button, one request
per game, 400 ms apart (`CLAIM_DELAY_MS`), then pauses 1500 ms before paging
(`NAV_DELAY_MS`). That is human-scale, low volume, and acts only on the user's
own account.

Residual risk is the discretionary-termination wording in §3, which is why the
script should stop on errors instead of continuing to send requests (see task
below). Unlike Luna/Steam/GOG, no automation clause exists, so no removal is
recommended.
