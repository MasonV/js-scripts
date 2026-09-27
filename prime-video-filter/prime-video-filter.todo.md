# Prime Video Filter — TODO

- [ ] Verify selectors against live Prime Video markup (built without live DOM access): `article[data-testid="card"]`, `data-card-entitlement`, card progress bars, and the detail page's `data-automation-id="imdb-rating-badge"`. Save a storefront capture to `prime-video-filter.dev.res/` to test against.
- [ ] Check whether carousels that lazy-load more cards when scrolled sideways lose cards once "Hide rows with nothing left" collapses the row.
- [ ] Non-English label matching for the entitlement fallback.
- [ ] Possible: keyword/genre blocklist; hide whole rows by heading (e.g. "Sponsored").
