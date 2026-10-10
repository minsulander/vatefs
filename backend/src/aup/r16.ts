/**
 * R16 ("R16 utökad") status derivation from parsed AUP restrictions.
 * Pure functions — no network / pdf dependencies, unit tested in r16.test.ts.
 */
import type { AupR16Status, Restriction } from "./types.js"

/** Default R16 ceiling is 1600 ft; only a higher published upper limit counts as "utökad". */
export const R16_EXTENDED_ABOVE_FT = 1600

/** Normalize an AUP area label: "ES R16" / "ESR16" / "r16" → "R16". Other areas → null. */
export function normalizeR16Name(name: string): "R16" | null {
    const n = name.toUpperCase().replace(/\s+/g, "")
    return n === "R16" || n === "ESR16" ? "R16" : null
}

/** Upper vertical limit of a restriction in feet (FL → ×100; A/FL band uses its FL ceiling). */
export function upperLimitFt(r: Pick<Restriction, "altitude" | "altitudeType" | "altitudeUpper">): number | null {
    if (r.altitudeUpper) {
        const fl = parseInt(r.altitudeUpper, 10)
        return Number.isFinite(fl) ? fl * 100 : null
    }
    const v = parseInt(r.altitude, 10)
    if (!Number.isFinite(v)) return null
    return r.altitudeType === "FL" ? v * 100 : v
}

export const INACTIVE_R16: AupR16Status = {
    active: false,
    topAltitudeFt: null,
    from: null,
    to: null,
    suggestConfigId: null,
    fetchStatus: 'pending',
}

export interface EssaOps {
    arr: string[]
    dep: string[]
}

function rwySet(rwys: string[] | undefined): string[] {
    return (rwys ?? []).map((r) => r.toUpperCase().replace(/[^0-9LRC]/g, "")).sort()
}

/**
 * ESSA RWY config suggestion while R16 is utökad:
 *  - ARR+DEP 19L (single runway)  → 9C  (19L-E departures)
 *  - ARR 26 / DEP 19L             → 15C (26/19L-E)
 *  - anything else                → null (strip only)
 */
export function suggestEssaConfigForR16(ops: EssaOps | null | undefined): "9C" | "15C" | null {
    if (!ops) return null
    const arr = rwySet(ops.arr)
    const dep = rwySet(ops.dep)
    if (dep.length !== 1 || dep[0] !== "19L" || arr.length !== 1) return null
    if (arr[0] === "19L") return "9C"
    if (arr[0] === "26") return "15C"
    return null
}

/** Build R16 status for `now` from all parsed restrictions (struck rows already removed). */
export function computeR16Status(
    restrictions: readonly Restriction[],
    now: Date,
    ops?: EssaOps | null,
): AupR16Status {
    const t = now.getTime()
    let top: number | null = null
    let from: number | null = null
    let to: number | null = null

    for (const r of restrictions) {
        if (!normalizeR16Name(r.name)) continue
        if (!(r.from.getTime() <= t && t < r.to.getTime())) continue
        const upper = upperLimitFt(r)
        if (upper == null || upper <= R16_EXTENDED_ABOVE_FT) continue
        top = top == null ? upper : Math.max(top, upper)
        from = from == null ? r.from.getTime() : Math.min(from, r.from.getTime())
        to = to == null ? r.to.getTime() : Math.max(to, r.to.getTime())
    }

    if (top == null || from == null || to == null) return { ...INACTIVE_R16 }
    return {
        active: true,
        topAltitudeFt: top,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        suggestConfigId: suggestEssaConfigForR16(ops),
    }
}

export function sameR16Status(a: AupR16Status, b: AupR16Status): boolean {
    return (
        a.active === b.active &&
        a.topAltitudeFt === b.topAltitudeFt &&
        a.from === b.from &&
        a.to === b.to &&
        a.suggestConfigId === b.suggestConfigId &&
        a.fetchStatus === b.fetchStatus
    )
}
