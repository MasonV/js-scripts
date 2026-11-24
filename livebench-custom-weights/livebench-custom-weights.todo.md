# LiveBench Custom Weights — TODO

- [ ] Export / import a profile as a short text code, so weights can be shared.
- [ ] Optionally show the custom score as a column in the site's own table. Left out on purpose: the site is React and re-orders rows itself, so editing its table risks fighting it. Would need a safe approach.
- [ ] Show the "Cost per successful task" figure next to the ranking, so a score can be weighed against price.
- [ ] Built-in profiles only know the LiveBench 2.0 suite names (`agentic`, `coding`, `design`, `browser use`, `data analysis`, `research`, `reasoning`). Add built-ins for the v1 releases (Mathematics, Language, Instruction Following) if those get used.
- [ ] Re-check the selectors (`table.lb-tbl`, `tr.row`, `td.lb-ovr`, `td.lb-cat`, `.nm`, `.th-t`) if the site is redesigned. The "LiveBench default" profile should keep matching the site's Overall; `logic.test.js` has four real rows to check it against.
- [ ] Possible: keyboard shortcut to open the panel.
- [ ] Part weights are multipliers on task count. Add a one-click "count every part equally" for a suite (that needs fractional multipliers, or a second mode).
- [ ] Older v1 releases may keep their part scores elsewhere (`table_<date>.csv`, `categories_<date>.json`); only `data/<release>/breakdown.json` is read today, so those releases get suite weights only.
- [ ] Part scores for a model matched by scores: if two models ever share identical suite scores they stay at suite level (the panel counts them in its "couldn't be matched" note).
