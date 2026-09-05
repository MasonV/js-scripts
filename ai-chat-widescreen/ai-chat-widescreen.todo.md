# TODO — ai-chat-widescreen

## Open

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
