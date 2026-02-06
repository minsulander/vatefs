/**
 * Runway detection utilities.
 * Functions for determining if an aircraft position is on a runway.
 */

import { getRunwaysByAirport, type Runway } from "./runway-data.js"
import { getAirportElevation } from "./airport-data.js"

// Configuration constants
const RUNWAY_BUFFER_FT = 200 // Buffer added to runway width on each side
const ALTITUDE_THRESHOLD_FT = 300 // Max altitude above field elevation to be considered "on ground"

// Conversion constants
const FEET_TO_METERS = 0.3048
const METERS_PER_DEGREE_LAT = 111320 // Approximate meters per degree latitude

/**
 * Result of runway detection
 */
export interface RunwayDetectionResult {
    onRunway: boolean
    runway?: {
        leIdent: string
        heIdent: string
        airportIdent: string
    }
    details?: {
        crossTrackDistanceFt: number
        alongTrackDistanceFt: number
        runwayLengthFt: number
        runwayWidthFt: number
        altitudeAboveFieldFt: number
        fieldElevationFt: number
    }
}

/**
 * Convert lat/lon to local x,y coordinates in meters relative to a reference point.
 * Uses flat-earth approximation which is accurate for short distances (< 10km).
 */
function latLonToLocalMeters(
    lat: number,
    lon: number,
    refLat: number,
    refLon: number
): { x: number; y: number } {
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((refLat * Math.PI) / 180)

    return {
        x: (lon - refLon) * metersPerDegreeLon,
        y: (lat - refLat) * METERS_PER_DEGREE_LAT
    }
}

/**
 * Check if a point is within a rotated rectangle (the runway surface).
 *
 * @param point - Point to check in local coordinates
 * @param start - Rectangle corner 1 (runway start)
 * @param end - Rectangle corner 2 (runway end)
 * @param halfWidth - Half the width of the rectangle
 * @returns Object with onRunway status and distance details
 */
function isPointInRotatedRectangle(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number },
    halfWidth: number
): { inside: boolean; crossTrack: number; alongTrack: number; runwayLength: number } {
    // Vector from start to end (runway direction)
    const dx = end.x - start.x
    const dy = end.y - start.y
    const runwayLength = Math.sqrt(dx * dx + dy * dy)

    if (runwayLength === 0) {
        return { inside: false, crossTrack: Infinity, alongTrack: 0, runwayLength: 0 }
    }

    // Unit vectors
    const ux = dx / runwayLength // Along runway
    const uy = dy / runwayLength
    const vx = -uy // Perpendicular to runway
    const vy = ux

    // Vector from start to point
    const px = point.x - start.x
    const py = point.y - start.y

    // Project point onto runway coordinate system
    const alongTrack = px * ux + py * uy // Distance along runway from start
    const crossTrack = px * vx + py * vy // Distance perpendicular to runway (signed)

    // Check if within runway bounds
    const withinLength = alongTrack >= 0 && alongTrack <= runwayLength
    const withinWidth = Math.abs(crossTrack) <= halfWidth

    return {
        inside: withinLength && withinWidth,
        crossTrack: crossTrack,
        alongTrack: alongTrack,
        runwayLength: runwayLength
    }
}

/**
 * Check if an aircraft position is on a specific runway.
 *
 * @param lat - Aircraft latitude in degrees
 * @param lon - Aircraft longitude in degrees
 * @param runway - Runway data
 * @param bufferFt - Buffer to add to runway width (feet)
 * @returns Detection result with runway info and distances
 */
function isPositionOnRunway(
    lat: number,
    lon: number,
    runway: Runway,
    bufferFt: number = RUNWAY_BUFFER_FT
): { onRunway: boolean; crossTrackFt: number; alongTrackFt: number; runwayLengthFt: number } {
    // Need both threshold coordinates
    if (
        runway.le_latitude_deg === null ||
        runway.le_longitude_deg === null ||
        runway.he_latitude_deg === null ||
        runway.he_longitude_deg === null
    ) {
        return { onRunway: false, crossTrackFt: Infinity, alongTrackFt: 0, runwayLengthFt: 0 }
    }

    // Need width
    const widthFt = runway.width_ft ?? 150 // Default to 150ft if not specified
    const halfWidthMeters = ((widthFt / 2) + bufferFt) * FEET_TO_METERS

    // Convert all coordinates to local meters using runway start as reference
    const refLat = runway.le_latitude_deg
    const refLon = runway.le_longitude_deg

    const point = latLonToLocalMeters(lat, lon, refLat, refLon)
    const start = { x: 0, y: 0 } // le is the reference point
    const end = latLonToLocalMeters(
        runway.he_latitude_deg,
        runway.he_longitude_deg,
        refLat,
        refLon
    )

    const result = isPointInRotatedRectangle(point, start, end, halfWidthMeters)

    return {
        onRunway: result.inside,
        crossTrackFt: Math.abs(result.crossTrack) / FEET_TO_METERS,
        alongTrackFt: result.alongTrack / FEET_TO_METERS,
        runwayLengthFt: result.runwayLength / FEET_TO_METERS
    }
}

/**
 * Check if an aircraft is on a runway at a given airport.
 *
 * @param lat - Aircraft latitude in degrees
 * @param lon - Aircraft longitude in degrees
 * @param alt - Aircraft altitude in feet (MSL)
 * @param airport - Airport ICAO code
 * @param runway - Optional specific runway identifier (e.g., "01", "19", "08L")
 *                 If not specified, checks all runways at the airport
 * @param options - Optional configuration overrides
 * @returns Detection result indicating if aircraft is on runway with details
 */
export function isOnRunway(
    lat: number,
    lon: number,
    alt: number,
    airport: string,
    runway?: string,
    options?: {
        bufferFt?: number
        altitudeThresholdFt?: number
    }
): RunwayDetectionResult {
    const bufferFt = options?.bufferFt ?? RUNWAY_BUFFER_FT
    const altitudeThresholdFt = options?.altitudeThresholdFt ?? ALTITUDE_THRESHOLD_FT

    // Get field elevation
    const fieldElevation = getAirportElevation(airport)
    if (fieldElevation === undefined) {
        return { onRunway: false }
    }

    // Check altitude above field
    const altitudeAboveField = alt - fieldElevation
    if (altitudeAboveField > altitudeThresholdFt) {
        return {
            onRunway: false,
            details: {
                crossTrackDistanceFt: Infinity,
                alongTrackDistanceFt: 0,
                runwayLengthFt: 0,
                runwayWidthFt: 0,
                altitudeAboveFieldFt: altitudeAboveField,
                fieldElevationFt: fieldElevation
            }
        }
    }

    // Get runways for this airport
    const runways = getRunwaysByAirport(airport)
    if (runways.length === 0) {
        return { onRunway: false }
    }

    // Filter to specific runway if specified
    let candidateRunways: Runway[]
    if (runway) {
        // Match by either le_ident or he_ident
        candidateRunways = runways.filter(
            r => r.le_ident === runway || r.he_ident === runway
        )
        if (candidateRunways.length === 0) {
            return { onRunway: false }
        }
    } else {
        candidateRunways = runways
    }

    // Check each runway
    for (const rwy of candidateRunways) {
        const result = isPositionOnRunway(lat, lon, rwy, bufferFt)

        if (result.onRunway) {
            return {
                onRunway: true,
                runway: {
                    leIdent: rwy.le_ident,
                    heIdent: rwy.he_ident,
                    airportIdent: rwy.airport_ident
                },
                details: {
                    crossTrackDistanceFt: result.crossTrackFt,
                    alongTrackDistanceFt: result.alongTrackFt,
                    runwayLengthFt: result.runwayLengthFt,
                    runwayWidthFt: rwy.width_ft ?? 150,
                    altitudeAboveFieldFt: altitudeAboveField,
                    fieldElevationFt: fieldElevation,

                }
            }
        }
    }

    // Not on any runway
    return {
        onRunway: false,
        details: {
            crossTrackDistanceFt: Infinity,
            alongTrackDistanceFt: 0,
            runwayLengthFt: 0,
            runwayWidthFt: 0,
            altitudeAboveFieldFt: altitudeAboveField,
            fieldElevationFt: fieldElevation
        }
    }
}

/**
 * Check if a flight is on a runway at any of the specified airports.
 * This is a convenience wrapper for use with the rules engine.
 *
 * @param lat - Aircraft latitude
 * @param lon - Aircraft longitude
 * @param alt - Aircraft altitude (feet MSL)
 * @param airports - List of airport ICAO codes to check
 * @returns The first runway match result, or undefined if not on any runway
 */
export function isOnAnyRunway(
    lat: number,
    lon: number,
    alt: number,
    airports: string[]
): RunwayDetectionResult | undefined {
    for (const airport of airports) {
        const result = isOnRunway(lat, lon, alt, airport)
        if (result.onRunway) {
            return result
        }
    }
    return undefined
}
