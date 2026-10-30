/**
 * Hoppie PREDEP / DCL request telex parsing.
 */

export type ParsedDclRequest = {
    callsign: string
    aircraftType: string
    destination: string
    airport: string
    stand: string
    atis: string
    /** Free text after ATIS letter — forces manual DCL review. */
    remarks?: string
}

/**
 * Parse Hoppie PREDEP telex. Trailing remarks after ATIS letter are optional
 * (e.g. `… ATIS A KUUUHLE`) — when present, treat like manual DCL (no auto-send).
 */
export function parseDclRequestTelex(packet: string): ParsedDclRequest | null {
    const match = packet.match(
        /^REQUEST PREDEP CLEARANCE\s+(\S+)\s+(\S+)\s+TO\s+(\S+)\s+AT\s+(\S+)\s+STAND\s+(\S+)\s+ATIS\s+(\S+)(?:\s+(.+))?$/i,
    )
    if (!match) return null
    const remarks = match[7]?.trim()
    return {
        callsign: match[1]!,
        aircraftType: match[2]!,
        destination: match[3]!,
        airport: match[4]!,
        stand: match[5]!,
        atis: match[6]!,
        remarks: remarks || undefined,
    }
}
