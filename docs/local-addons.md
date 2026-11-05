# Optional local capabilities

Settings → Add-ons manages optional engines. Sound → Local tools & sound search is the entry point for their use. The default install contains the integration code, not Python environments, model weights, sound libraries, or whisper.cpp binaries. No downloads happen at startup or when opening the panel.

## Available tools

| Capability | Installation | Result |
| --- | --- | --- |
| Build from my sounds | Included; optionally uses Earshot | Reviewable audio suggestions from the current project's audio assets; append as independently editable timeline clips |
| Check loudness | Included FFmpeg | Per-clip integrated loudness and true peak; does not change manual gain |
| Describe audio / find matching sounds | Earshot add-on | Measured characteristics, tentative model descriptions, ranked library candidates |
| Find beats and onsets | librosa add-on | Seekable timing suggestions |
| Find shot boundaries | PySceneDetect add-on | Seekable cuts within the trimmed active take |
| Create captions | whisper.cpp and multilingual base model | Review transcription, then append editable text elements, with an Arabic font when appropriate |
| Open sound search | Optional online switch | Account-free Openverse search, source preview links and import to Library; CC0 and CC BY only |

Whole edit is the default. Analysis is limited to ten minutes per request, serialized to bound CPU load, cancellable, and persisted in SQLite. Interrupted jobs become recoverable failures. The review checks the source take, trim, position, duration and episode before applying. Existing takes, sound levels and manual choices are not replaced. Applying the same result twice does not duplicate it; Undo uses normal project history.

The local sound builder uses our own small orchestration layer and existing editable timeline, inspired by the recorded-library approach in Real SFX. It does **not** embed the Claude-dependent Real SFX skill or claim its full workflow. Without Earshot, matching uses names/descriptions/tags and a limited Arabic/English acoustic vocabulary. With Earshot enabled, it ranks up to 20 local recordings and looks for an excerpt in the first 60 seconds of the chosen recording. Only plausible/strong file matches are proposed. Choosing a recording manually bypasses ranking. Initial placement is at a clip boundary; frame-accurate action recognition is not claimed. Model tags, shot changes and beats are suggestions, not semantic ground truth.

## Installation and privacy

- Optional files live in `<STUDIO_DATA_DIR>/addons/<id>`, separate from project folders and release bundles. Disable keeps files; Remove deletes only that add-on. Saved assets and applied results remain.
- Python add-ons use isolated virtual environments and a compatible Python 3.10–3.12 already on the computer. No system packages are modified. Python: https://www.python.org/downloads/
- Earshot source is pinned to `591fa3e028032e6dce56620a20e932e35667e8d8`; dependencies include transformers 4.57.6, NumPy 1.26.4, SciPy 1.13.1, and numba 0.61.2. The two model snapshots are pinned upstream and use safetensors. Allow additional disk space for runtime packages beyond the approximately 1.1 GB model download.
- librosa 0.11.0 and PySceneDetect 0.6.7.1 / OpenCV headless 4.11.0.86 are optional packages. No trained models are needed for these two capabilities.
- whisper.cpp source is pinned to `371b5a7561823ab2bb32142d2751e35e7534727b` and built on the user's machine. Git, CMake and a C++ compiler are prerequisites. The multilingual base model is 147,951,465 bytes and verified with SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` before activation. Git: https://git-scm.com/downloads · CMake: https://cmake.org/download/
- Installation requires internet. Execution sets `EARSHOT_OFFLINE=1`, `HF_HUB_OFFLINE=1`, and `TRANSFORMERS_OFFLINE=1`. Missing files fail rather than fetch on demand or fall back to a cloud provider. Gemini/Earshot cloud critique is not exposed.
- Earshot uses a serialized warm process, released after five idle minutes or when disabled/removed. Cancellation terminates the worker; a subsequent request starts cleanly.
- Setup includes real inference/import checks, not merely package-presence checks. Partial downloads can be retried or removed. Restart is blocked while installs or local jobs are active.
- Openverse sends only user-entered search words, and retrieves public recording metadata/media when requested. No project media is uploaded. Searches are cached briefly, are never bulk-crawled, and handle unavailable service and rate limits without a paid fallback. The API setup guide is exposed if the service restricts access.
- Imported recordings retain creator, source, license and attribution on both asset and media records. Credit links appear in asset details. Users must preserve attribution when publishing; importing does not automatically burn credits into exported videos.
- Recording downloads enforce HTTPS, public DNS addresses pinned per request, redirect limits, size/time limits and audio validation. The server retrieves the license itself; clients cannot inject an import URL or license.

## Verification (2026-10-27)

- 738 automated tests passed, including 11 add-on/local-tool/Openverse tests; production build passed. Existing bundle-size/dynamic-import warnings remain.
- Installed all four optional engines in disposable data directories on macOS. Nothing installed into the user's main studio.
- Real offline librosa analysis found approximately 117 BPM and seven beat points in the synthetic ~120 BPM fixture; shot detection found the two-second cut in a red/blue fixture.
- Real offline whisper.cpp transcribed a generated English sentence. Arabic caption styling is tested; Arabic transcription accuracy has not been benchmarked.
- Real offline Earshot description, ranking and excerpt search returned structured results. Its SFX tags were imperfect for synthetic speech, and the speech-query match was weak; the integration does not promote weak results into automatic placements. This is a wiring/runtime test, not a broad model-quality benchmark.
- Browser checked: Add-ons entry, account-free search enable, local prepare/review, append to timeline and installed capability discovery. Checked that local mode hides cloud generation controls.
- Openverse's live endpoint returned a gateway timeout during this run. Anonymous access is documented upstream, but successful live search/import could not be demonstrated. Cache, attribution, import, rate-limit, outage and private-address rejection paths are covered with fixtures.

Source references: https://github.com/Leonxlnx/earshot · https://librosa.org/ · https://www.scenedetect.com/ · https://github.com/ggml-org/whisper.cpp · https://api.openverse.org/v1/ · https://github.com/Clipwing/skills/tree/main/skills/real-sfx

## Real-footage follow-up (2026-10-27)

Tested captions and beats across a nine-clip Arabic dialogue edit, plus semantic matching against 20 of its saved recordings. The requested Earshot, librosa and whisper.cpp add-ons are now installed and enabled in the main studio by user request. Openverse and shot detection remain off.

Fixes from this pass:

- Caption review supports Arabic/English language selection and optional spelling hints. Text corrections persist in the local analysis record before application. Existing caption elements remain editable in the preview.
- Removed forced whisper.cpp word splitting: with Arabic hints, it could assign a short sentence's final words to padded time beyond the actual clip, causing the clipped review to lose words. Natural segments are retained and bounded to the selected clip. Their timing is coarse and still needs review.
- Both semantic sound workflows use the same limited, local Arabic-to-English acoustic vocabulary mapping. Identical ranking queries are reused within a job. Unsupported Arabic vocabulary is not equivalent to a multilingual semantic model.
- Results use scene names and timeline order. Beat reviews explicitly describe the original, pre-mix audio source and warn that speech can yield a false musical tempo.
- Transient polling errors clear on reconnection; applying then undoing a result clears the stale success message.

Measured results: 9 bounded caption segments, 105 beat suggestions and 255 onsets; the sub-frame split did not fail either analysis. Equivalent Arabic/English speech queries ranked the same dialogue recordings; an unrelated engine query returned no matches; an explicit manual recording overrode a conflicting query. A bird-chirp query found no confident match in the candidate set. Do not interpret successful execution as perfect sound selection or transcription: the base model still misheard Arabic words and some names. There was no independent human listening/word-error-rate benchmark.

All three engines executed against real project audio under macOS sandbox-exec with network access denied; a denied outbound connection was independently checked. Earshot also processed a previously unused text query in that sandbox. This verifies offline operation after installation, not offline installation. Browser checks covered playback, caption correction/save, Arabic rendering, beat seeking, applying results, Undo, and disabling/re-enabling without downloading. The original takes, trims, levels, mutes, text, assets, drafts and settings were verified unchanged after Undo. No cloud-generation credits were used.

The final full suite passed 739 tests. An earlier full run exposed an existing timing-sensitive scene-graph assertion (`amount` omitted on an early Off return); its isolated rerun and the complete final rerun passed. The add-on tests passed throughout. Production build passed.
