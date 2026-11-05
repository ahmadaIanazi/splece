# Development

## Requirements

Git, Node.js 22.13+ with npm, and network access for dependency installation. Node 22 LTS is the recommended baseline. FFmpeg is downloaded by development tooling during `npm ci`; a compatible executable can be supplied using `FFMPEG_BIN`.

```sh
git clone https://github.com/ahmadaIanazi/splece.git
cd splece
npm ci
npm run build
npm run dev
```

Open http://127.0.0.1:4310. On Windows, use these commands in PowerShell; the historical `npm start` script uses POSIX environment assignment, so use `npm run dev` for this quick start.

## Keep experiments separate

Source development uses `data/`. Do not point experiments at an installed user's workspace. To choose a separate directory:

macOS / Linux:

```sh
STUDIO_DATA_DIR=/absolute/path/to/disposable-splece PORT=4312 npm run dev
```

Windows PowerShell:

```powershell
$env:STUDIO_DATA_DIR = "$env:TEMP\splece-disposable"
$env:PORT = "4312"
npm run dev
```

Do not put real credentials in `.env.example`, fixtures or version control. Set connections through the app. Keep Online off for unpaid UI checks.

## Checks

```sh
npm run build
npm test
node scripts/check-repository.mjs
```

The regression suite uses mocked providers and temporary workspaces. `scripts/check-secrets.mjs` additionally requires Gitleaks and scans the staged tree with redacted output. CI checks the full repository history too.

## Layout

- `src/`: React editor and settings.
- `shared/`: shared models, prompt/reference rules, routing and editing contracts.
- `server/`: local storage, media operations, provider adapters and job execution.
- `tests/`: regression tests.
- `public/`: approved brand, fonts, example artwork and model assets.
- `packaging/`, `macos/`, `scripts/release/`: platform packaging/update tools.

See [provider adapters](provider-adapters.md) before adding an API. Optional local engines are described in [local add-ons](../local-addons.md).

## Distribution

This is source code, not a reproducible installer certification. Desktop bundles carry Node, FFmpeg and platform runtimes with their separate notices. Before distributing your own installer, review those obligations and provide matching corresponding source where required. The original project's FFmpeg binary corresponding-source/build-material audit remains open; this source release does not include FFmpeg binaries.

Use your own app name, icons, signing identities and update service for a distributed fork. Do not point a fork's updater at the official Splece feed. See [TRADEMARKS.md](../../TRADEMARKS.md) and [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
