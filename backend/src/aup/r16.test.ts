/**
 * AUP R16 tests (run: npx tsx src/aup/r16.test.ts)
 */
import assert from "node:assert/strict"
import {
    computeR16Status,
    normalizeR16Name,
    suggestEssaConfigForR16,
    upperLimitFt,
} from "./r16.js"
import { extractDocumentLinks, parseUsePlanLinkMeta, selectUsePlanLink } from "./fetcher.js"
import { parseUsePlanPages, planDateFromIso, type TextItem } from "./parser-layout.js"
import type { Restriction } from "./types.js"

function check(name: string, fn: () => void) {
    try {
        fn()
        console.log(`  ok  ${name}`)
    } catch (e) {
        console.error(`  FAIL ${name}`)
        throw e
    }
}

const d = (s: string) => new Date(s)
function r16(altitude: string, type: "ft" | "FL", from: string, to: string, upper?: string): Restriction {
    return { name: "ESR16", from: d(from), to: d(to), altitude, altitudeType: type, altitudeUpper: upper, comment: "" }
}
const NOW = d("2026-10-10T10:00:00Z")

console.log("aup r16")

check("normalize ESR16 / ES R16 / R16", () => {
    assert.equal(normalizeR16Name("ESR16"), "R16")
    assert.equal(normalizeR16Name("ES R16"), "R16")
    assert.equal(normalizeR16Name("r16"), "R16")
    assert.equal(normalizeR16Name("ESR160"), null)
    assert.equal(normalizeR16Name("ESR2A"), null)
})

check("FL converts to feet", () => {
    assert.equal(upperLimitFt({ altitude: "65", altitudeType: "FL" }), 6500)
    assert.equal(upperLimitFt({ altitude: "2500", altitudeType: "ft" }), 2500)
    assert.equal(upperLimitFt({ altitude: "030", altitudeType: "ft", altitudeUpper: "145" }), 14500)
})

check("default 1600 ft is not utökad", () => {
    const s = computeR16Status([r16("1600", "ft", "2026-10-10T07:00:00Z", "2026-10-10T15:00:00Z")], NOW)
    assert.equal(s.active, false)
    assert.equal(s.suggestConfigId, null)
})

check("active when upper > 1600 ft and in window", () => {
    const s = computeR16Status([r16("2500", "ft", "2026-10-10T07:00:00Z", "2026-10-10T15:00:00Z")], NOW)
    assert.equal(s.active, true)
    assert.equal(s.topAltitudeFt, 2500)
    assert.equal(s.from, "2026-10-10T07:00:00.000Z")
    assert.equal(s.to, "2026-10-10T15:00:00.000Z")
})

check("FL upper limit counts (FL065 = 6500 ft)", () => {
    const s = computeR16Status([r16("065", "FL", "2026-10-10T07:00:00Z", "2026-10-10T15:00:00Z")], NOW)
    assert.equal(s.active, true)
    assert.equal(s.topAltitudeFt, 6500)
})

check("not active outside window", () => {
    const rows = [r16("2500", "ft", "2026-10-10T11:00:00Z", "2026-10-10T15:00:00Z")]
    assert.equal(computeR16Status(rows, NOW).active, false)
    assert.equal(computeR16Status(rows, d("2026-10-10T15:00:00Z")).active, false)
})

check("non-R16 areas ignored; top = max of active rows", () => {
    const other: Restriction = { ...r16("9999", "ft", "2026-10-10T07:00:00Z", "2026-10-10T15:00:00Z"), name: "ESR2A" }
    const rows = [
        other,
        r16("2000", "ft", "2026-10-10T07:00:00Z", "2026-10-10T12:00:00Z"),
        r16("3000", "ft", "2026-10-10T09:00:00Z", "2026-10-10T14:00:00Z"),
    ]
    const s = computeR16Status(rows, NOW)
    assert.equal(s.topAltitudeFt, 3000)
    assert.equal(s.from, "2026-10-10T07:00:00.000Z")
    assert.equal(s.to, "2026-10-10T14:00:00.000Z")
})

check("suggest 9C for ARR+DEP 19L, 15C for ARR 26 / DEP 19L, else null", () => {
    assert.equal(suggestEssaConfigForR16({ arr: ["19L"], dep: ["19L"] }), "9C")
    assert.equal(suggestEssaConfigForR16({ arr: ["26"], dep: ["19L"] }), "15C")
    assert.equal(suggestEssaConfigForR16({ arr: ["19R"], dep: ["19L"] }), null)
    assert.equal(suggestEssaConfigForR16({ arr: ["01R"], dep: ["01L"] }), null)
    assert.equal(suggestEssaConfigForR16({ arr: ["19L", "19R"], dep: ["19L"] }), null)
    assert.equal(suggestEssaConfigForR16(null), null)
})

check("suggestConfigId only when active", () => {
    const rows = [r16("2500", "ft", "2026-10-10T07:00:00Z", "2026-10-10T15:00:00Z")]
    assert.equal(computeR16Status(rows, NOW, { arr: ["19L"], dep: ["19L"] }).suggestConfigId, "9C")
    assert.equal(computeR16Status(rows, NOW, { arr: ["26"], dep: ["19L"] }).suggestConfigId, "15C")
    assert.equal(computeR16Status(rows, NOW, { arr: ["01R"], dep: ["01L"] }).suggestConfigId, null)
    const off = [r16("1600", "ft", "2026-10-10T07:00:00Z", "2026-10-10T15:00:00Z")]
    assert.equal(computeR16Status(off, NOW, { arr: ["19L"], dep: ["19L"] }).suggestConfigId, null)
})

console.log("aup fetcher")

check("document-link extraction + newest version", () => {
    const html = `
      <a href="/x" class="other">nope</a>
      <a class="document-link" href="/Editorial/View/General/1/Daily%20use%20plan%202026-10-10%20Version%201">Daily use plan 2026-10-10 Version 1</a>
      <a class="foo document-link" href="/Editorial/View/General/2/Daily%20use%20plan%202026-10-10%20Version%203"><span>Daily use plan 2026-10-10 Version 3</span></a>
      <a class="document-link" href="/Editorial/View/General/3/Daily%20use%20plan%202026-10-11%20Version%201">Daily use plan 2026-10-11 Version 1</a>`
    const links = extractDocumentLinks(html)
        .map((a) => parseUsePlanLinkMeta(a.href, a.label))
        .filter((l) => l != null)
    assert.equal(links.length, 3)
    assert.equal(selectUsePlanLink(links, "2026-10-10")?.version, 3)
    assert.equal(selectUsePlanLink(links, "2026-10-12"), null)
})

console.log("aup layout parser")

check("layout row → ESR16 restriction (single ceiling)", () => {
    const items: TextItem[] = [
        { str: "ES R16", x: 30, y: 500 },
        { str: "2500 ft", x: 240, y: 500 },
        { str: "07:00", x: 300, y: 500 },
        { str: "15:00", x: 370, y: 500 },
    ]
    const { restrictions } = parseUsePlanPages([items], planDateFromIso("2026-10-10"))
    assert.equal(restrictions.length, 1)
    assert.equal(restrictions[0]!.name, "ESR16")
    assert.equal(restrictions[0]!.altitude, "2500")
    assert.equal(restrictions[0]!.from.toISOString(), "2026-10-10T07:00:00.000Z")
    assert.equal(restrictions[0]!.to.toISOString(), "2026-10-10T15:00:00.000Z")
})

console.log("aup r16: all passed")
