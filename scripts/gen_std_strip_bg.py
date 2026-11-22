"""Generate blank paper strip backgrounds (cell borders only).

AD  = ESGG / ESSB / ESMS Landvetter-style paper-flight grid (look: paper)
T   = generic StdPaperStrip grid (look: std)
"""
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 1130, 120
LINE = 2


def edges_from_weights(weights: list[float], width: int) -> list[int]:
    total = sum(weights)
    out = [0]
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        x = round(acc / total * width) if i < len(weights) - 1 else width
        out.append(x)
    out[-1] = width
    return out


def draw_vline(d: ImageDraw.ImageDraw, x: int, y0: int, y1: int) -> None:
    d.line([(x, y0), (x, y1)], fill="#111111", width=LINE)


def draw_hline(d: ImageDraw.ImageDraw, x0: int, x1: int, y: int) -> None:
    d.line([(x0, y), (x1, y)], fill="#111111", width=LINE)


def draw_ad_strip(path: Path) -> None:
    """
    Landvetter / ESGG / ESSB / ESMS paper-flight (DEP chrome).

    Columns (fr): 1.9 0.9 1.9 0.9 0.9 1.0 1.75
      left | time | sid | adep | ades | rte | ctot

    Borders (from FlightStrip.vue):
      - Full-height vline after: left, time, sid, ades
      - Top-half vline after: adep, rte
      - Mid horizontal on: time, adep, ades, rte
      - left / sid / ctot: no mid rule
    """
    weights = [1.9, 0.9, 1.9, 0.9, 0.9, 1.0, 1.75]
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    xs = edges_from_weights(weights, W)
    mid = H // 2

    d.rectangle([0, 0, W - 1, H - 1], outline="#111111", width=LINE)

    # Full-height verticals after cols 0,1,2,4 (left, time, sid, ades)
    for after in (1, 2, 3, 5):
        draw_vline(d, xs[after], 0, H - 1)

    # Top-half verticals after adep (3) and rte (5) → indices 4 and 6
    for after in (4, 6):
        draw_vline(d, xs[after], 0, mid)

    # Mid horizontals: time(1), adep(3), ades(4), rte(5)
    for col in (1, 3, 4, 5):
        draw_hline(d, xs[col], xs[col + 1], mid)

    img.save(path)
    print(f"wrote {path} (AD / Landvetter paper)")


def draw_t_strip(path: Path) -> None:
    """
    Generic StdPaperStrip (T / non-AD paper).

    Columns: 400 250 460 200 200 250 500
    Borders (from StdPaperStrip.vue):
      - Full-height vline between all cols except adep→ades (top half only)
      - Mid horizontal on: time, adep, ades, route points
      - id / sid / col7: no mid rule
    """
    weights = [400, 250, 460, 200, 200, 250, 500]
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    xs = edges_from_weights(weights, W)
    mid = H // 2

    d.rectangle([0, 0, W - 1, H - 1], outline="#111111", width=LINE)

    for i, x in enumerate(xs[1:-1], start=1):
        # i == 4 → line after adep (between ADEP|ADES): top half only
        if i == 4:
            draw_vline(d, x, 0, mid)
        else:
            draw_vline(d, x, 0, H - 1)

    for col in (1, 3, 4, 5):
        draw_hline(d, xs[col], xs[col + 1], mid)

    img.save(path)
    print(f"wrote {path} (T / std paper)")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    public = root / "frontend" / "public"
    public.mkdir(parents=True, exist_ok=True)

    for dest in (public, root):
        draw_ad_strip(dest / "std-strip-bg-ad.png")
        draw_t_strip(dest / "std-strip-bg-t.png")


if __name__ == "__main__":
    main()
