# Public-source release review — 2026-10-26

This is a source preparation record, not a claim that the public GitHub repository is live.

## Prepared

- Apache-2.0 for original code; personal credit to Ahmad Alanazi.
- Separate trademark policy and optional visible attribution request.
- Original LICENSE/NOTICE, third-party notices, dependency inventory and license text collection.
- Runtime FFmpeg JavaScript wrapper removed; separate executable and its notices retained. Development download tooling remains GPL-3.0-or-later.
- Contribution/security instructions and issue templates.
- Fresh export with no private Git history, provider keys, user projects, signing credentials, deployment artifacts or internal chat handoff documents.
- body-parser and multer advisories patched; fresh npm audit reports zero known vulnerabilities. This does not constitute a security audit.

## Before making the repository public

- Review original media/brand ownership and the first commit's file list. The owner confirmed ownership or redistribution permission for the three source-recipe attachments and derived recipes on 2026-10-26.
- Confirm exact corresponding-source/build-script availability for each redistributed FFmpeg binary and linked library. A generic upstream link is not full clearance.
- Verify platform-specific native dependency notices, including Velopack/.NET and Sparkle dependencies.
- Enable GitHub private vulnerability reporting and test the reporting route. Do not advertise it as active before enabling it.
- Review the clean-source build/test/secret-scan reports and update this record with the candidate's hashes.
- Create/publish `ahmadaIanazi/splece` from the reviewed fresh tree. Do not change the visibility of `splece-dev` or push its history.
- Update the app/website source link and remove “repository being prepared” only after the public URL works without authentication.

No source repository or private history is published by the preparation script.
