/**
 * Unit tests for nested ESAA package path resolution
 * (run: npx tsx src/euroscope-paths.test.ts)
 */

import assert from "node:assert/strict"
import fs from "fs"
import os from "os"
import path from "path"
import {
    resolveEsaaPackageDir,
    resolveEsaaPluginsDir,
    resolveEsaaPluginFile,
    resolveIcaoAirlinesFile,
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

console.log(`${passed} passed`)
