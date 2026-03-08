# js-scripts


This repository can hold multiple independent userscripts.

## Scripts

### `barter-bundle-scorer/`

Barter.vg bundle scoring userscript, kept in its own folder so additional scripts can be added cleanly.

- Install / download:
  - `https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.user.js`
- Metadata update checks:
  - `https://raw.githubusercontent.com/MasonV/js-scripts/main/barter-bundle-scorer/barter-bundle-scorer.meta.js`

### Update workflow

1. Edit `barter-bundle-scorer/barter-bundle-scorer.user.js`.
2. Bump `@version` in both script files under `barter-bundle-scorer/`.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.