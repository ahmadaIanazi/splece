# Splece

**A free video generator and editor built from the ground up for AI.**

Created by [Ahmad Alanazi](https://github.com/ahmadaIanazi). [Website and downloads](https://www.splece.com).

Plan on a canvas, connect your own supported AI providers, compare takes, refine your edit and export locally. The browser is the editor window; the installed app runs on your computer. Provider generation is optional and billed by the provider. No API key is needed to edit imported footage or explore Offline mode.

## Downloads

- [Mac beta](https://www.splece.com/beta/): Apple Silicon, macOS 13+. Signed and notarized.
- [Windows beta](https://www.splece.com/beta/windows/): x64, Windows 10/11. Unsigned; Windows may show a publisher/reputation warning.
- Linux: experimental Ubuntu/Debian x64 package under testing; see the website for current availability. Other distributions and ARM Linux are not claimed as supported.

Desktop packages bundle their runtime and video tools. Source setup below is for developers.

## Run from source

Use Node 22.13 or later (Node 22 LTS recommended) and npm:

```sh
npm ci
npm run build
npm run dev
```

Open http://127.0.0.1:4310. To develop the frontend, the local server serves the development studio. `npm test` runs the regression suite. Tests must not call paid providers. Optional sample setup: `npm run setup:demo`; downloaded footage has its own attribution in THIRD_PARTY_NOTICES.md.

FFmpeg download tooling runs during `npm ci`. The application invokes the executable as a separate process. It does not load the GPL JavaScript wrapper at runtime. You may set `FFMPEG_BIN` to a compatible executable. Packaged releases use their bundled executable.

## Privacy and costs

Projects, media, edits and exports remain in local storage. Online generation sends the necessary prompts/references/media to the chosen provider. Connections store provider credentials locally, outside portable project bundles; do not publish your data directory or logs. Local storage is not a promise that all third-party libraries or provider requests are offline.

Installed data locations: macOS `~/Library/Application Support/Splece`; Windows `%LOCALAPPDATA%\Splece`; Linux `$XDG_DATA_HOME/Splece` or `~/.local/share/Splece`. Development data is separate. Back up your project folders before trying a beta.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Include reproducible examples with secrets and personal media removed. Small improvements to first-run reliability, provider adapters and editing behavior are welcome. This beta does not promise every feature of a mature professional editor.

## License, credit and branding

Original Splece code: [Apache License 2.0](LICENSE). Copyright 2026 Ahmad Alanazi and Splece contributors. Commercial use and closed-source derivatives are allowed under that license; preserve applicable notices and mark modifications.

The **Splece name, logo and app icon remain reserved**. Use your own branding for a commercial product or distributed fork; see [TRADEMARKS.md](TRADEMARKS.md). A visible “Built with Splece” credit is appreciated, not an extra license requirement: [ATTRIBUTION.md](ATTRIBUTION.md).

Dependencies, fonts, models, sample footage and bundled executables retain their own licenses. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Apache-2.0 does not relicense those components.
