# TODO — ai-chat-widescreen

## Done

- [x] **Wide tables stayed clipped on Gemini** `bug`
  - The engine only ever walked *up* from a message anchor, so a constraint below the anchor — Gemini pinches its own table wrapper — was invisible to it: the column widened and the table stayed cut off mid-word inside it. Added a second pass that walks down to `table` / `pre` inside a widened message and back up to the column, freeing whatever is holding the content in.
  - Detection is by symptom (`scrollWidth > clientWidth`), not by selector or property, so it covers a wrapper capped by `max-width`, one given a fixed width inline by the app's own JS, and a flex item that won't grow — all three are covered by tests. A table that already fits is left untouched, so narrow tables are not stretched.
  - Completed: 2026-09-05 (v1.1.0)

## Open

- [ ] **Confirm the table fix against live Gemini** `test`
  - The three pinch mechanisms are reproduced synthetically and fixed, but which one Gemini actually uses is unverified — the site can't be reached from a dev container. If tables still clip after v1.1.0, the wrapper is being constrained some fourth way; `document.querySelector('[data-aiws-wide=\"thread\"] table').closest('[data-aiws-wide]')` in the console will say whether the pass claimed anything.

- [ ] **Verify the anchor selectors against each live site** `debt`
  - The engine is deliberately selector-light: it walks up from a message (or the composer) and widens whatever the site capped along the way, so a single stale anchor is survivable. Still, each list should be checked against the real DOM — especially Claude's `.font-claude-response` / `[data-testid="chat-input"]` and Gemini's `input-container`, which were written from the shipped markup rather than a live capture.
  - A good check: with the script off, run `document.querySelectorAll('<selector>').length` in the console on a thread with several turns. Every turn should be represented.

- [ ] **Capture dev resources for the three sites** `debt`
  - `ai-chat-widescreen.dev.resources/` with a saved thread from each site would make selector drift diagnosable without opening an account.

- [ ] **Consider widening the artifact / canvas side panel** `feature`
  - ChatGPT's canvas and Claude's artifact pane split the window with the thread. The current script only governs the message column; the split ratio is a separate (and probably per-site) control.

- [ ] **Per-site width presets keyed to the window** `feature`
  - On an ultrawide, 80% is a lot of line length. A "max line length" cap (in `ch`) as an alternative to the percentage would read better at 3440px, and would make "Full" mean something different from "unreadable".

- [ ] **Check behaviour with the sidebar collapsed** `test`
  - `vw` units count the full viewport, including the sidebar, so the chat is slightly off-centre relative to the space it actually has. Measuring the thread's own container instead of the viewport would centre it properly, at the cost of a resize observer.
