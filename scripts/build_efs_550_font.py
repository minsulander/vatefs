"""Build AvrileSans-EFS-550 by interpolating EFS Medium (500) ↔ SemiBold (600)."""

from __future__ import annotations

from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

MED = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-Medium.ttf"
SEMI = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-SemiBold.ttf"
OUT_TTF = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-550.ttf"
OUT_WOFF = r"C:\Users\maxlk\Documents\GitHub\vatefs\frontend\src\assets\fonts\AvrileSans-EFS-550.woff"

T = 0.5


def record(font: TTFont, name: str) -> list:
    rp = RecordingPen()
    font.getGlyphSet()[name].draw(rp)
    return rp.value


def ops_compatible(a: list, b: list) -> bool:
    if len(a) != len(b):
        return False
    for (op_a, args_a), (op_b, args_b) in zip(a, b):
        if op_a != op_b:
            return False
        if op_a in ("qCurveTo", "curveTo"):
            if len(args_a) != len(args_b):
                return False
            for pa, pb in zip(args_a, args_b):
                if (pa is None) != (pb is None):
                    return False
    return True


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def interp_ops(a: list, b: list, t: float) -> list:
    out = []
    for (op, args_a), (_, args_b) in zip(a, b):
        if op in ("moveTo", "lineTo"):
            x = lerp(args_a[0][0], args_b[0][0], t)
            y = lerp(args_a[0][1], args_b[0][1], t)
            out.append((op, ((x, y),)))
        elif op in ("qCurveTo", "curveTo"):
            pts = []
            for pa, pb in zip(args_a, args_b):
                if pa is None:
                    pts.append(None)
                else:
                    pts.append((lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t)))
            out.append((op, tuple(pts)))
        else:
            out.append((op, args_a))
    return out


def glyph_from_ops(ops: list):
    pen = TTGlyphPen(None)
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
    return pen.glyph()


def main() -> None:
    med = TTFont(MED)
    semi = TTFont(SEMI)
    out = TTFont(MED)

    glyf = out["glyf"]
    hmtx = out["hmtx"].metrics
    gs_m = med.getGlyphSet()
    gs_s = semi.getGlyphSet()

    ok = 0
    fallback = 0
    for name in out.getGlyphOrder():
        if name not in gs_m or name not in gs_s:
            continue
        try:
            ops_m = record(med, name)
            ops_s = record(semi, name)
        except Exception:
            fallback += 1
            continue
        if not ops_compatible(ops_m, ops_s):
            # Mid bias: keep medium when topology differs (lighter than semi)
            fallback += 1
            continue
        aw_m, lsb_m = med["hmtx"].metrics[name]
        aw_s, lsb_s = semi["hmtx"].metrics[name]
        g = glyph_from_ops(interp_ops(ops_m, ops_s, T))
        g.recalcBounds(glyf)
        glyf[name] = g
        hmtx[name] = (
            int(round(lerp(aw_m, aw_s, T))),
            int(round(lerp(lsb_m, lsb_s, T))),
        )
        ok += 1

    out["OS/2"].usWeightClass = 550
    for rec in out["name"].names:
        try:
            _ = rec.toUnicode()
        except Exception:
            continue
        if rec.nameID == 1:
            rec.string = "Avrile Sans EFS"
        elif rec.nameID == 2:
            rec.string = "Medium"
        elif rec.nameID == 4:
            rec.string = "Avrile Sans EFS 550"
        elif rec.nameID == 6:
            rec.string = "AvrileSans-EFS-550"
        elif rec.nameID == 16:
            rec.string = "Avrile Sans EFS"
        elif rec.nameID == 17:
            rec.string = "550"

    out.save(OUT_TTF)
    print(f"wrote {OUT_TTF} (interp={ok}, fallback={fallback})")

    woff = TTFont(OUT_TTF)
    woff.flavor = "woff"
    woff.save(OUT_WOFF)
    print(f"wrote {OUT_WOFF}")


if __name__ == "__main__":
    main()
