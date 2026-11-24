# LiveBench Custom Weights — TODO

- [ ] Export / import a profile as a short text code, so weights can be shared.
- [ ] Optionally show the custom score as a column in the site's own table. Left out on purpose: the site is React and re-orders rows itself, so editing its table risks fighting it. Would need a safe approach.
- [ ] Show the "Cost per successful task" figure next to the ranking, so a score can be weighed against price.
- [ ] Built-in profiles only know the LiveBench 2.0 suite names (`agentic`, `coding`, `design`, `browser use`, `data analysis`, `research`, `reasoning`). Add built-ins for the v1 releases (Mathematics, Language, Instruction Following) if those get used.
- [ ] Re-check the selectors (`table.lb-tbl`, `tr.row`, `td.lb-ovr`, `td.lb-cat`, `.nm`, `.th-t`) if the site is redesigned. The "LiveBench default" profile should keep matching the site's Overall; `logic.test.js` has four real rows to check it against.
- [ ] Possible: keyboard shortcut to open the panel.
