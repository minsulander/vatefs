/**
 * Unit tests for nested ESAA package path resolution
 * (run: npx tsx src/euroscope-paths.test.ts)
 */

import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"
import {
    discoverEsaaPackageDir,
    extractAbsolutePathsFromPrf,
    extractSectorPathsFromLogs,
    resolveEsaaPackageDir,
    resolveEsaaPluginsDir,
    resolveEsaaPluginFile,
    resolveIcaoAirlinesFile,
    resolvePackageDirFromPathHint,
    setEsaaPackageDirOverride,
} from "./euroscope-paths.js"

let passed = 0
function check(name: string, fn: () => void) {
    try {
        fn()
        passed++
        console.log(`  ok  ${name}`)
    } catch (e) {
        console.error(`  FAIL ${name}`)
        throw e
    }
}

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "vatefs-esaa-"))
}

function writeFile(file: string, content = "x") {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
}

console.log("euroscope-paths tests")

check("prefers nested ESAA/ESAA when that has TopSky files", () => {
    const root = mkTmp()
    try {
        // Shallow empty-ish Plugins (common mistaken layout)
        writeFile(path.join(root, "ESAA", "Plugins", "readme.txt"), "not topsky")
        // Real sector package nested one level deeper (John's layout)
        writeFile(
            path.join(root, "ESAA", "ESAA", "Plugins", "TopSkyCPDLChoppieCode.txt"),
            "ABC123",
        )
        writeFile(path.join(root, "ESAA", "ESAA", "Plugins", "TopSkyCPDLC.txt"), "[DCL]")
        writeFile(path.join(root, "ESAA", "ESAA", "ICAO", "ICAO_Airlines.txt"), "ICAO;")

        const pkg = resolveEsaaPackageDir(root)
        assert.equal(pkg, path.join(root, "ESAA", "ESAA"))
        assert.equal(
            resolveEsaaPluginsDir(root),
            path.join(root, "ESAA", "ESAA", "Plugins"),
        )
        assert.equal(
            resolveEsaaPluginFile(root, "TopSkyCPDLChoppieCode.txt"),
            path.join(root, "ESAA", "ESAA", "Plugins", "TopSkyCPDLChoppieCode.txt"),
        )
        assert.equal(
            resolveIcaoAirlinesFile(root),
            path.join(root, "ESAA", "ESAA", "ICAO", "ICAO_Airlines.txt"),
        )
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})

check("uses flat ESAA/Plugins when that is where TopSky lives", () => {
    const root = mkTmp()
    try {
        writeFile(path.join(root, "ESAA", "Plugins", "TopSkyAirspace.txt"), "TA:ESGG:5000")
        const pkg = resolveEsaaPackageDir(root)
        assert.equal(pkg, path.join(root, "ESAA"))
        assert.equal(
            resolveEsaaPluginFile(root, "TopSkyAirspace.txt"),
            path.join(root, "ESAA", "Plugins", "TopSkyAirspace.txt"),
        )
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})

check("returns undefined plugin file when missing", () => {
    const root = mkTmp()
    try {
        writeFile(path.join(root, "ESAA", "Plugins", "GRpluginStands.txt"), "stands")
        assert.equal(resolveEsaaPluginFile(root, "TopSkyCPDLChoppieCode.txt"), undefined)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})

check("resolvePackageDirFromPathHint walks up from SCT to ESAA", () => {
    const root = mkTmp()
    try {
        const pkg = path.join(root, "EuroScope_Sweden", "ESAA")
        writeFile(path.join(pkg, "Plugins", "TopSkyCPDLC.txt"), "[DCL]")
        writeFile(path.join(pkg, "Plugins", "GRpluginStands.txt"), "stands")
        const sct = path.join(root, "EuroScope_Sweden", "ES_OwnConf", "3_ESSA", "sector.sct")
        writeFile(sct, "sector")
        // Put package as sibling-ish: walk finds ESAA under EuroScope_Sweden
        const found = resolvePackageDirFromPathHint(sct)
        assert.equal(found, pkg)
    } finally {
        fs.rmSync(root, { recursive: true, force: true })
    }
})

check("extractAbsolutePathsFromPrf reads absolute plugin/sector lines", () => {
    const content = [
        "Settings\tsector\tD:\\VATSIM\\ESAA\\sector.sct",
        "Plugins\tPlugin0\tD:\\VATSIM\\ESAA\\Plugins\\TopSky.dll",
        "Settings\talias\t\\ESAA\\Alias\\alias.txt",
    ].join("\n")
    const paths = extractAbsolutePathsFromPrf(content)
    assert.ok(paths.some((p) => p.includes("sector.sct")))
    assert.ok(paths.some((p) => p.includes("TopSky.dll")))
})

check("discover finds package outside euroscope dir via PRF absolute path", () => {
    const tmp = mkTmp()
    try {
        const esDir = path.join(tmp, "AppDataEuroScope")
        const external = path.join(tmp, "DesktopPackage", "ESAA")
        fs.mkdirSync(esDir, { recursive: true })
        writeFile(path.join(esDir, "dummy.prf"), "Settings\tsector\tx.sct\n")
        writeFile(path.join(external, "Plugins", "TopSkyCPDLChoppieCode.txt"), "CODE")
        writeFile(path.join(external, "Plugins", "TopSkyCPDLC.txt"), "[DCL]")
        writeFile(
            path.join(esDir, "ESAA TWR.prf"),
            `Settings\tsector\t${external}\\sector.sct\nPlugins\tPlugin0\t${external}\\Plugins\\TopSky.dll\n`,
        )
        writeFile(path.join(external, "sector.sct"), "s")

        setEsaaPackageDirOverride(undefined)
        const found = discoverEsaaPackageDir(esDir)
        assert.equal(found, external)
    } finally {
        setEsaaPackageDirOverride(undefined)
        fs.rmSync(tmp, { recursive: true, force: true })
    }
})

check("extractSectorPathsFromLogs finds .ese in EuroScope log", () => {
    const tmp = mkTmp()
    try {
        const log = path.join(tmp, "EuroScope20261026.txt")
        writeFile(
            log,
            `Noise\nSectorfile loaded: C:\\Users\\perha\\Desktop\\Dokument\\VATSIM\\EuroScope_Sweden\\ESAA\\Sweden.sct\n` +
                `ESE: C:\\Users\\perha\\Desktop\\Dokument\\VATSIM\\EuroScope_Sweden\\ESAA\\Sweden.ese\n`,
        )
        const paths = extractSectorPathsFromLogs([tmp])
        assert.equal(paths.length, 2)
        assert.ok(paths.some((p) => p.endsWith(".sct")))
        assert.ok(paths.some((p) => p.endsWith(".ese")))
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
    }
})

console.log(`${passed} passed`)
