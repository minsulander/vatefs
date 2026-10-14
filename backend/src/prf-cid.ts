/**
 * Read VATSIM CID from EuroScope ES*.prf LastSession certificate lines.
 * Never reads password fields.
 */

import fs from "fs"
import path from "path"

function readCertificateFromPrf(filePath: string): string | undefined {
    let text: string
    try {
        text = fs.readFileSync(filePath, "utf-8")
    } catch {
        return undefined
    }
    for (const line of text.split(/\r?\n/)) {
        // Registry-style: LastSession\tcertificate\t1157125
        const parts = line.split("\t")
        if (parts.length >= 3 && parts[0] === "LastSession" && parts[1] === "certificate") {
            const cid = parts[2]?.trim()
            if (cid && /^\d{4,10}$/.test(cid)) return cid
        }
        // Also tolerate LastSession\certificate=1157125 style if present
        const m = line.match(/^LastSession\\certificate\s*=\s*(\d{4,10})\s*$/i)
        if (m?.[1]) return m[1]
    }
    return undefined
}

function collectEsPrfFiles(root: string, maxDepth = 2): string[] {
    const out: string[] = []
    const walk = (dir: string, depth: number) => {
        if (depth > maxDepth) return
        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const ent of entries) {
            const full = path.join(dir, ent.name)
            if (ent.isFile() && /^ES.*\.prf$/i.test(ent.name)) {
                out.push(full)
            } else if (ent.isDirectory() && depth < maxDepth) {
                walk(full, depth + 1)
            }
        }
    }
    walk(root, 0)
    return out
}

/**
 * Suggest a single CID from ES*.prf files that contain LastSession certificate.
 * Returns undefined if none or conflicting CIDs.
 */
export function suggestCidFromEsPrf(euroscopeDir: string | undefined): string | undefined {
    if (!euroscopeDir) return undefined
    const files = collectEsPrfFiles(euroscopeDir)
    const cids = new Set<string>()
    for (const f of files) {
        const cid = readCertificateFromPrf(f)
        if (cid) cids.add(cid)
    }
    if (cids.size === 1) return [...cids][0]
    return undefined
}
