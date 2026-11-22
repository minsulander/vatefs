"""Build AvrileSans-EFS-Medium: stock Medium (500) + same EFS glyph adaptations."""

from __future__ import annotations

from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import Glyph as TTGlyph

EFS = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS.ttf"
MED = r"C:\Users\maxlk\Downloads\avrile-sans\AvrileSans-Medium.ttf"
OUT_TTF = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-Medium.ttf"
OUT_WOFF = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-Medium.woff"


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


def build_med_i() -> tuple[TTGlyph, int, int]:
    """EFS slab-I with Medium stem (~106, between regular 88 and semi 125)."""
    stem = 106
    serif_h = 68
    outer_l = 82
    outer_r = 402
    center = (outer_l + outer_r) / 2
    stem_l = center - stem / 2
    stem_r = center + stem / 2
    top = 714
    ops = [
        ("moveTo", ((outer_r, 0),)),
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
        ("lineTo", ((outer_l, 0),)),
        ("closePath", ()),
    ]
    aw = int(round(outer_r + outer_l))
    return glyph_from_ops(ops), aw, int(round(outer_l))


def build_med_m(efs: TTFont, med: TTFont) -> tuple[TTGlyph, int, int]:
    ratio = 715 / 856
    med_aw, _ = med["hmtx"].metrics["M"]
    efs_ops = record(efs, "M")
    efs_aw, efs_lsb = efs["hmtx"].metrics["M"]
    expand = (106 - 82) / 2
    xs = []
    for op, args in efs_ops:
        if op in ("moveTo", "lineTo"):
            xs.append(args[0][0])
        elif op in ("qCurveTo", "curveTo"):
            for a in args:
                if a is not None:
                    xs.append(a[0])
    cx = (min(xs) + max(xs)) / 2

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
    aw = max(int(round(efs_aw + 2 * expand)), int(round(med_aw * ratio)) - 20)
    lsb = int(round(efs_lsb - expand))
    return glyph_from_ops(out), aw, lsb


def build_med_zero(med: TTFont) -> tuple[TTGlyph, int, int]:
    ops = list(record(med, "zero"))
    aw, lsb = med["hmtx"].metrics["zero"]
    bx0, bx1 = 44, 500
    reg_x0, reg_x1 = 48, 496

    def sx(x: float) -> float:
        return bx0 + (x - reg_x0) * (bx1 - bx0) / (reg_x1 - reg_x0)

    slash = [
        ("moveTo", ((sx(84), 172),)),
        ("lineTo", ((sx(484), 492),)),
        ("lineTo", ((sx(464), 554),)),
        ("lineTo", ((sx(68), 236),)),
        ("closePath", ()),
    ]
    return glyph_from_ops(slash + ops), aw, lsb


def build_med_one(med: TTFont) -> tuple[TTGlyph, int, int]:
    ops = record(med, "one")
    aw, lsb = med["hmtx"].metrics["one"]
    bar_h = 80
    bar_l = 80
    bar_r = 490

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


def build_med_slash(med: TTFont) -> tuple[TTGlyph, int, int]:
    ops = record(med, "slash")
    aw, _ = med["hmtx"].metrics["slash"]
    extended = transform_ops(ops, dx=-60)
    out = []
    for op, args in extended:
        if op in ("moveTo", "lineTo"):
            x, y = args[0]
            y2 = -60 + (y / 714.0) * (774 - (-60))
            out.append((op, ((x, y2),)))
        else:
            out.append((op, args))
    lsb = med["hmtx"].metrics["slash"][1] - 60
    return glyph_from_ops(out), aw, lsb


def build_med_asterisk(efs: TTFont) -> tuple[TTGlyph, int, int]:
    ops = record(efs, "asterisk")
    aw, lsb = efs["hmtx"].metrics["asterisk"]
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
    xs, ys = [], []
    for op, args in cleaned:
        if op in ("moveTo", "lineTo"):
            xs.append(args[0][0])
            ys.append(args[0][1])
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    expand = 3

    def grow(x, y):
        return (
            x + (expand if x >= cx else -expand),
            y + (expand * 0.4 if y >= cy else -expand * 0.4),
        )

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
    med = TTFont(MED)
    out_font = TTFont(MED)

    replacements = {
        "I": build_med_i(),
        "M": build_med_m(efs, med),
        "zero": build_med_zero(med),
        "one": build_med_one(med),
        "slash": build_med_slash(med),
        "asterisk": build_med_asterisk(efs),
    }

    glyf = out_font["glyf"]
    hmtx = out_font["hmtx"].metrics
    for name, (glyph, aw, lsb) in replacements.items():
        glyf[name] = glyph
        hmtx[name] = (int(aw), int(lsb))
        glyph.recalcBounds(glyf)
        print(f"replaced {name}: aw={aw} lsb={lsb}")

    out_font["OS/2"].usWeightClass = 500
    for rec in out_font["name"].names:
        try:
            _ = rec.toUnicode()
        except Exception:
            continue
        if rec.nameID == 1:
            rec.string = "Avrile Sans EFS"
        elif rec.nameID == 2:
            rec.string = "Medium"
        elif rec.nameID == 4:
            rec.string = "Avrile Sans EFS Medium"
        elif rec.nameID == 6:
            rec.string = "AvrileSans-EFS-Medium"
        elif rec.nameID == 16:
            rec.string = "Avrile Sans EFS"
        elif rec.nameID == 17:
            rec.string = "Medium"

    out_font.save(OUT_TTF)
    print("wrote", OUT_TTF)

    woff = TTFont(OUT_TTF)
    woff.flavor = "woff"
    woff.save(OUT_WOFF)
    print("wrote", OUT_WOFF)


if __name__ == "__main__":
    main()
