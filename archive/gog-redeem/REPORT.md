# GOG Redeem — withdrawn

Shared block that finished a GOG key on gog.com: the store side (Luna Autoclaim) navigated the tab to `https://www.gog.com/redeem/<key>`, then the gog.com side clicked **Continue** and, after asking (default) or automatically, **Redeem** exactly once.

Shipped in Luna Autoclaim 0.9.0 (handoff) and 0.10.0 (gog.com side), extracted to a shared block in 0.11.1, withdrawn in 0.12.0.

## Why it was withdrawn

GOG User Agreement §11.1(e) prohibits creating or using "cheats, exploits, automation software, robots, bots, mods, hacks, spiders, spyware, cheats, scripts, trainers, extraction tools or other software that interact with or affect GOG services or GOG content in any way". Clicking GOG's own Continue/Redeem buttons is a script interacting with GOG services, even in "Ask first" mode. Automatically navigating to the redeem page after a Luna claim is a second action nobody clicked for, so that went too.

Luna Autoclaim now stops on Luna once the key and its "Claim code" link are shown; the user follows the link and redeems by hand.

The wording above was taken from secondary sources quoting the agreement, not read from gog.com directly. Revisit if GOG confirms in writing that a one-action-per-click helper is acceptable.

## Reviving it

The template is unchanged from its last shipped state. To restore: move it back to `tools/blocks/`, re-register it in `BLOCKS` in `tools/sync-blocks.mjs`, restore its tests and CLAUDE.md table row from git history (commit 516395c), and re-add the Luna-side handoff (`git show 516395c:luna-autoclaim/luna-autoclaim.user.js`).
