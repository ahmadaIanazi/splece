# Third-party components

Apache-2.0 applies to original Splece code, not to all files inside an installer. Third-party components retain their original licenses and copyright notices. Do not remove those notices or describe a complete installer as exclusively Apache-2.0.

| Component | Role | License / source |
|---|---|---|
| Node.js | Bundled application runtime | MIT and bundled third-party notices; runtime/LICENSE. https://github.com/nodejs/node |
| FFmpeg | Separate command-line executable for media processing | Actual binary license/build information in studio/vendor/ffmpeg/ffmpeg.LICENSE and ffmpeg.README. Current Windows binary is GPLv3, Gyan 6.1.1 essentials, commit e38092ef93. https://github.com/FFmpeg/FFmpeg/tree/e38092ef93 |
| ffmpeg-static | Development/download tooling only | GPL-3.0-or-later. https://github.com/eugeneware/ffmpeg-static. Splece's runtime does not import its JavaScript wrapper. |
| Sparkle | macOS updater | MIT and bundled third-party notices; Sparkle-LICENSE.txt. https://github.com/sparkle-project/Sparkle |
| Velopack | Windows installer/updater | MIT and bundled dependency notices. https://github.com/velopack/velopack |
| .NET | Self-contained Windows launcher runtime | MIT and bundled third-party notices. https://github.com/dotnet/runtime |
| MediaPipe / BlazeFace | Local face detection | Apache-2.0; public/vision/LICENSE and README.md. https://github.com/google-ai-edge/mediapipe |
| Noto fonts | Editor typography | SIL Open Font License 1.1; public/fonts/*.LICENSE.txt. https://fonts.google.com/noto |
| Big Buck Bunny | Optional downloaded demonstration footage | CC BY 3.0, © 2008 Blender Foundation. https://peach.blender.org/about/ — excerpts may be trimmed, cropped, resized and have audio removed. Not the procedural starter-template artwork. |

Locked JavaScript dependencies and their original notice files are inventoried by `node scripts/release/license-inventory.mjs`. Packaged builds include the inventory and available notice texts in `studio/third-party/`. Original dependency directories retain their license files as well. Inspect platform-specific native components on each release runner; a Mac-only inventory is not a complete Windows/Linux audit.

Original procedural starter-template media is covered by the project's Apache-2.0 license. The website editor screenshot contains staged AI-generated example imagery; it is not third-party stock footage. Brand artwork follows TRADEMARKS.md.

## Corresponding source and redistribution

FFmpeg remains separately licensed and is invoked through its command-line interface. Its GPL redistribution obligations still apply to the binary even though Splece's original code uses Apache-2.0. The upstream binary distribution is https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1; Windows provenance and build details come from https://www.gyan.dev/ffmpeg/builds/ and the shipped README.

Before declaring the complete binary distribution legally cleared, verify and preserve corresponding source, build scripts and source for linked libraries matching the exact platform binary. An upstream homepage link or top-level FFmpeg source alone is not evidence that all corresponding-source obligations are met. The public source-release review tracks this separately; this notice is not a substitute for the required source.

## Windows 0.1.4 runtime notice copies

This release uses Microsoft.NETCore.App.Runtime.win-x64 8.0.32 and Microsoft.WindowsDesktop.App.Runtime.win-x64 8.0.32, plus Velopack 1.2.161. Companion download notices are available at:

- https://www.splece.com/legal/dotnet/LICENSE.txt
- https://www.splece.com/legal/dotnet/THIRD-PARTY-NOTICES.txt
- https://www.splece.com/legal/dotnet/WINFORMS-LICENSE.txt
- https://www.splece.com/legal/dotnet/WPF-LICENSE.txt
- https://www.splece.com/legal/VELOPACK-LICENSE.txt

Copies are preserved in packaging/licenses for subsequent package builds. Verify versions again whenever the native runtime changes.

## User-installed local add-ons

These engines and model weights are **not bundled** with Splece. Users choose whether to download them into the separate local add-ons directory. Upstream notices remain in each installed environment/source checkout.

| Optional component | Role | Upstream license/source |
|---|---|---|
| Earshot | Audio analysis and sound ranking | MIT · https://github.com/Leonxlnx/earshot |
| CLAP / AST weights | Earshot's optional local models | Apache-2.0 / BSD-3-Clause, respectively; see Earshot's pinned model definitions and model cards |
| librosa | Beat and onset analysis | ISC · https://github.com/librosa/librosa |
| PySceneDetect | Shot detection | BSD-3-Clause · https://github.com/Breakthrough/PySceneDetect |
| whisper.cpp | Local speech transcription | MIT · https://github.com/ggml-org/whisper.cpp |
| Openverse results | Optional online recording discovery | Each imported recording keeps its own license, creator and source. No stock recordings are bundled. https://openverse.org/ |

Optional Python runtime dependencies retain their own licenses. The native editable sound builder is original Splece code; Real SFX is a workflow reference, not vendored code. Implementation, version pins, limitations and verification are described in `docs/local-addons.md`.

## Provider setup documentation screenshots

The connection guide includes instructional screenshots of public OpenAI and Venice documentation. These are attributed reference material, not Splece-authored interface designs or licensed application code. Rights remain with the respective providers. Source links and capture details are in `public/connection-guides/README.md`; no account or credential data is included.
