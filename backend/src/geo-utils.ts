/**
 * Geographic utility functions for distance calculations.
 */

/**
 * Calculate the distance in nautical miles between two coordinates using Haversine formula.
 */
export function calculateDistanceNm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 3440.065 // Earth's radius in nautical miles

    const dLat = toRadians(lat2 - lat1)
    const dLon = toRadians(lon2 - lon1)

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
}

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
}

/**
 * Airport coordinate lookup function type.
 */
export type GetAirportCoords = (icao: string) => { latitude: number; longitude: number } | undefined

/**
 * Check if a position is within range of any of the specified airports.
 */
export function isWithinRangeOfAnyAirport(
    lat: number,
    lon: number,
    airportIcaos: string[],
    rangeNm: number,
    getAirport: GetAirportCoords
): boolean {
    for (const icao of airportIcaos) {
        const airport = getAirport(icao)
        if (airport) {
            const distance = calculateDistanceNm(lat, lon, airport.latitude, airport.longitude)
            if (distance <= rangeNm) {
                return true
            }
        }
    }
    return false
}

/**
 * Find the nearest airport from a list of airports to a given position.
 * Returns the ICAO code of the nearest airport, or undefined if none found.
 */
export function findNearestAirport(
    lat: number,
    lon: number,
    airportIcaos: string[],
    getAirport: GetAirportCoords
): string | undefined {
    let nearestIcao: string | undefined
    let nearestDistance = Infinity

    for (const icao of airportIcaos) {
        const airport = getAirport(icao)
        if (airport) {
            const distance = calculateDistanceNm(lat, lon, airport.latitude, airport.longitude)
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestIcao = icao
            }
        }
    }

    return nearestIcao
}
