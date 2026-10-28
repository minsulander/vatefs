/**
 * Resolve EuroScope package paths (ESAA / Plugins / ICAO).
 * Some installs nest the sector package (…/EuroScope/ESAA/ESAA/Plugins/…).
 * Others keep the package outside AppData (Documents, Desktop VATSIM folders);
 * we recover those via PRF absolute paths and SCT/ESE hints in ES logs.
 */

import fs from "fs"
import os from "os"
import path from "path"

const MAX_DEPTH = 5

/** Marker files that identify a real ESAA Plugins folder. */
const PLUGIN_MARKERS = [
    "TopSkyCPDLChoppieCode.txt",
    "TopSkyCPDLC.txt",
    "TopSkyAirspace.txt",
    "GRpluginStands.txt",
    "TopSkySoundCPDLC.wav",
    "CDM.dll",
    "CDMconfig.xml",
]

/** Absolute Windows/POSIX path ending in .sct / .ese (and optional quotes). */
const SECTOR_PATH_RE =
    /(?:^|[\s"'=])(([A-Za-z]:\\|\\\\|\/)[^\s"'<>|*?]+\.(?:sct|ese))\b/gi

/** When package lives outside the EuroScope settings dir (Håkan-style installs). */
let packageDirOverride: string | undefined

export function getEsaaPackageDirOverride(): string | undefined {
    return packageDirOverride
}

export function setEsaaPackageDirOverride(dir: string | undefined): void {
    if (!dir) {
        packageDirOverride = undefined
        return
    }
    try {
        packageDirOverride = fs.existsSync(dir) ? path.resolve(dir) : undefined
    } catch {
        packageDirOverride = undefined
    }
}

function scoreEsaaCandidate(esaaDir: string): number {
    const plugins = path.join(esaaDir, "Plugins")
    if (!fs.existsSync(plugins) || !fs.statSync(plugins).isDirectory()) return 0
    let score = 10
    for (const name of PLUGIN_MARKERS) {
        if (fs.existsSync(path.join(plugins, name))) score += 5
    }
    if (fs.existsSync(path.join(esaaDir, "ICAO", "ICAO_Airlines.txt"))) score += 2
    try {
        const n = fs.readdirSync(plugins).length
        score += Math.min(n, 20)
    } catch {
        /* ignore */
    }
    return score
}

/**
 * Walk up from a file or directory looking for a package dir that has Plugins/
 * with TopSky/GRP/CDM markers (or is named ESAA and has Plugins/).
 */
export function resolvePackageDirFromPathHint(
    fileOrDir: string,
    packageName = "ESAA",
): string | undefined {
    let cur: string
    try {
        cur = path.resolve(fileOrDir)
        if (fs.existsSync(cur) && fs.statSync(cur).isFile()) cur = path.dirname(cur)
    } catch {
        return undefined
    }
    const want = packageName.toUpperCase()
    let best: { dir: string; score: number } | undefined
    for (let i = 0; i < 8 && cur; i++) {
        const score = scoreEsaaCandidate(cur)
        if (score > 0 && (!best || score > best.score)) best = { dir: cur, score }
        const base = path.basename(cur)
        if (base.toUpperCase() === want) {
            const s = scoreEsaaCandidate(cur)
            if (s > 0 && (!best || s > best.score)) best = { dir: cur, score: s }
        }
        // Sibling ESAA next to ASR / sector files
        const sibling = path.join(path.dirname(cur), packageName)
        if (fs.existsSync(sibling)) {
            const s = scoreEsaaCandidate(sibling)
            if (s > 0 && (!best || s > best.score)) best = { dir: sibling, score: s }
        }
        const parent = path.dirname(cur)
        if (!parent || parent === cur) break
        cur = parent
    }
    return best?.dir
}

/**
 * Validate that a directory is a EuroScope install: must contain *.prf file.
 */
export function isValidEuroscopeDir(dir: string): boolean {
    try {
        const entries = fs.readdirSync(dir)
        return entries.some((name) => name.endsWith(".prf"))
    } catch {
        return false
    }
}

/** Candidate EuroScope settings roots (AppData, Documents, install, Wine). */
export function euroscopeDirCandidates(): string[] {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || ""
    const docs = process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "Documents")
        : path.join(home, "Documents")
    return [
        path.join(process.env.APPDATA || "", "EuroScope"),
        path.join(docs, "EuroScope"),
        path.join(docs, "Euroscope"),
        path.join("C:", "Program Files (x86)", "EuroScope"),
        path.join(home, "VATSIM", "drive_c", "EUROSCOPE"),
    ].filter((p) => !!p && p !== path.sep && !p.endsWith(`:${path.sep}`))
}

/**
 * Find EuroScope directory by trying multiple locations in sequence.
 */
export function findEuroscopeDir(): string | undefined {
    for (const candidate of euroscopeDirCandidates()) {
        if (fs.existsSync(candidate) && isValidEuroscopeDir(candidate)) {
            return candidate
        }
    }
    return undefined
}

/** Collect absolute .sct/.ese (and absolute plugin) paths from a PRF body. */
export function extractAbsolutePathsFromPrf(content: string): string[] {
    const out: string[] = []
    for (const line of content.split(/\r?\n/)) {
        const parts = line.split("\t")
        const value = (parts.length >= 3 ? parts.slice(2).join("\t") : parts[parts.length - 1] ?? "").trim()
        if (!value) continue
        // Absolute Windows path
        if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
            out.push(value)
            continue
        }
    }
    // Also catch paths embedded mid-line (Messages-style dumps pasted into logs)
    SECTOR_PATH_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SECTOR_PATH_RE.exec(content)) !== null) {
        if (m[1]) out.push(m[1])
    }
    return out
}

/** Relative PRF paths like \ESAA\Plugins\TopSky.dll → join with euroscopeDir. */
export function extractRelativeEsaaHintsFromPrf(
    content: string,
    euroscopeDir: string,
    packageName = "ESAA",
): string[] {
    const want = packageName.toUpperCase()
    const out: string[] = []
    for (const line of content.split(/\r?\n/)) {
        const parts = line.split("\t")
        const value = (parts.length >= 3 ? parts.slice(2).join("\t") : "").trim()
        if (!value) continue
        const norm = value.replace(/\//g, "\\")
        // \ESAA\... or ESAA\...
        const m = norm.match(/^[\\/]?([^\\/]+)[\\/]/)
        if (!m || m[1]!.toUpperCase() !== want) continue
        const rel = norm.replace(/^[\\/]+/, "")
        out.push(path.join(euroscopeDir, rel))
    }
    return out
}

function readTextLimited(file: string, maxBytes = 2_000_000): string | undefined {
    try {
        const st = fs.statSync(file)
        if (!st.isFile() || st.size <= 0) return undefined
        const fd = fs.openSync(file, "r")
        try {
            const size = Math.min(st.size, maxBytes)
            // Prefer tail for large session logs (Messages often near start of session —
            // but recent loads are at the end). Read both head and tail when large.
            if (st.size <= maxBytes) {
                const buf = Buffer.alloc(size)
                fs.readSync(fd, buf, 0, size, 0)
                return buf.toString("utf8")
            }
            const half = Math.floor(maxBytes / 2)
            const head = Buffer.alloc(half)
            const tail = Buffer.alloc(half)
            fs.readSync(fd, head, 0, half, 0)
            fs.readSync(fd, tail, 0, half, st.size - half)
            return head.toString("utf8") + "\n" + tail.toString("utf8")
        } finally {
            fs.closeSync(fd)
        }
    } catch {
        return undefined
    }
}

/** Scan EuroScope*.txt / Messages-like logs for absolute .sct/.ese paths. */
export function extractSectorPathsFromLogs(searchDirs: string[]): string[] {
    const found: string[] = []
    const seen = new Set<string>()
    for (const dir of searchDirs) {
        if (!dir || !fs.existsSync(dir)) continue
        let entries: string[]
        try {
            entries = fs.readdirSync(dir)
        } catch {
            continue
        }
        const logs = entries
            .filter(
                (n) =>
                    /^EuroScope.*\.txt$/i.test(n) ||
                    /^Messages.*\.txt$/i.test(n) ||
                    /^ES_?Messages.*\.txt$/i.test(n),
            )
            .map((n) => {
                const full = path.join(dir, n)
                try {
                    return { full, mtime: fs.statSync(full).mtimeMs }
                } catch {
                    return { full, mtime: 0 }
                }
            })
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 8)
        for (const { full } of logs) {
            const text = readTextLimited(full)
            if (!text) continue
            SECTOR_PATH_RE.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = SECTOR_PATH_RE.exec(text)) !== null) {
                const p = m[1]!
                const key = p.toLowerCase()
                if (seen.has(key)) continue
                seen.add(key)
                found.push(p)
            }
        }
    }
    return found
}

function collectPrfFiles(dir: string, depth = 0, out: string[] = []): string[] {
    if (depth > 2) return out
    let entries: fs.Dirent[]
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
        return out
    }
    for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (ent.isFile() && ent.name.endsWith(".prf")) out.push(full)
        else if (ent.isDirectory() && !ent.name.startsWith(".")) collectPrfFiles(full, depth + 1, out)
    }
    return out
}

/**
 * Walk under root for directories named ESAA that contain Plugins/.
 * Picks the best match (TopSky / GR plugin files), so nested ESAA/ESAA wins
 * when that is where the sector package actually lives.
 */
export function resolveEsaaPackageDir(
    euroscopeDir: string,
    packageName = "ESAA",
): string | undefined {
    if (packageDirOverride) {
        const s = scoreEsaaCandidate(packageDirOverride)
        if (s > 0) return packageDirOverride
    }
    if (!euroscopeDir || !fs.existsSync(euroscopeDir)) return undefined
    const want = packageName.toUpperCase()
    const found: { dir: string; score: number; depth: number }[] = []

    const walk = (dir: string, depth: number) => {
        if (depth > MAX_DEPTH) return
        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue
            const full = path.join(dir, ent.name)
            if (ent.name.toUpperCase() === want) {
                const score = scoreEsaaCandidate(full)
                if (score > 0) found.push({ dir: full, score, depth })
            }
            walk(full, depth + 1)
        }
    }

    walk(euroscopeDir, 0)
    if (found.length === 0) {
        // Flat fallback: euroscopeDir/ESAA even if empty (callers log missing files)
        const flat = path.join(euroscopeDir, packageName)
        return fs.existsSync(flat) ? flat : undefined
    }
    found.sort((a, b) => b.score - a.score || b.depth - a.depth)
    return found[0]!.dir
}

function documentsEuroscopeDirs(): string[] {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || ""
    const docs = process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "Documents")
        : path.join(home, "Documents")
    return [path.join(docs, "EuroScope"), path.join(docs, "Euroscope")]
}

/**
 * Discover ESAA package under the EuroScope dir, Documents, PRF absolute paths,
 * and SCT/ESE paths from recent EuroScope logs. Sets override when found outside.
 */
export function discoverEsaaPackageDir(
    euroscopeDir: string | undefined,
    packageName = "ESAA",
): string | undefined {
    setEsaaPackageDirOverride(undefined)

    let best: { dir: string; score: number } | undefined
    const consider = (dir: string | undefined) => {
        if (!dir) return
        const score = scoreEsaaCandidate(dir)
        if (score > 0 && (!best || score > best.score)) best = { dir, score }
    }

    const walkRoot = (root: string | undefined) => {
        if (!root || !fs.existsSync(root)) return
        // Temporarily clear override so resolve walks this root only
        const prev = packageDirOverride
        packageDirOverride = undefined
        try {
            consider(resolveEsaaPackageDir(root, packageName))
        } finally {
            packageDirOverride = prev
        }
    }

    // 1) Primary EuroScope settings dir (AppData / chosen install)
    walkRoot(euroscopeDir)
    if (best && best.score >= 20) return best.dir

    // 2) Documents\EuroScope (#65) — do not re-scan AppData when primary was already set
    for (const doc of documentsEuroscopeDirs()) {
        if (euroscopeDir && path.resolve(doc) === path.resolve(euroscopeDir)) continue
        walkRoot(doc)
    }
    if (best && best.score >= 20) {
        setEsaaPackageDirOverride(best.dir)
        return best.dir
    }

    // 3) No primary dir at all — fall back to full candidate list
    if (!euroscopeDir) {
        for (const c of euroscopeDirCandidates()) walkRoot(c)
        if (best && best.score >= 20) {
            setEsaaPackageDirOverride(best.dir)
            return best.dir
        }
    }

    // 4) PRF absolute + relative hints + ES Messages / session logs (SCT & ESE)
    const searchRoots = new Set<string>()
    if (euroscopeDir) searchRoots.add(euroscopeDir)
    for (const d of documentsEuroscopeDirs()) searchRoots.add(d)

    const hintFiles: string[] = []
    for (const root of searchRoots) {
        if (!fs.existsSync(root)) continue
        for (const prf of collectPrfFiles(root)) {
            const text = readTextLimited(prf, 256_000)
            if (!text) continue
            for (const abs of extractAbsolutePathsFromPrf(text)) hintFiles.push(abs)
            if (euroscopeDir) {
                for (const rel of extractRelativeEsaaHintsFromPrf(text, euroscopeDir, packageName)) {
                    hintFiles.push(rel)
                }
            }
        }
    }
    for (const p of extractSectorPathsFromLogs([...searchRoots])) hintFiles.push(p)

    for (const hint of hintFiles) {
        consider(resolvePackageDirFromPathHint(hint, packageName))
        try {
            const resolved = path.resolve(hint)
            if (fs.existsSync(resolved)) consider(resolvePackageDirFromPathHint(resolved, packageName))
        } catch {
            /* ignore */
        }
    }

    if (best && best.score > 0) {
        setEsaaPackageDirOverride(best.dir)
        return best.dir
    }
    return undefined
}

/** ESAA/Plugins — nested package aware. */
export function resolveEsaaPluginsDir(
    euroscopeDir: string,
    packageName = "ESAA",
): string | undefined {
    const pkg = resolveEsaaPackageDir(euroscopeDir, packageName)
    if (!pkg) return undefined
    const plugins = path.join(pkg, "Plugins")
    return fs.existsSync(plugins) ? plugins : undefined
}

/** Path to a file under ESAA/Plugins, or undefined if missing. */
export function resolveEsaaPluginFile(
    euroscopeDir: string,
    fileName: string,
    packageName = "ESAA",
): string | undefined {
    const plugins = resolveEsaaPluginsDir(euroscopeDir, packageName)
    if (!plugins) return undefined
    const file = path.join(plugins, fileName)
    return fs.existsSync(file) ? file : undefined
}

/** ESAA/ICAO/ICAO_Airlines.txt when present. */
export function resolveIcaoAirlinesFile(
    euroscopeDir: string,
    packageName = "ESAA",
): string | undefined {
    const pkg = resolveEsaaPackageDir(euroscopeDir, packageName)
    if (!pkg) return undefined
    const file = path.join(pkg, "ICAO", "ICAO_Airlines.txt")
    return fs.existsSync(file) ? file : undefined
}
