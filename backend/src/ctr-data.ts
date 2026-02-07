/**
 * CTR/TIZ boundary data loading from LFV (Swedish AIS provider).
 *
 * Fetches control zone polygons from LFV's WFS endpoint, converts
 * EPSG:3857 (Web Mercator) coordinates to WGS84, and provides
 * point-in-polygon + altitude checks for CTR boundary evaluation.
 */

const CTR_URL = 'https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=mais:CTR&outputFormat=application/json&srsName=EPSG:3857'
const TIZ_URL = 'https://daim.lfv.se/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typename=mais:TIZ&outputFormat=application/json&srsName=EPSG:3857'

interface CtrZone {
    /** Airport ICAO code */
    airport: string
    /** Upper boundary in feet MSL */
    upperFt: number
    /** Polygon coordinates in WGS84 [lat, lon][] */
    polygon: { lat: number; lon: number }[]
}

/** Loaded CTR/TIZ zones indexed by airport ICAO code (one airport may have multiple zones) */
let ctrZones: Map<string, CtrZone[]> = new Map()

/** Whether CTR data has been loaded successfully */
let dataLoaded = false

/**
 * Convert EPSG:3857 (Web Mercator) x,y to WGS84 lon,lat.
 */
function epsg3857ToWgs84(x: number, y: number): { lat: number; lon: number } {
    const lon = (x / 20037508.34) * 180
    const latRad = Math.atan(Math.exp((y / 20037508.34) * Math.PI))
    const lat = latRad * (360 / Math.PI) - 90
    return { lat, lon }
}

/**
 * Ray-casting point-in-polygon test.
 */
function pointInPolygon(lat: number, lon: number, polygon: { lat: number; lon: number }[]): boolean {
    let inside = false
    const n = polygon.length

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = polygon[i].lat
        const xi = polygon[i].lon
        const yj = polygon[j].lat
        const xj = polygon[j].lon

        if (((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside
        }
    }

    return inside
}

/**
 * Parse a GeoJSON FeatureCollection from LFV and extract CTR zones.
 */
function parseFeatures(geojson: any): CtrZone[] {
    const zones: CtrZone[] = []

    if (!geojson?.features || !Array.isArray(geojson.features)) {
        return zones
    }

    for (const feature of geojson.features) {
        const props = feature.properties
        if (!props?.POSITIONINDICATOR || !props?.UPPER) continue

        const airport = props.POSITIONINDICATOR as string
        const upperFt = parseInt(props.UPPER, 10)
        if (isNaN(upperFt)) continue

        const geometry = feature.geometry
        if (!geometry || geometry.type !== 'Polygon' || !geometry.coordinates) continue

        // GeoJSON Polygon: coordinates is an array of rings, first ring is the outer boundary
        const outerRing = geometry.coordinates[0]
        if (!Array.isArray(outerRing)) continue

        const polygon: { lat: number; lon: number }[] = []
        for (const coord of outerRing) {
            if (Array.isArray(coord) && coord.length >= 2) {
                const { lat, lon } = epsg3857ToWgs84(coord[0], coord[1])
                polygon.push({ lat, lon })
            }
        }

        if (polygon.length >= 3) {
            zones.push({ airport, upperFt, polygon })
        }
    }

    return zones
}

/**
 * Fetch and parse CTR/TIZ boundary data from LFV.
 * Fetches both CTR (controlled airports) and TIZ (AFIS airports) data.
 * Returns the total number of zones loaded.
 */
export async function loadCtrData(): Promise<number> {
    ctrZones = new Map()
    dataLoaded = false

    const results = await Promise.allSettled([
        fetch(CTR_URL, { signal: AbortSignal.timeout(10000) }).then(r => {
            if (!r.ok) throw new Error(`CTR fetch failed: ${r.status}`)
            return r.json()
        }),
        fetch(TIZ_URL, { signal: AbortSignal.timeout(10000) }).then(r => {
            if (!r.ok) throw new Error(`TIZ fetch failed: ${r.status}`)
            return r.json()
        })
    ])

    let totalZones = 0

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const zones = parseFeatures(result.value)
            for (const zone of zones) {
                if (!ctrZones.has(zone.airport)) {
                    ctrZones.set(zone.airport, [])
                }
                ctrZones.get(zone.airport)!.push(zone)
                totalZones++
            }
        } else {
            console.warn(`CTR/TIZ fetch warning: ${result.reason}`)
        }
    }

    if (totalZones > 0) {
        dataLoaded = true
        console.log(`Loaded ${totalZones} CTR/TIZ zones for ${ctrZones.size} airports from LFV`)
    } else {
        console.warn('No CTR/TIZ data loaded from LFV')
    }

    return totalZones
}

/**
 * Check if CTR boundary data has been loaded.
 */
export function isCtrDataLoaded(): boolean {
    return dataLoaded
}

/**
 * Check if a position is within any CTR/TIZ zone for the specified airports.
 *
 * Returns:
 * - `true` if within a CTR polygon AND below its upper limit
 * - `false` if outside all CTR polygons OR above all upper limits
 * - `undefined` if no CTR data is available for any of the airports
 */
export function isWithinCtr(
    airports: string[],
    lat: number,
    lon: number,
    altMsl: number
): boolean | undefined {
    if (!dataLoaded) return undefined

    // Collect all zones for the specified airports
    let hasAnyZone = false

    for (const airport of airports) {
        const zones = ctrZones.get(airport)
        if (!zones) continue

        hasAnyZone = true

        for (const zone of zones) {
            if (altMsl <= zone.upperFt && pointInPolygon(lat, lon, zone.polygon)) {
                return true
            }
        }
    }

    // If none of our airports have CTR data, return undefined (unknown)
    if (!hasAnyZone) return undefined

    return false
}

/**
 * Check if a position is within any loaded CTR/TIZ zone (regardless of airport).
 * Used for the /api/withinctr debug endpoint.
 *
 * Returns matching zone info or null.
 */
export function checkCtrAtPosition(
    lat: number,
    lon: number,
    altMsl: number
): { airport: string; upperFt: number; within: boolean } | null {
    if (!dataLoaded) return null

    for (const [airport, zones] of ctrZones) {
        for (const zone of zones) {
            if (pointInPolygon(lat, lon, zone.polygon)) {
                return {
                    airport,
                    upperFt: zone.upperFt,
                    within: altMsl <= zone.upperFt
                }
            }
        }
    }

    return null
}
