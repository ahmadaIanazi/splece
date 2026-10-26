# Contributing to Splece

Start with a small issue describing the problem, expected behavior and a reproducible example. Agree on substantial product changes before implementing them. Preserve existing project files, provider choices, Offline mode and local-first behavior.

Use Node 22.13+ (Node 22 LTS recommended), then run `npm ci`, `npm run build` and `npm test`. `npm run dev` starts the local studio. Use isolated disposable data for tests. Never spend provider credits or submit media to a provider as part of automated tests.

Changes should include focused validation of behavior and a clear description. Keep credentials, real customer projects, local artifacts and signing files out of commits. Remove API keys, private paths and personal media from screenshots and logs. Do not include copyrighted samples without documented redistribution permission.

By submitting a contribution, you confirm you have permission to submit it under the project's Apache-2.0 license. You keep ownership of your contribution. Third-party code must preserve its original license and notices; do not relabel dependencies as Apache-2.0.

Use your own branding for publicly distributed forks; see TRADEMARKS.md. We appreciate attribution, as described in ATTRIBUTION.md.
