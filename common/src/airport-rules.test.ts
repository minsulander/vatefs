/**
 * Quick node checks: npx tsx src/airport-rules.test.ts
 */
import {
    requiresAccCoordination,
    requiresSsrCoordination,
    resolveEssaHeavyPreferredDepRwy,
    isEsmsAutoCoordSid,
    isEsmsAutoCoordReplyAltitude,
    normalizeEsmsAutoCoordRwy,
    ESMS_AUTO_COORD_INIT_XFL_FT,
    ESMS_AUTO_COORD_REPLY_XFL_FT,
    sidMatchesEssaMdi2MinExit,
    needsEssaMdi2MinSidBox,
    needsEssaEastSidBox,
} from "./airport-rules.js"

function assert(cond: unknown, msg: string) {
    if (!cond) throw new Error(msg)
}

assert(requiresAccCoordination("ESSB") === true, "ESSB always")
assert(requiresAccCoordination("essb") === true, "ESSB case")
assert(requiresAccCoordination("ESSB", "ANYEXIT") === true, "ESSB no exit exemption")
assert(requiresAccCoordination("ESMS") === true, "ESMS always")
assert(requiresAccCoordination("esms") === true, "ESMS case")
assert(requiresAccCoordination("ESMS", "ANYEXIT") === true, "ESMS no exit exemption")
assert(requiresAccCoordination("ESNU", "SOPLI") === false, "ESNU+SOPLI exempt")
assert(requiresAccCoordination("ESNU", "GADDE") === false, "ESNU+GADDE exempt")
assert(requiresAccCoordination("ESNU", "DEDIT") === false, "ESNU+DEDIT exempt")
assert(requiresAccCoordination("ESNU", "TINDO") === false, "ESNU+TINDO exempt")
assert(requiresAccCoordination("ESNU", "OTHER") === true, "ESNU other exit")
assert(requiresAccCoordination("ESNU") === true, "ESNU missing exit")
assert(requiresAccCoordination("ESNU", "") === true, "ESNU empty exit")
assert(requiresAccCoordination("ESGG") === false, "ESGG never")
assert(requiresAccCoordination("ESGP") === false, "ESGP no ATS")
assert(requiresAccCoordination("ESKC") === false, "ESKC no ATS")
assert(requiresAccCoordination(undefined) === false, "undefined adep")

assert(requiresSsrCoordination("ESOE") === true, "ESOE SSR coord")
assert(requiresSsrCoordination("ESCF") === true, "ESCF SSR coord")
assert(requiresSsrCoordination("ESNS") === true, "ESNS SSR coord")
assert(requiresSsrCoordination("ESNS", { stripType: "departure" }) === true, "ESNS dep SSR coord")
assert(requiresSsrCoordination("ESTL") === false, "ESTL never SSR coord")
assert(requiresSsrCoordination("ESGG") === false, "ESGG never SSR coord")
assert(requiresSsrCoordination("ESPE") === true, "ESPE IFR SSR coord")
assert(requiresSsrCoordination("ESPE", { stripType: "local" }) === false, "ESPE local exempt")
assert(requiresSsrCoordination("ESOE", { stripType: "local" }) === false, "ESOE local exempt")
assert(requiresSsrCoordination("ESCF", { stripType: "local" }) === false, "ESCF local exempt")
assert(requiresSsrCoordination("ESPE", { stripType: "departure" }) === true, "ESPE dep SSR coord")
assert(requiresSsrCoordination("ESOE", { stripType: "departure" }) === true, "ESOE dep SSR coord")
assert(requiresSsrCoordination("ESSA") === false, "ESSA never SSR coord")
assert(requiresSsrCoordination("ESSA", { stripType: "departure" }) === false, "ESSA dep never SSR coord")
assert(requiresSsrCoordination("ESOE", { stripType: "arrival" }) === false, "arrival shows ES SSR")
assert(requiresSsrCoordination("ESCF", { stripType: "arrival" }) === false, "ESCF arrival shows ES SSR")
assert(requiresSsrCoordination(undefined) === false, "undefined adep SSR")

// ESSA heavy take-off RWY (01L/19R) — auto-LOP shared resolver
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "A388",
        activeArr: ["01R"],
        activeDep: ["01L"],
        currentDepRwy: undefined,
    }) === "01L",
    "any 01 → 01L",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "B748",
        activeArr: ["19L"],
        activeDep: ["19L"],
        currentDepRwy: "",
    }) === "19R",
    "any 19 → 19R",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "A345",
        activeArr: ["26"],
        activeDep: ["08"],
        currentDepRwy: "08",
    }) === undefined,
    "no 01/19 active → no prefer",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "A388",
        activeArr: ["01R"],
        activeDep: ["01L"],
        currentDepRwy: "01L",
    }) === undefined,
    "already on 01L",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "A124",
        activeArr: ["01R"],
        activeDep: ["01L"],
        currentDepRwy: "01R",
    }) === "01L",
    "override parallel 01R → 01L",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESGG",
        aircraftType: "A388",
        activeArr: ["03"],
        activeDep: ["03"],
        currentDepRwy: undefined,
    }) === undefined,
    "ESGG never",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "A320",
        activeArr: ["01R"],
        activeDep: ["01L"],
        currentDepRwy: undefined,
    }) === undefined,
    "non-heavy type",
)
assert(
    resolveEssaHeavyPreferredDepRwy({
        adep: "ESSA",
        aircraftType: "a380/h",
        activeArr: ["19R"],
        activeDep: ["19R"],
        currentDepRwy: "19L",
    }) === "19R",
    "A380 alias + override 19L",
)

// ESMS auto-coord SID (published climb 4000 on RWY 17/35)
assert(normalizeEsmsAutoCoordRwy("17") === "17", "ESMS rwy 17")
assert(normalizeEsmsAutoCoordRwy("ESMS17") === "17", "ESMS rwy ESMS17")
assert(normalizeEsmsAutoCoordRwy("35") === "35", "ESMS rwy 35")
assert(normalizeEsmsAutoCoordRwy("11") === undefined, "ESMS rwy 11 ineligible")
assert(ESMS_AUTO_COORD_INIT_XFL_FT === 1000, "init XFL 1000")
assert(ESMS_AUTO_COORD_REPLY_XFL_FT === 4000, "reply XFL 4000")

assert(isEsmsAutoCoordSid("ESMS", "BABSI2K", "17") === true, "BABSI2K/17")
assert(isEsmsAutoCoordSid("esms", "ERNOv3G", "17") === true, "ERNOV3G/17 EKCH30")
assert(isEsmsAutoCoordSid("ESMS", "DISGO2L", "35") === true, "DISGO2L/35")
assert(isEsmsAutoCoordSid("ESMS", "SALLO1H", "35") === true, "SALLO1H/35 EKCH30")
assert(isEsmsAutoCoordSid("ESMS", "TELMO2K", "17") === true, "TELMO2K/17")
assert(isEsmsAutoCoordSid("ESMS", "NEXIL2L", "35") === true, "NEXIL2L/35")
assert(isEsmsAutoCoordSid("ESMS", "EKRAL2K", "17") === true, "EKRAL2K/17")

assert(isEsmsAutoCoordSid("ESMS", "BABSI2L", "17") === false, "wrong letter for 17")
assert(isEsmsAutoCoordSid("ESMS", "BABSI2K", "35") === false, "wrong letter for 35")
assert(isEsmsAutoCoordSid("ESMS", "BABSI2K", "11") === false, "cross-rwy 11")
assert(isEsmsAutoCoordSid("ESGG", "BABSI2K", "17") === false, "wrong adep")
assert(isEsmsAutoCoordSid("ESMS", "VFR", "17") === false, "VFR name")
assert(isEsmsAutoCoordSid("ESMS", "", "17") === false, "empty sid")
assert(isEsmsAutoCoordSid("ESMS", undefined, "17") === false, "missing sid")
assert(isEsmsAutoCoordSid("ESMS", "UNKNOWN2K", "17") === false, "unknown exit")

assert(isEsmsAutoCoordReplyAltitude(4000) === true, "reply 4000")
assert(isEsmsAutoCoordReplyAltitude(1000) === false, "init 1000 not reply")
assert(isEsmsAutoCoordReplyAltitude(3900) === false, "near miss")
assert(isEsmsAutoCoordReplyAltitude(undefined) === false, "undefined alt")

// ESSA east SID box — preferred DEP-E / ARR-E
assert(needsEssaEastSidBox("DEP-E") === true, "DEP-E")
assert(needsEssaEastSidBox("ARR-E") === true, "ARR-E")
assert(needsEssaEastSidBox("dep-e") === true, "dep-e case")
assert(needsEssaEastSidBox("DEP-W") === false, "DEP-W")
assert(needsEssaEastSidBox("ARR-W") === false, "ARR-W")
assert(needsEssaEastSidBox(undefined) === false, "undefined sector")
assert(needsEssaEastSidBox("") === false, "empty sector")

// Legacy SID heuristic still available via needsEssaMdi2MinSidBox without sector
assert(sidMatchesEssaMdi2MinExit("TOVRI1A") === true, "TOVRI1A")
assert(sidMatchesEssaMdi2MinExit("BABAP2G") === true, "BABAP2G")
assert(sidMatchesEssaMdi2MinExit("PETEV3G") === false, "other SID")
assert(
    needsEssaMdi2MinSidBox({ appDepNextSector: "DEP-E" }) === true,
    "sector DEP-E via legacy helper",
)
assert(
    needsEssaMdi2MinSidBox({ appDepNextSector: "DEP-W" }) === false,
    "sector DEP-W via legacy helper",
)
assert(
    needsEssaMdi2MinSidBox({
        adep: "ESSA",
        depRwy: "19R",
        displaySid: "TOVRI1A",
        stripType: "departure",
        flightRules: "I",
    }) === true,
    "legacy 19R TOVRI heuristic",
)

console.log("airport-rules.test.ts: OK")
