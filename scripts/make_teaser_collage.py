"""Build README teaser collage from ESGG paper / ESSA / RTC screenshots."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / "frontend" / "public" / "screenshots"
paths = [
    (root / "esgg-paper.png", "ESGG · paper"),
    (root / "essa-saab.png", "ESSA"),
    (root / "rtc-multi.png", "RTC"),
]

imgs = [Image.open(p).convert("RGB") for p, _ in paths]
target_h = 720
scaled = []
for im in imgs:
    w = int(im.width * (target_h / im.height))
    scaled.append(im.resize((w, target_h), Image.Resampling.LANCZOS))

gap = 12
label_h = 42
pad = 16
total_w = sum(im.width for im in scaled) + gap * (len(scaled) - 1) + pad * 2
total_h = target_h + label_h + pad * 2 + 8

canvas = Image.new("RGB", (total_w, total_h), (32, 32, 36))
draw = ImageDraw.Draw(canvas)
try:
    font = ImageFont.truetype("arial.ttf", 22)
except OSError:
    font = ImageFont.load_default()

x = pad
y = pad + label_h
for im, (_, label) in zip(scaled, paths):
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    draw.text((x + (im.width - tw) // 2, pad + 8), label, fill=(230, 230, 235), font=font)
    canvas.paste(im, (x, y))
    draw.rectangle([x - 1, y - 1, x + im.width, y + im.height], outline=(70, 70, 78))
    x += im.width + gap

out = root / "teaser.png"
canvas.save(out, "PNG", optimize=True)
print(f"wrote {out} ({canvas.size[0]}x{canvas.size[1]})")
