import { describe, expect, it } from "vitest"
import { _setAppClrEntriesForTest, getAppClrTypes } from "./topsky-airspace.js"

describe("getAppClrTypes", () => {
    it("prefers runway-specific, then airport, then global; always adds OS", () => {
        _setAppClrEntriesForTest([
            { icao: "*", rwy: "*", types: ["GLB"] },
            { icao: "ESGG", rwy: "*", types: ["CAT2", "CAT3"] },
            { icao: "ESSA", rwy: "01L", types: ["CAT2", "CAT3"] },
            { icao: "ESSA", rwy: "01R", types: ["CAT2"] },
        ])
        expect(getAppClrTypes("ESSA", "01L")).toEqual(["CAT2", "CAT3", "OS"])
        expect(getAppClrTypes("ESSA", "01R")).toEqual(["CAT2", "OS"])
        expect(getAppClrTypes("ESSA", "19R")).toEqual(["GLB", "OS"])
        expect(getAppClrTypes("ESGG", "21")).toEqual(["CAT2", "CAT3", "OS"])
        expect(getAppClrTypes("ESMS", "17")).toEqual(["GLB", "OS"])
    })

    it("uses airport * when runway unknown", () => {
        _setAppClrEntriesForTest([{ icao: "ESGG", rwy: "*", types: ["CAT2", "CAT3"] }])
        expect(getAppClrTypes("ESGG", undefined)).toEqual(["CAT2", "CAT3", "OS"])
    })
})
