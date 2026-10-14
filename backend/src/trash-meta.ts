/**
 * Trash retention + human-readable delete reasons for soft-deleted strips.
 *
 * Retention (documented):
 * - TRASH_MAX_ENTRIES = 100 (was unbounded Map; soft cap so memory stays bounded)
 * - TRASH_TTL_MS = 24 hours (entries older than this are pruned)
 * - PARK/TERM (delete_parked*) stay soft-deleted until trash restore or pilot disconnect
 *   (no auto-revive when EuroScope groundstate later changes e.g. to TAXI)
 *
 * Trash survives store.clear() / reconnect / AoR refresh so WS blips do not wipe it.
 */

/** Max soft-deleted strips kept in trash (oldest pruned first). */
export const TRASH_MAX_ENTRIES = 100

/** Soft-deleted strips older than this are pruned. */
export const TRASH_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Extra classification when removal is disconnect / data-loss related. */
export type TrashDisconnectKind = 'pilot' | 'flight_plan' | 'radar'

export interface TrashMeta {
    /** Plain-text reason shown in the trash UI */
    reason: string
    /** Delete rule id or synthetic cause code (debug) */
    ruleId?: string
    /** Rule / cause name for debug (usually same as ruleId) */
    ruleName?: string
    /** True when EuroScope sent flightPlanDisconnect */
    pilotDisconnected?: boolean
    /** Disconnect / data-loss extras */
    disconnectKind?: TrashDisconnectKind
}

type KnownCause = {
    reason: string
    ruleName?: string
    pilotDisconnected?: boolean
    disconnectKind?: TrashDisconnectKind
}

/** Synthetic cause codes + YAML delete rule ids → UI copy. */
const KNOWN_CAUSES: Record<string, KnownCause> = {
    manual: {
        reason: 'Manually deleted',
        ruleName: 'manual',
    },
    goa_app_assume: {
        reason: 'Go-around strip replaced after APP assume',
        ruleName: 'goa_app_assume',
    },
    strip_reprint: {
        reason: 'Replaced by strip reprint',
        ruleName: 'strip_reprint',
    },
    no_section: {
        reason: 'No matching section rule',
        ruleName: 'no_section',
    },
    pilot_disconnect: {
        reason: 'Pilot disconnected',
        ruleName: 'pilot_disconnect',
        pilotDisconnected: true,
        disconnectKind: 'pilot',
    },
    flight_data_lost: {
        reason: 'Flight plan data lost',
        ruleName: 'flight_data_lost',
        disconnectKind: 'flight_plan',
    },
    airport_irrelevant: {
        reason: 'No longer relevant to active airport',
        ruleName: 'airport_irrelevant',
    },
    delete_dep_high_transferred: {
        reason: 'Departure transferred and above altitude',
        ruleName: 'delete_dep_high_transferred',
    },
    delete_parked: {
        reason: 'Arrival parked',
        ruleName: 'delete_parked',
    },
    delete_parked_local: {
        reason: 'Local parked',
        ruleName: 'delete_parked_local',
    },
    delete_beyond_range: {
        reason: 'Beyond radar / visibility range',
        ruleName: 'delete_beyond_range',
        disconnectKind: 'radar',
    },
}

/**
 * Build trash metadata from a delete-rule id or synthetic cause code.
 * Unknown codes still get a readable fallback that includes the id.
 */
export function buildTrashMeta(code?: string | null): TrashMeta {
    if (!code) {
        return { reason: 'Removed' }
    }
    const known = KNOWN_CAUSES[code]
    if (known) {
        return {
            reason: known.reason,
            ruleId: code,
            ruleName: known.ruleName ?? code,
            pilotDisconnected: known.pilotDisconnected,
            disconnectKind: known.disconnectKind,
        }
    }
    return {
        reason: `Removed by rule ${code}`,
        ruleId: code,
        ruleName: code,
    }
}

export type TrashEntryLike = { deletedAt: number }

/**
 * Drop expired entries, then trim to TRASH_MAX_ENTRIES (newest kept).
 * Mutates the map in place.
 */
export function pruneTrashMap<T extends TrashEntryLike>(map: Map<string, T>, now = Date.now()): void {
    const cutoff = now - TRASH_TTL_MS
    for (const [id, entry] of map) {
        if (entry.deletedAt < cutoff) {
            map.delete(id)
        }
    }
    if (map.size <= TRASH_MAX_ENTRIES) return
    const ordered = [...map.entries()].sort((a, b) => a[1].deletedAt - b[1].deletedAt)
    const overflow = ordered.length - TRASH_MAX_ENTRIES
    for (let i = 0; i < overflow; i++) {
        const id = ordered[i]?.[0]
        if (id !== undefined) map.delete(id)
    }
}
