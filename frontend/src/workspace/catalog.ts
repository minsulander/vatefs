/**
 * Placeable-section catalogs for the top-right workspace menu.
 *
 * OTHER Sections menu (flat): Empty divider is rendered first by the top bar, then:
 *   INBOUND → TMA / CTR → TMA → CTR → RUNWAY → TAXIWAY → PUSH&START
 *     → CLEARED → PENDING CLR → DEP (bottom; read upward DEP → PENDING CLR → CLEARED)
 * TMA / CTR / DEP slices are always listed (greyed when not addable).
 * TMA / CTR splits → TMA + CTR; CTR splits → CTR ARR + CTR DEP.
 * DEP splits → PENDING CLR + CLEARED.
 */

/**
 * Full ESSA placeable-section catalog (role-independent).
 * TMA ARR/DEP and CTR ARR/DEP share YAML ids (`ctr_arr` / `ctr_dep`) — title selects
 * the header label; APP default layout uses TMA; TWR-only uses CTR.
 */
export const ESSA_CATALOG_SECTIONS: readonly { sectionId: string; title: string }[] = [
  { sectionId: 'inbound_acc', title: 'INBOUND ACC' },
  { sectionId: 'inbound', title: 'INBOUND APP' },
  { sectionId: 'inbound', title: 'INBOUND TWR-E, TWR-W' },
  { sectionId: 'inbound_twr_e', title: 'INBOUND TWR-E' },
  { sectionId: 'inbound_twr_w', title: 'INBOUND TWR-W' },
  { sectionId: 'ctr_arr', title: 'TMA' },
  { sectionId: 'ctr_arr', title: 'TMA ARR' },
  { sectionId: 'ctr_dep', title: 'TMA DEP' },
  { sectionId: 'ctr_arr', title: 'CTR' },
  { sectionId: 'ctr_arr', title: 'CTR ARR' },
  { sectionId: 'ctr_dep', title: 'CTR DEP' },
  { sectionId: 'inbound_gnd', title: 'INBOUND GND-E, GND-N, GND-W' },
  { sectionId: 'inbound_gnd_e', title: 'INBOUND GND-E' },
  { sectionId: 'inbound_gnd_n', title: 'INBOUND GND-N' },
  { sectionId: 'inbound_gnd_w', title: 'INBOUND GND-W' },
  { sectionId: 'taxi_arr', title: 'TAXIWAY ARR' },
  { sectionId: 'taxi_dep', title: 'TAXIWAY DEP' },
  { sectionId: 'push_start', title: 'PUSH BACK / START-UP' },
  { sectionId: 'push_back', title: 'PUSH BACK' },
  { sectionId: 'start_up', title: 'START UP' },
  { sectionId: 'req_push', title: 'REQ PUSH / START' },
  { sectionId: 'cleared', title: 'TSAT / EOBT' },
  { sectionId: 'cleared_tsat', title: 'TSAT' },
  { sectionId: 'cleared_eobt', title: 'EOBT' },
  /** Merged CD + TSAT/EOBT — split → CD + TSAT / EOBT (do not list bare YAML "CD") */
  { sectionId: 'pending_dep', title: 'CD ALL' },
] as const

export type SaabCatalogFlow = 'arrival' | 'departure'

export type SaabCatalogEntry = {
  sectionId: string
  title: string
  flow: SaabCatalogFlow
}

/**
 * OTHER (classic) sections — menu order (Empty divider is separate, above this list).
 *
 * TMA / CTR uses primary id ctr_arr (ensures tma + ctr_dep on add).
 * DEP uses primary id pending_dep (ensures cleared on add); splits to PENDING CLR / CLEARED.
 */
export const SAAB_CATALOG_SECTIONS: readonly SaabCatalogEntry[] = [
  { sectionId: 'inbound', title: 'INBOUND', flow: 'arrival' },
  { sectionId: 'ctr_arr', title: 'TMA / CTR', flow: 'arrival' },
  { sectionId: 'tma', title: 'TMA', flow: 'arrival' },
  // Synthetic id — unions ctr_arr + ctr_dep strips (see saab_ctr_tma)
  { sectionId: 'ctr', title: 'CTR', flow: 'arrival' },
  { sectionId: 'ctr_inbound', title: 'CTR INBOUND', flow: 'departure' },
  { sectionId: 'runway', title: 'RUNWAY', flow: 'arrival' },
  // physical runway_* inserted after RUNWAY by catalogSections()
  { sectionId: 'taxi', title: 'TAXIWAY', flow: 'arrival' },
  { sectionId: 'push_start', title: 'PUSH&START', flow: 'departure' },
  // Bottom of menu upward: DEP → PENDING CLR → CLEARED
  { sectionId: 'cleared', title: 'CLEARED', flow: 'departure' },
  { sectionId: 'pending_dep', title: 'PENDING CLR', flow: 'departure' },
  { sectionId: 'pending_dep', title: 'DEP', flow: 'departure' },
] as const

/** Flat list (unique sectionIds) for lookups that ignore flow grouping. */
export const SAAB_CATALOG_SECTION_IDS: readonly string[] = [
  ...new Set(SAAB_CATALOG_SECTIONS.map((e) => e.sectionId)),
]
