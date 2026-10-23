/**
 * Full ESSA placeable-section catalog for the top-right workspace menu.
 * Independent of the role-filtered server layout — controllers can add any
 * header even when their current role would hide it from the default bay.
 */
export const ESSA_CATALOG_SECTIONS: readonly { sectionId: string; title: string }[] = [
  { sectionId: 'inbound', title: 'INBOUND' },
  { sectionId: 'inbound_twr_e', title: 'INBOUND TWR-E' },
  { sectionId: 'inbound_twr_w', title: 'INBOUND TWR-W' },
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
  { sectionId: 'pending_dep', title: 'CD ALL' },
] as const
