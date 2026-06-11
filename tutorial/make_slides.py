from __future__ import annotations

import json
import math
import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
slides = json.loads((ROOT / 'tutorial_script.json').read_text())
OUT = ROOT / 'slides'
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1080
BG = (5, 8, 22)
CARD = (15, 23, 42)
CARD2 = (2, 6, 23)
CYAN = (34, 211, 238)
PURPLE = (139, 92, 246)
WHITE = (248, 250, 252)
MUTED = (148, 163, 184)
GREEN = (83, 252, 24)
TWITCH = (169, 112, 255)
XCOL = (226, 232, 240)
RED = (239, 68, 68)


def font(size: int, bold: bool = False):
    paths = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ]
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

F_EYEBROW = font(30, True)
F_TITLE = font(76, True)
F_SUB = font(38, False)
F_BULLET = font(38, False)
F_SMALL = font(26, False)
F_LOGO = font(34, True)


def gradient_line(draw: ImageDraw.ImageDraw, xy, width=8):
    x1, y1, x2, y2 = xy
    steps = max(1, x2 - x1)
    for i in range(steps):
        t = i / steps
        c = tuple(int(CYAN[j] * (1 - t) + PURPLE[j] * t) for j in range(3))
        draw.line((x1 + i, y1, x1 + i, y2), fill=c, width=width)


def rounded_rect(draw, box, fill, outline=None, radius=32, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def wrap(draw, text, fnt, max_width):
    words = text.split()
    lines, cur = [], ''
    for word in words:
        test = (cur + ' ' + word).strip()
        if draw.textbbox((0, 0), test, font=fnt)[2] <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_dashboard_mock(draw, x, y, w, h, index):
    rounded_rect(draw, (x, y, x + w, y + h), CARD, (51, 65, 85), 36, 2)
    draw.text((x + 38, y + 32), 'Stream Chat Aggregator', font=F_LOGO, fill=WHITE)
    draw.text((x + 38, y + 78), 'Shared session dashboard', font=F_SMALL, fill=MUTED)
    # sessions panel
    rounded_rect(draw, (x + 40, y + 135, x + 380, y + h - 40), CARD2, (36, 50, 70), 22, 2)
    draw.text((x + 68, y + 165), 'Sessions', font=font(28, True), fill=WHITE)
    for i, name in enumerate(['Penpal Live', 'Podcast Stream', 'Charity Event']):
        fill = (30, 41, 59) if i == 0 else (15, 23, 42)
        rounded_rect(draw, (x + 68, y + 220 + i * 86, x + 352, y + 282 + i * 86), fill, (51, 65, 85), 16, 2)
        draw.text((x + 88, y + 235 + i * 86), name, font=font(24, True), fill=WHITE if i == 0 else MUTED)
    # platform cards
    labels = [('TWITCH', TWITCH), ('KICK', GREEN), ('X', XCOL)]
    for i, (label, color) in enumerate(labels):
        px = x + 430 + i * 250
        rounded_rect(draw, (px, y + 135, px + 215, y + 310), CARD2, (36, 50, 70), 22, 2)
        draw.text((px + 24, y + 165), label, font=font(28, True), fill=color)
        draw.text((px + 24, y + 215), 'connected', font=font(23, False), fill=WHITE)
        rounded_rect(draw, (px + 24, y + 250, px + 150, y + 290), (34, 211, 238), None, 15)
        draw.text((px + 49, y + 257), 'Start', font=font(20, True), fill=(2, 6, 23))
    # overlay mock feed
    rounded_rect(draw, (x + 430, y + 350, x + w - 40, y + h - 40), CARD2, (36, 50, 70), 22, 2)
    draw.text((x + 460, y + 380), 'Overlay preview', font=font(28, True), fill=WHITE)
    rows = [('Twitch · Penpal', 'viewer123: hello stream!', TWITCH), ('Kick · Guest B', 'fan456: what\'s up?', GREEN), ('X · Penpal', 'user789: live now', XCOL)]
    for i, (meta, msg, color) in enumerate(rows):
        ry = y + 435 + i * 85
        draw.rounded_rectangle((x + 460, ry, x + w - 75, ry + 62), radius=18, fill=(15, 23, 42))
        draw.rectangle((x + 460, ry, x + 468, ry + 62), fill=color)
        draw.text((x + 490, ry + 10), meta, font=font(21, True), fill=color)
        draw.text((x + 735, ry + 10), msg, font=font(27, False), fill=WHITE)

for idx, slide in enumerate(slides, 1):
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)
    # background accents
    for r, alpha in [(360, 30), (520, 16)]:
        color = tuple(min(255, c + alpha) for c in (8, 20, 45))
        draw.ellipse((-180, -180, r, r), fill=color)
    gradient_line(draw, (90, 92, 700, 92), width=10)
    draw.text((90, 125), f'TUTORIAL  •  STEP {idx} OF {len(slides)}', font=F_EYEBROW, fill=CYAN)
    y = 175
    for line in wrap(draw, slide['title'], F_TITLE, 1020):
        draw.text((90, y), line, font=F_TITLE, fill=WHITE)
        y += 88
    y += 10
    for line in wrap(draw, slide['subtitle'], F_SUB, 1040):
        draw.text((92, y), line, font=F_SUB, fill=MUTED)
        y += 50

    bx, by = 110, y + 35
    for bullet in slide['bullets']:
        draw.ellipse((bx, by + 13, bx + 18, by + 31), fill=CYAN)
        for j, line in enumerate(wrap(draw, bullet, F_BULLET, 820)):
            draw.text((bx + 42, by + j * 44), line, font=F_BULLET, fill=WHITE)
        by += 82

    draw_dashboard_mock(draw, 1085, 150, 740, 760, idx)
    draw.text((90, H - 80), 'Built for Twitch + Kick + X livestream chat collaboration', font=F_SMALL, fill=MUTED)
    draw.text((W - 390, H - 80), 'web-iota-eight-87.vercel.app', font=F_SMALL, fill=MUTED)
    img.save(OUT / f'slide_{idx:02d}.png')

print(f'created {len(slides)} slides in {OUT}')
