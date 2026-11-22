"""Build AvrileSans-EFS-Bold.ttf with the same glyph adaptations as AvrileSans-EFS.ttf."""

from __future__ import annotations

from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph as TTGlyph

EFS = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS.ttf"
BOLD = r"C:\Users\maxlk\Downloads\avrile-sans\AvrileSans-Bold.ttf"
OUT = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-Bold.ttf"

# Meaningful EFS adaptations (ignore accidental LSB+1 noise on 3/5/6/7/9/currency).
ADAPTED = {"I", "M", "zero", "one", "slash", "asterisk"}


def draw_points(pen: TTGlyphPen, ops: list) -> None:
    for op, args in ops:
        if op == "moveTo":
            pen.moveTo(args[0])
        elif op == "lineTo":
            pen.lineTo(args[0])
        elif op == "qCurveTo":
            pen.qCurveTo(*args)
        elif op == "curveTo":
            pen.curveTo(*args)
        elif op == "closePath":
            pen.closePath()
        else:
            raise ValueError(op)


def glyph_from_ops(ops: list) -> TTGlyph:
    pen = TTGlyphPen(None)
    draw_points(pen, ops)
    return pen.glyph()


def record(font: TTFont, name: str) -> list:
    rp = RecordingPen()
    font.getGlyphSet()[name].draw(rp)
    return rp.value


def transform_ops(ops: list, sx: float = 1.0, sy: float = 1.0, dx: float = 0.0, dy: float = 0.0) -> list:
    out = []
    for op, args in ops:
        if op in ("moveTo", "lineTo"):
            x, y = args[0]
            out.append((op, ((x * sx + dx, y * sy + dy),)))
        elif op in ("qCurveTo", "curveTo"):
            pts = []
            for a in args:
                if a is None:
                    pts.append(None)
                else:
                    x, y = a
                    pts.append((x * sx + dx, y * sy + dy))
            out.append((op, tuple(pts)))
        else:
            out.append((op, args))
    return out


def build_bold_i() -> tuple[TTGlyph, int, int]:
    """EFS slab-I with Bold stem thickness (~162)."""
    stem = 162
    serif_h = 86
    lsb = 70
    # Keep EFS outer width feel; thicken stem around center.
    # EFS: outer 88..396 (width 308), center 242, stem 88, aw 484
    outer_l = 70
    outer_r = 414
    center = (outer_l + outer_r) / 2
    stem_l = center - stem / 2
    stem_r = center + stem / 2
    top = 714
    bot = 0
    # Rectangular slab like EFS (no bracketed serifs)
    ops = [
        ("moveTo", ((outer_r, bot),)),
        ("lineTo", ((outer_r, serif_h),)),
        ("lineTo", ((stem_r, serif_h),)),
        ("lineTo", ((stem_r, top - serif_h),)),
        ("lineTo", ((outer_r, top - serif_h),)),
        ("lineTo", ((outer_r, top),)),
        ("lineTo", ((outer_l, top),)),
        ("lineTo", ((outer_l, top - serif_h),)),
        ("lineTo", ((stem_l, top - serif_h),)),
        ("lineTo", ((stem_l, serif_h),)),
        ("lineTo", ((outer_l, serif_h),)),
        ("lineTo", ((outer_l, bot),)),
        ("closePath", ()),
    ]
    aw = int(round(outer_r + lsb))  # symmetric side bearings
    return glyph_from_ops(ops), aw, int(round(outer_l))


def build_bold_m(efs: TTFont, bold: TTFont) -> tuple[TTGlyph, int, int]:
    """Horizontally condense Bold M by the same ratio as Regular→EFS, then lift crotch bar."""
    # Ratio from regular metrics
    ratio = 715 / 856
    bold_aw, bold_lsb = bold["hmtx"].metrics["M"]
    ops = record(bold, "M")
    # Scale toward left side bearing origin
    scaled = transform_ops(ops, sx=ratio, dx=bold_lsb * (1 - ratio))
    # EFS also replaces the baseline crotch with a raised bar at y≈260.
    # After scaling, rebuild using EFS topology emboldened via scaling EFS outlines
    # and expanding stems slightly — cleaner: start from EFS M and expand X about center.
    efs_ops = record(efs, "M")
    efs_aw, efs_lsb = efs["hmtx"].metrics["M"]
    # Bold stem ~162 vs EFS stem ~82 (166-84 left leg ≈82). Expand factor:
    expand = (162 - 82) / 2  # ~40 per side
    # Expand each x away from glyph center
    bounds_xs = []
    for op, args in efs_ops:
        if op in ("moveTo", "lineTo"):
            bounds_xs.append(args[0][0])
        elif op in ("qCurveTo", "curveTo"):
            for a in args:
                if a is not None:
                    bounds_xs.append(a[0])
    cx = (min(bounds_xs) + max(bounds_xs)) / 2

    def embolden_x(x: float) -> float:
        return x + (expand if x >= cx else -expand)

    out = []
    for op, args in efs_ops:
        if op in ("moveTo", "lineTo"):
            x, y = args[0]
            out.append((op, ((embolden_x(x), y),)))
        elif op in ("qCurveTo", "curveTo"):
            pts = []
            for a in args:
                if a is None:
                    pts.append(None)
                else:
                    x, y = a
                    pts.append((embolden_x(x), y))
            out.append((op, tuple(pts)))
        else:
            out.append((op, args))

    # New advance: EFS advance + 2*expand
    aw = int(round(efs_aw + 2 * expand))
    lsb = int(round(efs_lsb - expand))
    # Prefer condensed bold target if closer
    target_aw = int(round(bold_aw * ratio))
    # Blend: use emboldened EFS advance but clamp near condensed bold
    aw = max(aw, target_aw - 20)
    return glyph_from_ops(out), aw, lsb


def build_bold_zero(bold: TTFont) -> tuple[TTGlyph, int, int]:
    """Bold zero + EFS-style diagonal slash."""
    ops = list(record(bold, "zero"))
    # EFS slash on regular zero; thicken ~+20% for bold and fit bold bounds.
    # Regular slash: (84,172)-(484,492)-(464,554)-(68,236)
    # Scale X from regular outer (48..496) to bold (33..510)
    reg_x0, reg_x1 = 48, 496
    bold_aw, bold_lsb = bold["hmtx"].metrics["zero"]
    # Use bold glyph bounds approx
    bx0, bx1 = 33, 510

    def sx(x: float) -> float:
        return bx0 + (x - reg_x0) * (bx1 - bx0) / (reg_x1 - reg_x0)

    # Thicken slash perpendicular-ish by pushing corners
    slash = [
        ("moveTo", ((sx(84), 172),)),
        ("lineTo", ((sx(484), 492),)),
        ("lineTo", ((sx(464), 554),)),
        ("lineTo", ((sx(68), 236),)),
        ("closePath", ()),
    ]
    # Put slash first so counter/outer winding matches EFS
    return glyph_from_ops(slash + ops), bold_aw, bold_lsb


def build_bold_one(bold: TTFont) -> tuple[TTGlyph, int, int]:
    """Add EFS-style baseline bar under Bold one."""
    ops = record(bold, "one")
    aw, lsb = bold["hmtx"].metrics["one"]
    bar_h = 100
    bar_l = 70
    bar_r = 500

    def lift_bottom(ops_in: list) -> list:
        out = []
        for op, args in ops_in:
            if op in ("moveTo", "lineTo"):
                x, y = args[0]
                out.append((op, ((x, bar_h if y == 0 else y),)))
            elif op in ("qCurveTo", "curveTo"):
                pts = []
                for a in args:
                    if a is None:
                        pts.append(None)
                    else:
                        x, y = a
                        pts.append((x, bar_h if y == 0 else y))
                out.append((op, tuple(pts)))
            else:
                out.append((op, args))
        return out

    bar = [
        ("moveTo", ((bar_r, 0),)),
        ("lineTo", ((bar_l, 0),)),
        ("lineTo", ((bar_l, bar_h),)),
        ("lineTo", ((bar_r, bar_h),)),
        ("closePath", ()),
    ]
    return glyph_from_ops(bar + lift_bottom(ops)), aw, min(lsb, bar_l)


def build_bold_slash(bold: TTFont) -> tuple[TTGlyph, int, int]:
    """Extend slash beyond em box like EFS (≈±60)."""
    ops = record(bold, "slash")
    aw, _lsb = bold["hmtx"].metrics["slash"]
    # EFS delta from regular: y 0..714 → -60..774, x shifted ~-60
    extended = transform_ops(ops, dx=-60, dy=0)
    # Also scale y from [0,714] to [-60,774]
    out = []
    for op, args in extended:
        if op in ("moveTo", "lineTo"):
            x, y = args[0]
            y2 = -60 + (y / 714.0) * (774 - (-60))
            out.append((op, ((x, y2),)))
        else:
            out.append((op, args))
    # LSB becomes bold_lsb-60; EFS used -51 from 9 → -60-ish
    lsb = bold["hmtx"].metrics["slash"][1] - 60
    return glyph_from_ops(out), aw, lsb


def build_bold_asterisk(efs: TTFont) -> tuple[TTGlyph, int, int]:
    """Use EFS asterisk design, slightly expanded for bold weight."""
    ops = record(efs, "asterisk")
    aw, lsb = efs["hmtx"].metrics["asterisk"]
    # Drop degenerate zero-area contours (move+line+close)
    cleaned: list = []
    i = 0
    while i < len(ops):
        if (
            i + 2 < len(ops)
            and ops[i][0] == "moveTo"
            and ops[i + 1][0] == "lineTo"
            and ops[i + 2][0] == "closePath"
        ):
            i += 3
            continue
        cleaned.append(ops[i])
        i += 1

    # Expand about center for bolder strokes
    xs, ys = [], []
    for op, args in cleaned:
        if op in ("moveTo", "lineTo"):
            xs.append(args[0][0])
            ys.append(args[0][1])
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    expand = 12

    def grow(x, y):
        gx = x + (expand if x >= cx else -expand)
        gy = y + (expand * 0.4 if y >= cy else -expand * 0.4)
        return (gx, gy)

    out = []
    for op, args in cleaned:
        if op in ("moveTo", "lineTo"):
            out.append((op, (grow(*args[0]),)))
        elif op in ("qCurveTo", "curveTo"):
            pts = []
            for a in args:
                if a is None:
                    pts.append(None)
                else:
                    pts.append(grow(*a))
            out.append((op, tuple(pts)))
        else:
            out.append((op, args))
    return glyph_from_ops(out), aw, max(0, lsb - expand)


def main() -> None:
    efs = TTFont(EFS)
    bold = TTFont(BOLD)

    # Start from Bold master
    out_font = TTFont(BOLD)

    replacements = {
        "I": build_bold_i(),
        "M": build_bold_m(efs, bold),
        "zero": build_bold_zero(bold),
        "one": build_bold_one(bold),
        "slash": build_bold_slash(bold),
        "asterisk": build_bold_asterisk(efs),
    }

    glyf = out_font["glyf"]
    hmtx = out_font["hmtx"].metrics

    for name, (glyph, aw, lsb) in replacements.items():
        glyf[name] = glyph
        hmtx[name] = (int(aw), int(lsb))
        print(f"replaced {name}: aw={aw} lsb={lsb}")

    # Update name table to mark as EFS Bold
    name = out_font["name"]
    for rec in name.names:
        try:
            text = rec.toUnicode()
        except Exception:
            continue
        if rec.nameID == 1 and "Avrile" in text:
            rec.string = "Avrile Sans EFS"
        elif rec.nameID == 2:
            rec.string = "Bold"
        elif rec.nameID == 4:
            rec.string = "Avrile Sans EFS Bold"
        elif rec.nameID == 6:
            rec.string = "AvrileSans-EFS-Bold"
        elif rec.nameID == 16:
            rec.string = "Avrile Sans EFS"
        elif rec.nameID == 17:
            rec.string = "Bold"

    for name in ADAPTED:
        g = glyf[name]
        g.recalcBounds(glyf)

    out_font.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
