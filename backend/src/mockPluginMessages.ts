/**
 * Mock plugin messages for development and testing.
 *
 * These messages simulate EuroScope plugin data for testing the flight store
 * without a live connection. Set the array to contain mock messages to enable.
 *
 * To enable mock data, populate the mockPluginMessages array below.
 * See mockPluginMessages.example.ts for sample mock data structure.
 */

import type { PluginMessage } from "./types.js"

/**
 * Mock messages to simulate initial flight data.
 * Empty by default - populate for testing without EuroScope.
 */
export const mockPluginMessages: PluginMessage[] = []

/**
 * Backend state updates - these set the clearedToLand and airborne flags
 * that aren't received from the plugin but managed by the backend
 */
export interface BackendStateUpdate {
    callsign: string
    clearedToLand?: boolean
    airborne?: boolean
}

export const mockBackendStateUpdates: BackendStateUpdate[] = []
