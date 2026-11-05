"""Optional local engines. This file itself has no third-party imports at startup.
Downloads are possible ONLY in the explicit prepare action during installation.
"""
import json
import sys
import contextlib


def execute(request):
    action = request["action"]
    if action == "prepare":
        engine = request["engine"]
        if engine == "earshot":
            from earshot.models import clap, ast
            import numpy as np
            model = clap.get()
            model.embed_text(["a short sound"])
            model.embed_audio([np.zeros(48000, dtype=np.float32)])
            ast.get()
        elif engine == "rhythm":
            import librosa
            import numpy as np
            # librosa loads scipy/numba lazily: importing alone is not a health check.
            librosa.beat.beat_track(y=np.zeros(22050), sr=22050)
            librosa.onset.onset_detect(y=np.zeros(22050), sr=22050)
        elif engine == "scenes":
            import scenedetect
        return {"ready": True}
    if action == "describe":
        from earshot import api
        return api.describe(request["path"])
    if action == "rank":
        from earshot import api
        return api.rank(request["paths"], request["query"], top=5)
    if action == "find":
        from earshot import api
        return api.find(request["path"], request["query"], top=1, start=0, end=min(60, request["duration"]))
    if action == "beats":
        import librosa
        import numpy as np
        audio, rate = librosa.load(request["path"], sr=22050, mono=True, duration=600)
        tempo, frames = librosa.beat.beat_track(y=audio, sr=rate)
        onsets = librosa.onset.onset_detect(y=audio, sr=rate, units="time")
        return {"tempo": float(np.asarray(tempo).reshape(-1)[0]), "beats": librosa.frames_to_time(frames, sr=rate).tolist(), "onsets": onsets.tolist()}
    if action == "cuts":
        from scenedetect import detect, AdaptiveDetector
        scenes = detect(request["path"], AdaptiveDetector(), show_progress=False)
        return {"cuts": [end.get_seconds() for _, end in scenes[:-1]]}
    raise ValueError("Unsupported local action")


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, default=lambda v: v.tolist() if hasattr(v, "tolist") else str(v))


if "--serve" in sys.argv:
    for line in sys.stdin:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result = execute(json.loads(line))
            print(encode({"result": result}), flush=True)
        except Exception as error:
            print(encode({"error": str(error)}), flush=True)
else:
    try:
        request = json.load(sys.stdin)
        # Some libraries print diagnostics. Keep stdout a single JSON value.
        with contextlib.redirect_stdout(sys.stderr):
            result = execute(request)
        print(encode(result))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
