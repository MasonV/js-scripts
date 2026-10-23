# Agent Instructions

## Third-Party Services

- Before code that automates, scrapes or bulk-acts on a third-party site or API, read its terms first-hand and record the URL, date and clause wording in the repo. If the terms can not be read, do not ship the automation.
- Default design: one external action per human click. No scripts that submit, activate or navigate on third-party pages without a human triggering each action.
- Follow explicit agent/bot rules (e.g. required user-agent identification). Never mimic human pacing to avoid detection.
- Every automated client has a rate cap, backoff on errors (honouring Retry-After), and a halt after N consecutive failures that reports the error loudly.
- If the terms are ambiguous or a project may conflict with them, flag it for the owner as a human-delegated task so they can ask the service's support team. Agents never contact third parties themselves. Record the owner's answer in the repo.
