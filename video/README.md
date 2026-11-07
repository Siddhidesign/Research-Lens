# Voiceover

Generated with Piper TTS (en_US-amy-medium), script in voiceover.py.

    python3 video/render.py        # silent video, scene timings match the VO
    python3 video/voiceover.py     # regenerate speech clips

Then mux with ffmpeg. Edit the SCRIPT list in voiceover.py to change the words;
scene durations in render.py are derived from clip lengths plus padding.
