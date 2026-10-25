/** Local clock prefix, same shape as EuroScope's `[HH:MM:SS]` log lines. */
export function logTimestamp(now = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0")
    return `[${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}] `
}

/** Prefix every line so a multi-line message can still be matched to an ES log. */
export function prefixLogLines(text: string, now = new Date()): string {
    const ts = logTimestamp(now)
    return text.split("\n").map((line) => ts + line).join("\n")
}
