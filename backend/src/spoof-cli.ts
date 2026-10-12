/**
 * Dev spoof helpers: parse terminal / npm-run commands for CDM fields (CTOT, TOBT, …).
 *
 * Used by:
 * - Backend stdin REPL (when the server terminal is a TTY)
 * - `npm run spoof -- SAS489 ctot=2055` (HTTP → running backend)
 */
import * as readline from "node:readline"
import type { DevSpoofFields, DevSpoofSnapshot } from "./flightStore.js"

const FIELD_ALIASES: Record<string, keyof DevSpoofFields> = {
    ctot: "ctot",
    tobt: "tobt",
    tsat: "tsat",
    ttot: "ttot",
    reason: "ctotReason",
    ctotreason: "ctotReason",
    asrt: "asrt",
    tsac: "tsac",
    ctoc: "ctoc",
    setby: "tobtSetBy",
    tobtsetby: "tobtSetBy",
    sts: "cdmSts",
    cdmsts: "cdmSts",
}

export const SPOOF_HELP = `Dev spoof (CDM times) — examples:
  spoof SAS489 ctot=2055
  spoof SAS489 ctot=2055 reason=TEST tobt=2028 tsat=2028
  spoof SAS489 ctot=              clear CTOT
  spoof SAS489 clear              clear all CDM spoof fields
  show SAS489
  help

Fields: ctot tobt tsat ttot reason asrt tsac ctoc setBy sts
One-shot (other terminal):  npm run spoof -- SAS489 ctot=2055`

export type SpoofCommand =
    | { kind: "help" }
    | { kind: "show"; callsign: string }
    | { kind: "spoof"; callsign: string; fields: DevSpoofFields }
    | { kind: "error"; message: string }

/** Parse `spoof SAS489 ctot=2055 reason=TEST` or argv tokens after callsign. */
export function parseSpoofCommand(line: string): SpoofCommand {
    const trimmed = line.trim()
    if (!trimmed) return { kind: "error", message: "Empty command" }

    const tokens = tokenize(trimmed)
    const cmd = tokens[0]?.toLowerCase()

    if (cmd === "help" || cmd === "?" || cmd === "h") {
        return { kind: "help" }
    }

    if (cmd === "show") {
        const callsign = tokens[1]
        if (!callsign) return { kind: "error", message: "Usage: show <callsign>" }
        return { kind: "show", callsign: callsign.toUpperCase() }
    }

    // `spoof CS k=v…` or bare `CS k=v…` (npm run spoof -- CS k=v)
    let callsign: string | undefined
    let rest: string[]
    if (cmd === "spoof" || cmd === "cdm") {
        callsign = tokens[1]
        rest = tokens.slice(2)
    } else if (tokens[0] && !tokens[0].includes("=")) {
        callsign = tokens[0]
        rest = tokens.slice(1)
    } else {
        return { kind: "error", message: "Usage: spoof <callsign> ctot=HHMM …" }
    }

    if (!callsign) return { kind: "error", message: "Usage: spoof <callsign> ctot=HHMM …" }

    if (rest.length === 1 && rest[0]!.toLowerCase() === "clear") {
        return { kind: "spoof", callsign: callsign.toUpperCase(), fields: { clearAll: true } }
    }

    if (rest.length === 0) {
        return { kind: "error", message: "Add fields (e.g. ctot=2055) or 'clear'" }
    }

    const fields: DevSpoofFields = {}
    for (const tok of rest) {
        const eq = tok.indexOf("=")
        if (eq <= 0) {
            return { kind: "error", message: `Bad field '${tok}' (want key=value)` }
        }
        const key = tok.slice(0, eq).toLowerCase()
        const value = tok.slice(eq + 1)
        const mapped = FIELD_ALIASES[key]
        if (!mapped) {
            return {
                kind: "error",
                message: `Unknown field '${key}'. Known: ${Object.keys(FIELD_ALIASES).join(", ")}`,
            }
        }
        if (mapped === "tobtSetBy") {
            const v = value.toUpperCase()
            if (v !== "" && v !== "P" && v !== "A") {
                return { kind: "error", message: "setBy must be P, A, or empty" }
            }
            fields.tobtSetBy = v as "P" | "A" | ""
        } else {
            ;(fields as Record<string, string | null | undefined>)[mapped] = value
        }
    }

    return { kind: "spoof", callsign: callsign.toUpperCase(), fields }
}

function tokenize(line: string): string[] {
    // Keep empty values: ctot=  → token "ctot=" when followed by space end
    const out: string[] = []
    const re = /(?:[^\s=]+=(?:"[^"]*"|'[^']*'|[^\s]*))|[^\s]+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
        let t = m[0]
        if (t.includes("=")) {
            const eq = t.indexOf("=")
            let v = t.slice(eq + 1)
            if (
                (v.startsWith('"') && v.endsWith('"')) ||
                (v.startsWith("'") && v.endsWith("'"))
            ) {
                v = v.slice(1, -1)
            }
            t = t.slice(0, eq + 1) + v
        }
        out.push(t)
    }
    return out
}

export function formatSpoofSnapshot(snap: DevSpoofSnapshot): string {
    const row = (k: string, v: unknown) =>
        v === undefined || v === null || v === "" ? null : `  ${k}=${v}`
    const lines = [
        `${snap.callsign}  ${snap.origin || "????"}→${snap.destination || "????"}  ${snap.flightRules || "?"}  gs=${snap.groundstate ?? ""}`,
        row("ctot", snap.ctot),
        row("reason", snap.ctotReason),
        row("ctotCancelled", snap.ctotCancelled ? "true" : undefined),
        row("tobt", snap.tobt),
        row("tsat", snap.tsat),
        row("ttot", snap.ttot),
        row("asrt", snap.asrt),
        row("tsac", snap.tsac),
        row("ctoc", snap.ctoc),
        row("setBy", snap.tobtSetBy),
        row("sts", snap.cdmSts),
        snap.localCdmAt != null ? `  localCdmAt=${new Date(snap.localCdmAt).toISOString()}` : null,
    ].filter(Boolean)
    return lines.join("\n")
}

export interface SpoofReplHandlers {
    apply: (callsign: string, fields: DevSpoofFields) => DevSpoofSnapshot | { error: string }
    show: (callsign: string) => DevSpoofSnapshot | undefined
}

/** Interactive prompt on the backend process stdin. */
export function startSpoofRepl(handlers: SpoofReplHandlers): void {
    if (!process.stdin.isTTY) return

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "efs> ",
    })

    console.log(`[spoof] Terminal ready — type 'help' (or: npm run spoof -- SAS489 ctot=2055)`)
    rl.prompt()

    rl.on("line", (line) => {
        const cmd = parseSpoofCommand(line)
        switch (cmd.kind) {
            case "help":
                console.log(SPOOF_HELP)
                break
            case "error":
                console.log(`[spoof] ${cmd.message}`)
                break
            case "show": {
                const snap = handlers.show(cmd.callsign)
                if (!snap) console.log(`[spoof] Flight not found: ${cmd.callsign}`)
                else console.log(formatSpoofSnapshot(snap))
                break
            }
            case "spoof": {
                const result = handlers.apply(cmd.callsign, cmd.fields)
                if ("error" in result) console.log(`[spoof] ${result.error}`)
                else console.log(`[spoof] OK\n${formatSpoofSnapshot(result)}`)
                break
            }
        }
        rl.prompt()
    })

    rl.on("close", () => {
        /* server exit */
    })
}

// ─── one-shot CLI (`npm run spoof -- …`) ─────────────────────────────────────

async function runOneShot(argv: string[]): Promise<void> {
    const port = Number(process.env.VATEFS_PORT || 17770)
    const base = `http://127.0.0.1:${port}`

    if (argv.length === 0 || argv[0] === "help" || argv[0] === "-h" || argv[0] === "--help") {
        console.log(SPOOF_HELP)
        process.exit(0)
    }

    const cmd = parseSpoofCommand(argv.join(" "))
    if (cmd.kind === "help") {
        console.log(SPOOF_HELP)
        process.exit(0)
    }
    if (cmd.kind === "error") {
        console.error(cmd.message)
        process.exit(1)
    }
    if (cmd.kind === "show") {
        const res = await fetch(`${base}/api/dev/spoof/${encodeURIComponent(cmd.callsign)}`)
        const body = (await res.json()) as DevSpoofSnapshot | { error: string }
        if (!res.ok) {
            console.error("error" in body ? body.error : res.statusText)
            process.exit(1)
        }
        console.log(formatSpoofSnapshot(body as DevSpoofSnapshot))
        process.exit(0)
    }

    const res = await fetch(`${base}/api/dev/spoof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsign: cmd.callsign, ...cmd.fields }),
    })
    const body = (await res.json()) as DevSpoofSnapshot | { error: string }
    if (!res.ok) {
        console.error("error" in body ? body.error : res.statusText)
        process.exit(1)
    }
    console.log(`[spoof] OK\n${formatSpoofSnapshot(body as DevSpoofSnapshot)}`)
}

const isMain =
    typeof process.argv[1] === "string" &&
    (process.argv[1].endsWith("spoof-cli.ts") || process.argv[1].endsWith("spoof-cli.js"))

if (isMain) {
    runOneShot(process.argv.slice(2)).catch((err) => {
        console.error(err instanceof Error ? err.message : err)
        process.exit(1)
    })
}
