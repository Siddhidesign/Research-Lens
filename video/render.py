#!/usr/bin/env python3
"""
Renders the Research Lens LinkedIn video as frames, then stitches to MP4.

4:5 vertical, 1080x1350, 24fps, silent, captions burned in. No screen
recording needed: every frame is drawn from the real tool output, so what the
video shows is what the server actually returns.

    python3 video/render.py

Output: video/research-lens.mp4
"""
import os, shutil, subprocess, math
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1350, 24
OUT = os.path.dirname(os.path.abspath(__file__))
FRAMES = "/tmp/_rlframes"

BG      = (13, 15, 18)
PANEL   = (20, 23, 28)
LINE    = (38, 43, 51)
INK     = (230, 233, 238)
DIM     = (154, 163, 176)
DIMMER  = (107, 116, 128)
ACCENT  = (110, 231, 183)
WARN    = (251, 191, 36)
RED     = (248, 113, 113)

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONOB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
F = lambda s, bold=False: ImageFont.truetype(MONOB if bold else MONO, s)

f_huge  = F(62, True)
f_big   = F(44, True)
f_body  = F(30)
f_bodyb = F(30, True)
f_code  = F(25)
f_small = F(23)
f_tiny  = F(20)
f_cap   = F(27, True)

def lerp(a, b, t): return a + (b - a) * t
def ease(t): return t * t * (3 - 2 * t)          # smoothstep
def clamp01(x): return max(0.0, min(1.0, x))

def mix(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))

def wrap(text, font, maxw):
    """Wrap on spaces for a monospace font."""
    out = []
    for para in text.split("\n"):
        if not para:
            out.append("")
            continue
        line = ""
        for word in para.split(" "):
            trial = (line + " " + word).strip()
            if font.getlength(trial) <= maxw:
                line = trial
            else:
                if line: out.append(line)
                line = word
        out.append(line)
    return out

def text_block(d, lines, x, y, font, fill, lh=None, alpha=1.0, bg=BG):
    lh = lh or int(font.size * 1.5)
    col = mix(bg, fill, clamp01(alpha))
    for i, ln in enumerate(lines):
        d.text((x, y + i * lh), ln, font=font, fill=col)
    return y + len(lines) * lh

def caption(d, text, alpha=1.0):
    """Disabled: real subtitles are burned in from subs.srt after render."""
    return
    if alpha <= 0.01: return
    lines = wrap(text, f_cap, W - 160)
    lh = 44
    boxh = len(lines) * lh + 44
    y0 = H - 170 - boxh
    plate = Image.new("RGBA", (W - 100, boxh), (6, 8, 10, int(225 * clamp01(alpha))))
    d._image.paste(plate, (50, y0), plate)
    for i, ln in enumerate(lines):
        tw = f_cap.getlength(ln)
        d.text(((W - tw) / 2, y0 + 22 + i * lh), ln, font=f_cap,
               fill=mix(BG, INK, clamp01(alpha)))

def panel(d, x, y, w, h, fill=PANEL, border=LINE, r=14):
    d.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=border, width=2)

def fade_edges(img, alpha):
    """Global fade to black for scene transitions."""
    if alpha >= 0.999: return img
    black = Image.new("RGB", img.size, (0, 0, 0))
    return Image.blend(black, img, clamp01(alpha))

# --------------------------------------------------------------------------
# Scene content, taken verbatim from what the server returns
# --------------------------------------------------------------------------

OLD_WAY = ("Users generally expressed uncertainty about the AI's spending "
           "recommendations and wanted more transparency. Overall sentiment "
           "improved in the second round, with participants feeling more "
           "confident in the system's suggestions.")

QUESTION = "Did trust improve between round one and round two?"

ANSWER = [
    ('Theme "trust", round 1 vs round 2', INK, f_code),
    ("", INK, f_code),
    ("Round 1: 0 positive / 1 negative", DIM, f_code),
    ("         completed 1/3 | mean SUS 55", DIM, f_code),
    ("Round 2: 2 positive / 0 negative", DIM, f_code),
    ("         completed 3/3 | mean SUS 81", DIM, f_code),
    ("", INK, f_code),
    ("Direction: sentiment improved, SUS +26.", ACCENT, f_code),
    ("Caution: 6 sessions is a small n.", WARN, f_code),
    ("Treat as directional, not significant.", WARN, f_code),
]

QUOTE_LINES = [
    ('[P14 | R2 | 05:21]', ACCENT, f_small),
    ('"Seeing the three weeks it used makes it', INK, f_small),
    (' feel like a reason, not a guess."', INK, f_small),
]

# Scene timings in seconds: (name, duration)
SCENES = [
    ("hook",      6.78),
    ("oldway",    13.88),
    ("ask",       7.87),
    ("toolcall",  3.23),
    ("answer",    9.85),
    ("citation",  5.45),
    ("caution",   5.59),
    ("endcard",   5.37),
]
TOTAL = sum(d for _, d in SCENES)

def scene_at(t):
    acc = 0.0
    for name, dur in SCENES:
        if t < acc + dur:
            return name, (t - acc), dur
        acc += dur
    return SCENES[-1][0], SCENES[-1][1], SCENES[-1][1]

def header(d, label, dot=DIMMER):
    d.ellipse([70, 76, 86, 92], fill=dot)
    d.text((104, 70), label, font=f_tiny, fill=DIMMER)

# --------------------------------------------------------------------------
# Frame renderer
# --------------------------------------------------------------------------

def render(t):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d._image = img
    name, lt, dur = scene_at(t)

    # scene-level fade in/out
    fin = clamp01(lt / 0.35)
    fout = clamp01((dur - lt) / 0.35)
    a = min(fin, fout)

    if name == "hook":
        lines1 = wrap("AI told me what", f_huge, W - 140)
        lines2 = wrap("12 users wanted.", f_huge, W - 140)
        lines3 = wrap("It couldn't tell me", f_huge, W - 140)
        lines4 = wrap("who said it.", f_huge, W - 140)
        y = 430
        rise = (1 - ease(clamp01(lt / 0.8))) * 30
        y = text_block(d, lines1, 80, y + rise, f_huge, INK, 86, a)
        y = text_block(d, lines2, 80, y + rise, f_huge, INK, 86, a)
        y += 30
        a2 = clamp01((lt - 1.1) / 0.6)
        y = text_block(d, lines3, 80, y, f_huge, DIM, 86, min(a, a2))
        text_block(d, lines4, 80, y, f_huge, DIM, 86, min(a, a2))

    elif name == "oldway":
        header(d, "THE USUAL WORKFLOW", RED)
        panel(d, 60, 140, W - 120, 520)
        d.text((100, 180), "You:", font=f_small, fill=DIMMER)
        text_block(d, wrap("[pasted 4,000 words of transcript]", f_code, W - 220),
                   100, 220, f_code, DIMMER, 38, a)
        d.text((100, 320), "AI:", font=f_small, fill=DIMMER)
        reveal = clamp01((lt - 0.6) / 2.2)
        lines = wrap(OLD_WAY, f_code, W - 220)
        shown = lines[: max(1, int(len(lines) * reveal))]
        text_block(d, shown, 100, 360, f_code, INK, 40, a)
        if lt > 3.0:
            ca = clamp01((lt - 3.0) / 0.5)
            d.text((100, 600), "no participant   no timestamp   nothing to check",
                   font=f_small, fill=mix(PANEL, RED, ca * a))
        caption(d, "Fluent. Confident. Impossible to verify.",
                clamp01((lt - 1.2) / 0.5) * a)

    elif name == "ask":
        header(d, "RESEARCH LENS", ACCENT)
        panel(d, 60, 140, W - 120, 300)
        d.text((100, 180), "You:", font=f_small, fill=DIMMER)
        n = int(len(QUESTION) * clamp01((lt - 0.4) / 2.6))
        typed = QUESTION[:n]
        cur = "|" if int(t * 2.5) % 2 == 0 and n < len(QUESTION) else ""
        text_block(d, wrap(typed + cur, f_body, W - 220), 100, 232, f_body, INK, 44, a)
        caption(d, "Same question. Asked of the repository itself.",
                clamp01((lt - 2.0) / 0.5) * a)

    elif name == "toolcall":
        header(d, "RESEARCH LENS", ACCENT)
        panel(d, 60, 140, W - 120, 220)
        text_block(d, wrap(QUESTION, f_body, W - 220), 100, 180, f_body, DIM, 44, a)
        panel(d, 60, 400, W - 120, 150, fill=(16, 24, 20), border=(45, 106, 82))
        dots = "." * (1 + int(lt * 4) % 3)
        d.text((100, 440), "calling tool", font=f_small, fill=DIMMER)
        d.text((100, 480), f"compare_rounds{dots}", font=f_bodyb, fill=ACCENT)
        caption(d, "The assistant queries the data. It does not guess.", a)

    elif name == "answer":
        header(d, "RESEARCH LENS", ACCENT)
        panel(d, 60, 140, W - 120, 120)
        text_block(d, wrap(QUESTION, f_small, W - 220), 100, 176, f_small, DIM, 34, a)
        panel(d, 60, 300, W - 120, 560, fill=(10, 12, 15))
        reveal = clamp01((lt - 0.3) / 2.4)
        upto = int(len(ANSWER) * reveal)
        y = 345
        for i, (txt, col, fnt) in enumerate(ANSWER[:upto]):
            la = clamp01((reveal * len(ANSWER) - i))
            d.text((100, y), txt, font=fnt, fill=mix((10, 12, 15), col, la * a))
            y += 50
        caption(d, "Real numbers. Round by round.",
                clamp01((lt - 2.8) / 0.5) * a)

    elif name == "citation":
        header(d, "RESEARCH LENS", ACCENT)
        # punch in: scale the quote block up
        s = lerp(1.0, 1.12, ease(clamp01(lt / 1.2)))
        panel(d, 60, 260, W - 120, 330, fill=(10, 12, 15))
        y = 320
        for txt, col, fnt in QUOTE_LINES:
            fnt2 = F(int(fnt.size * s), bold=(col == ACCENT))
            d.text((100, y), txt, font=fnt2, fill=mix((10, 12, 15), col, a))
            y += int(52 * s)
        d.text((100, 640), "participant  ·  round  ·  timestamp",
               font=f_small, fill=mix(BG, DIMMER, a))
        caption(d, "Every claim traceable to who said it.",
                clamp01((lt - 0.8) / 0.5) * a)

    elif name == "caution":
        header(d, "RESEARCH LENS", ACCENT)
        s = lerp(1.0, 1.1, ease(clamp01(lt / 1.2)))
        panel(d, 60, 300, W - 120, 300, fill=(26, 20, 6), border=(120, 92, 18))
        fb = F(int(34 * s), True)
        d.text((100, 360), "Caution: 6 sessions is a", font=fb, fill=mix(BG, WARN, a))
        d.text((100, 360 + int(52 * s)), "small n. Treat as directional,", font=fb, fill=mix(BG, WARN, a))
        d.text((100, 360 + int(104 * s)), "not significant.", font=fb, fill=mix(BG, WARN, a))
        caption(d, "And it tells you when not to trust it.",
                clamp01((lt - 0.8) / 0.5) * a)

    else:  # endcard
        y = 380
        rise = (1 - ease(clamp01(lt / 0.7))) * 24
        d.text((80, y + rise), "Research Lens", font=f_huge, fill=mix(BG, INK, a))
        y += 110
        text_block(d, wrap("An MCP server for UX research repositories", f_body, W - 160),
                   80, y + rise, f_body, DIM, 44, a)
        y += 160
        a2 = clamp01((lt - 0.7) / 0.5)
        panel(d, 70, y, W - 140, 96, fill=(10, 12, 15))
        d.text((104, y + 30), "npx research-lens-mcp", font=f_bodyb,
               fill=mix((10, 12, 15), ACCENT, min(a, a2)))
        y += 150
        a3 = clamp01((lt - 1.2) / 0.5)
        d.text((80, y), "siddhidesign.github.io/Research-Lens",
               font=f_body, fill=mix(BG, INK, min(a, a3)))
        d.text((80, y + 56), "free and open source",
               font=f_small, fill=mix(BG, DIMMER, min(a, a3)))

    # global fade from/to black at the very start and end
    if t < 0.5:   img = fade_edges(img, t / 0.5)
    if t > TOTAL - 0.6: img = fade_edges(img, (TOTAL - t) / 0.6)
    return img

def main():
    if os.path.isdir(FRAMES): shutil.rmtree(FRAMES)
    os.makedirs(FRAMES)
    n = int(TOTAL * FPS)
    for i in range(n):
        render(i / FPS).save(os.path.join(FRAMES, f"f{i:05d}.png"))
        if i % 120 == 0: print(f"  {i}/{n}")
    mp4 = os.path.join(OUT, "research-lens.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(FPS), "-i", os.path.join(FRAMES, "f%05d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-movflags", "+faststart", mp4,
    ], check=True)
    shutil.rmtree(FRAMES)
    size = os.path.getsize(mp4) / 1024 / 1024
    print(f"\nwrote {mp4}  ({TOTAL:.1f}s, {W}x{H}, {size:.1f} MB)")

if __name__ == "__main__":
    main()
