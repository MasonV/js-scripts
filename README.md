# js-scripts

This repository can hold multiple independent userscripts.

## Scripts

### `bundle-barter-scorer/`

Barter.vg bundle scoring userscript, kept in its own folder so additional scripts can be added cleanly.

- Install / download:
  - `https://raw.githubusercontent.com/MasonV/js-scripts/main/bundle-barter-scorer/barter-bundle-scorer.user.js`
- Metadata update checks:
  - `https://raw.githubusercontent.com/MasonV/js-scripts/main/bundle-barter-scorer/barter-bundle-scorer.meta.js`

### Update workflow

1. Edit `bundle-barter-scorer/barter-bundle-scorer.user.js`.
2. Bump `@version` in both script files under `bundle-barter-scorer/`.
3. Keep `@updateURL` pointed at `.meta.js` and `@downloadURL` pointed at `.user.js`.
