// Only this reviewed catalogue can install code. Never accept package names or commands from requests.
export const addonCatalog = [
  {
    id: "earshot",
    name: "Sound intelligence",
    engine: "Earshot",
    description:
      "Describe recordings and rank your sounds against a scene description.",
    download: "About 1.1 GB of models, plus the Python runtime packages",
    requirements: "Python 3.10–3.12",
    local: true,
    source: "https://github.com/Leonxlnx/earshot",
    license: "MIT · CLAP Apache-2.0 · AST BSD-3-Clause",
  },
  {
    id: "rhythm",
    name: "Beat & onset detection",
    engine: "librosa",
    description: "Find musical beats and sound attacks for precise editing.",
    download: "Python packages only · size varies by computer",
    requirements: "Python 3.10–3.12",
    local: true,
    source: "https://librosa.org/",
    license: "ISC",
  },
  {
    id: "scenes",
    name: "Shot detection",
    engine: "PySceneDetect",
    description:
      "Find shot boundaries inside footage without changing your edit.",
    download: "Python packages only · size varies by computer",
    requirements: "Python 3.10–3.12",
    local: true,
    source: "https://www.scenedetect.com/",
    license: "BSD-3-Clause",
  },
  {
    id: "captions",
    name: "Local captions",
    engine: "whisper.cpp",
    description:
      "Transcribe speech into editable captions. Includes a multilingual base model.",
    download: "148 MB model, plus a small native engine",
    requirements: "Git, CMake and a C++ compiler",
    local: true,
    source: "https://github.com/ggml-org/whisper.cpp",
    license: "MIT",
  },
  {
    id: "openverse",
    name: "Open sound search",
    engine: "Openverse",
    description:
      "Search public-domain and attribution-licensed recordings. Only your search words are sent.",
    download: "No installation · online search",
    requirements: "Internet · no account needed for standard access",
    local: false,
    source: "https://openverse.org/",
    license: "Each recording has its own license",
  },
];
export const addonById = (id) => addonCatalog.find((a) => a.id === id);
export const localToolAddons = {
  describe: "earshot",
  rank: "earshot",
  beats: "rhythm",
  cuts: "scenes",
  captions: "captions",
};
