/**
 * Unified PAPER menu → airport board overlay from login / airport.
 */

import path from "path"
import { loadConfig } from "./config-loader.js"
import { applyConfig, closePaperOpenSection, staticConfig } from "./static-config.js"
import {
    isAdStripTowerCallsign,
    isEsggTowerCallsign,
    isUnifiedPaperConfigFile,
    layoutHasCombinedTaxiPushback,
    PAPER_CONFIG_FILE,
    PAPER_OPTIONAL_SECTION_PUSHBACK,
    resolveAdStripTowerOverlay,
    resolvePaperConfigFile,
} from "./paper-roles.js"

let presentationKey = ""

/**
 * When the active menu file is PAPER (or a legacy alias), load the matching
 * overlay: esgg.yml / esms.yml / essb.yml, otherwise paper.yml.
 * Returns true when look/layout content changed.
 */
export function applyUnifiedPaperPresentation(configDir: string, activeFile: string): {
    changed: boolean
    activeFile: string
} {
    const resolved = resolvePaperConfigFile(activeFile) ?? activeFile
    if (!isUnifiedPaperConfigFile(resolved)) {
        presentationKey = ""
        return { changed: false, activeFile }
    }

    const wantEsgg = isEsggTowerCallsign(staticConfig.myCallsign)
    const adOverlay = !wantEsgg
        ? resolveAdStripTowerOverlay({
              callsign: staticConfig.myCallsign,
              airports: staticConfig.myAirports,
          })
        : undefined
    const wantAdStrip = !!adOverlay
    const key = wantEsgg
        ? "esgg-tower"
        : adOverlay === "esms.yml"
          ? "esms-tower"
          : adOverlay === "essb.yml"
            ? "essb-tower"
            : "generic"
    const overlay = wantEsgg ? "esgg.yml" : adOverlay ?? PAPER_CONFIG_FILE
    // ESGG + AD-strip towers use AD strip chrome (look:paper); generic PAPER stays std
    const wantLook = wantEsgg || wantAdStrip ? "paper" : "std"

    if (presentationKey === key && staticConfig.look === wantLook) {
        return { changed: false, activeFile: PAPER_CONFIG_FILE }
    }

    const fullPath = path.join(configDir, overlay)
    try {
        const config = loadConfig(fullPath)
        applyConfig(config)
        staticConfig.look = wantLook
        presentationKey = key
        // Combined TAXI/PUSHBACK hosts — drop any persisted separate PUSHBACK divider
        if (
            isAdStripTowerCallsign(staticConfig.myCallsign) ||
            layoutHasCombinedTaxiPushback(staticConfig.layout)
        ) {
            closePaperOpenSection(PAPER_OPTIONAL_SECTION_PUSHBACK)
        }
        console.log(
            `[PAPER] Presentation: ${key} (overlay ${overlay}, look=${wantLook})`,
        )
        return { changed: true, activeFile: PAPER_CONFIG_FILE }
    } catch (err) {
        console.warn(
            `[PAPER] Presentation overlay failed (${overlay}): ${err instanceof Error ? err.message : err}`,
        )
        return { changed: false, activeFile: resolved }
    }
}

/** Reset when leaving paper mode so the next entry reloads. */
export function clearPaperPresentation(): void {
    presentationKey = ""
}
