export interface FlightStrip {
  id: string
  callsign: string
  aircraftType: string
  origin: string
  destination: string
  altitude?: string
  speed?: string
  departureTime?: string
  arrivalTime?: string
  route?: string
  squawk?: string
  bayId: string
  sectionId: string
  position: number
}

export interface Section {
  id: string
  title: string
  stripIds: string[]
}

export interface Bay {
  id: string
  sections: Section[]
}

export interface EfsConfig {
  bays: Bay[]
}
