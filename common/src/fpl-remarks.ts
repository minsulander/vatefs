/**
 * ICAO item-18 FPL remarks helpers (P/ persons on board, etc.).
 */

/** Parse P/nnn from FPL remarks → always 3 digits when present. */
export function parsePobFromRemarks(remarks: string | undefined | null): string | undefined {
    if (!remarks) return undefined
    const m = remarks.match(/\bP\/(\d{1,3})\b/i)
    if (!m?.[1]) return undefined
    return m[1]!.padStart(3, "0")
}

/**
 * Set or clear P/XXX at the end of FPL remarks (always 3 digits when set).
 * Removes any existing P/nnn tokens first.
 */
export function withPobInRemarks(
    remarks: string | undefined | null,
    pob: string | number | undefined | null,
): string {
    const base = (remarks || "")
        .replace(/\bP\/\d{1,3}\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()

    if (pob === undefined || pob === null || pob === "") {
        return base
    }

    const n = typeof pob === "number" ? pob : parseInt(String(pob).replace(/\D/g, ""), 10)
    if (!Number.isFinite(n) || n < 0 || n > 999) return base
    const token = `P/${String(Math.trunc(n)).padStart(3, "0")}`
    return base ? `${base} ${token}` : token
}
