#!/usr/bin/env python3
"""
Voiceover for the Research Lens video.

Kokoro TTS (af_heart), open source and licensed for commercial use.
Model files download once from the kokoro-onnx releases page.

    pip install kokoro-onnx soundfile
    python3 video/voiceover.py        # writes vo_<scene>.wav + durs.json

Scene durations in render.py are derived from these clip lengths plus padding,
so if you change the words here, re-run both this and render.py.
"""
import json, soundfile as sf
from kokoro_onnx import Kokoro

VOICE = "af_heart"
MODEL, VOICES = "kokoro-v1.0.onnx", "voices-v1.0.bin"

SCRIPT = [
 ("hook",     "Last month I ran twelve interviews. Then someone asked me, how many people actually said that?"),
 ("oldway",   "Here is what most of us do. Paste the transcripts into a chat window, and get back something "
              "fluent. But the model only sees what you pasted. It cannot count people, and nothing it says "
              "can be traced back to anyone."),
 ("ask",      "So I built Research Lens. An M C P server that lets an assistant query your research "
              "repository directly."),
 ("toolcall", "Same question. Now it goes and looks."),
 ("answer",   "Round one, one person negative, one of three finished. Round two, two positive, everyone "
              "finished, satisfaction up twenty six points."),
 ("citation", "And every quote comes back with who said it, which round, and the timestamp."),
 ("caution",  "Then it does the thing I care about most. It tells you when not to trust it."),
 ("endcard",  "Free, open source, and on npm today."),
]

if __name__ == "__main__":
    k = Kokoro(MODEL, VOICES)
    durs = {}
    for name, txt in SCRIPT:
        s, sr = k.create(txt, voice=VOICE, speed=1.0, lang="en-us")
        sf.write(f"vo_{name}.wav", s, sr)
        durs[name] = len(s) / sr
        print(f"{name:9} {durs[name]:5.2f}s")
    json.dump(durs, open("durs.json", "w"))
