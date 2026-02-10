# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VatEFS is an Electronic Flight Strip application for VATSIM. The system consists of three main components that communicate via WebSocket and UDP:

1. **Frontend** - Vue 3 + Vuetify web application
2. **Backend** - Express server with WebSocket and UDP bridge
3. **EuroScope Plugin** - C++ plugin that integrates with the EuroScope ATC client

## Architecture

### Communication Flow

```
EuroScope Plugin (C++) <--UDP--> Backend (Node.js) <--WebSocket--> Frontend (Vue)
     Port 17771/17772              Port 17770
```

- **EuroScope Plugin** sends flight plan updates and controller data as JSON via UDP (port 17771)
- **Backend** bridges UDP messages to WebSocket connections
- **Frontend** connects to backend WebSocket (port 17770) and displays flight strips

### Shared Code

The `common` package (`@vatefs/common`) contains shared code between frontend and backend:
- Type definitions for flight strips, bays, sections, and gaps
- WebSocket message types (server-to-client and client-to-server)
- Gap management utilities (shared between frontend and backend)
- Version constants

## Development Commands

### Frontend (Vue 3 + Vuetify)

```bash
cd frontend
npm install
npm run dev      # Start Vite dev server
npm run build    # Build for production (runs type-check + vite build)
npm run preview  # Preview production build
npm run type-check  # Run TypeScript type checking
npm run format   # Format code with Prettier
```

The frontend runs on the Vite dev server (default port 5173) and connects to the backend WebSocket at `ws://localhost:17770`.

### Backend (Express + WebSocket + UDP)

```bash
cd backend
npm install
npm start        # Run with tsx (dev mode with hot reload)
npm run build    # Bundle with esbuild for production
npm run build:only  # Build without copying public files
```

The backend:
- Serves static files from `public/` directory (production build of frontend)
- Runs HTTP/WebSocket server on port 17770
- Listens for UDP messages on port 17771 (from EuroScope)
- Sends UDP messages on port 17772 (to EuroScope)

Command-line arguments:
- `--config FILE` - Load configuration from YAML file (default: `data/config/singlerwy4bays.yml`)
- `--callsign CALLSIGN` - Override controller callsign (normally comes from EuroScope myselfUpdate)
- `--record FILE` - Record UDP messages to file for playback
- `--mock` - Load mock flight data for testing without EuroScope

### Common (Shared TypeScript)

```bash
cd common
npm install
npm run build    # Compile TypeScript to dist/
npm run lint     # Run ESLint
npm run lint:fix # Fix ESLint issues
```

The common package is referenced as a file dependency (`file:../common`) in both frontend and backend.

### EuroScope Plugin (C++)

The plugin is built with CMake and requires the EuroScope SDK (located in `external/`).

```bash
cd euroscope-plugin
# Build with CMake (Windows/MSVC)
cmake -B build
cmake --build build
```

Build outputs a `VatEFS.dll` that loads into EuroScope. The plugin:
- Filters flight plans for Swedish airports (ICAO starting with "ES")
- Tracks flight plan updates, controller assignments, and runway configurations
- Sends JSON data via UDP to the backend
- Supports commands: `.efs all`, `.efs mine`, `.efs debug`, `.efs test`

## Technology Stack

### Frontend
- **Vue 3** - Composition API
- **Vuetify 3** - Material Design component library
- **Pinia** - State management (store in `src/store/efs.ts`)
- **Vue Router** - Client-side routing
- **TypeScript** - Static typing
- **Vite** - Build tool

### Backend
- **Express 5** - Web server
- **ws** - WebSocket library
- **esbuild** - Bundler for production builds
- **tsx** - TypeScript execution for development

### EuroScope Plugin
- **C++20** - Language standard
- **nlohmann/json** - JSON parsing
- **EuroScope Plugin SDK** - ATC client integration
- **CMake** - Build system

## Key Files and Patterns

### Frontend Structure
- `src/main.ts` - Application entry, Vuetify setup
- `src/App.vue` - Root component
- `src/router.ts` - Route definitions with hash/history mode detection
- `src/store/efs.ts` - Pinia store: WebSocket connection, strips, gaps, sections
- `src/views/HomeView.vue` - Main view with strip bay layout
- `src/components/StripBay.vue` - Bay container with sections
- `src/components/StripSection.vue` - Section with drag-and-drop strips
- `src/components/FlightStrip.vue` - Individual flight strip component

### Backend Structure
- `src/server.ts` - Main server: Express, WebSocket, and UDP handlers
- `src/store.ts` - EfsStore: strip and gap management, plugin message processing
- `src/flightStore.ts` - FlightStore: flight data management, strip creation, eligibility filtering
- `src/types.ts` - Plugin message types and Flight interface
- `src/config.ts` - Re-exports from split configuration modules
- `src/config-types.ts` - Type definitions for rules (SectionRule, ActionRule, etc.)
- `src/static-config.ts` - Runtime configuration state (loaded from YAML)
- `src/config-loader.ts` - YAML configuration file loader
- `src/rules-engine.ts` - Rule evaluation functions for sections, actions, deletes, moves
- `src/geo-utils.ts` - Geographic utility functions (Haversine distance, range checks)
- `src/airport-data.ts` - Airport data loading from CSV (coordinates, elevation)
- `src/runway-data.ts` - Runway data loading from CSV
- `src/hoppie-config.ts` - Hoppie logon code + DCL template loading from EuroScope files
- `src/hoppie-service.ts` - Hoppie ACARS HTTP client (ping, poll, message parsing)
- `src/mockPluginMessages.ts` - Mock data for testing (empty by default)
- `src/playback.ts` - Utility script for replaying recorded UDP messages

### Data Files
- `data/airports.csv` - Airport database with ICAO codes, coordinates, elevations
- `data/runways.csv` - Runway database with headings, dimensions, thresholds
- `data/config/singlerwy4bays.yml` - Default configuration for ESGG (Gothenburg)

### Configuration Files (YAML)

Configuration is loaded from YAML files in `data/config/`. The default is `singlerwy4bays.yml`.

```yaml
airports:
  - ESGG          # List of airports to track

radarRange: 25    # Radar range in nm for strip filtering

layout:
  bays:
    bay1:         # Bay ID as key
      sections:
        inbound:  # Section ID as key
          title: INBOUND
          addFromTop: true  # Optional, default true

sectionRules:
  rule_name:      # Rule ID as key
    sectionId: inbound
    bayId: bay1
    direction: arrival  # departure/arrival/either
    groundstates: [ARR, '']
    controller: not_myself  # myself/not_myself/any
    priority: 70

actionRules:
  assume_inbound:
    action: ASSUME
    sectionId: inbound
    priority: 100

deleteRules:
  delete_parked:
    direction: arrival
    groundstates: [PARK]
    priority: 100

moveRules:
  pending_to_cleared:
    fromSectionId: pending_clr
    toSectionId: cleared
    command:
      type: setClearance
      value: true
```

### Common Structure
- `src/index.ts` - Main exports
- `src/types.ts` - FlightStrip, Section, Bay, Gap, EfsLayout types
- `src/messages.ts` - WebSocket message types and type guards
- `src/gap-utils.ts` - Shared gap management utilities
- `src/constants.ts` - Version constant

### EuroScope Plugin Structure
- `src/plugin.h` / `src/plugin.cpp` - Main plugin implementation
- `src/main.cpp` - DLL entry point
- `src/Version.h.in` - Version template (configured by CMake)

## Rules Engine

The backend uses a priority-based rules engine to determine:

### Section Rules
Determine which section a flight strip belongs to based on:
- Flight direction (departure/arrival/either)
- Ground state (NSTS, STUP, PUSH, TAXI, TXIN, DEPA, ARR, LINEUP, etc.)
- Controller relationship (myself/not_myself/any)
- Clearance flag, cleared to land flag, airborne flag

### Action Rules
Determine the default action button on a strip (ASSUME, CTL, CTO, XFER, PUSH, TAXI)

### Delete Rules
Determine when to soft-delete (hide) a strip:
- Departures: high altitude + transferred
- Arrivals: parked

### Move Rules
Determine EuroScope commands when strips are manually dragged between sections:
- PENDING CLR → CLEARED: set clearance flag
- CLEARED → START&PUSH: set groundstate PUSH
- etc.

## Important Notes

### Port Configuration
All three components are hardcoded to use:
- Backend HTTP/WebSocket: `17770`
- Backend UDP receive (from plugin): `17771`
- Backend UDP send (to plugin): `17772`

These ports are defined in multiple places and must be kept in sync.

### Router Behavior
The frontend router uses hash-based routing for Electron environments and history mode otherwise (detected via `window.electron`). Routes are persisted to localStorage.

### Sweden-Only Filtering
The EuroScope plugin filters flight plans to only track aircraft with origin or destination starting with "ES" (Swedish airports). This is hardcoded in `FilterFlightPlan()`.

### Plugin Settings
The plugin reads settings from `VatEFSPlugin.txt` (same directory as DLL):
- `debug` - Enable debug messages
- `updateall` - Track all flight plans instead of just own sector

### WebSocket Auto-Reconnect
The frontend store automatically attempts to reconnect every 3 seconds if the WebSocket connection is lost.

### Ground States
Valid ground state values from EuroScope:
- Empty string `''` - No ground state set
- `NSTS` - No status
- `ONFREQ` - On frequency
- `DE-ICE` - De-icing (meaning Ready in swedish setup)
- `STUP` - Startup approved
- `PUSH` - Pushback approved
- `TAXI` - Taxiing (departure)
- `LINEUP` - Lined up on runway
- `DEPA` - Departure roll / cleared for takeoff
- `ARR` - Arrival
- `TXIN` - Taxiing in (arrival)
- `PARK` - Parked

### Strip Positioning
Sections can be configured with `addFromTop: true` (default) which adds new strips at position 0 and shifts existing strips down, or `addFromTop: false` to add at the bottom.

### Strip Eligibility Filtering
Strips are only created for flights that meet all of these criteria:
1. **Radar position required**: Flight must have latitude/longitude from radar updates
2. **Relevant airport**: Flight's origin, destination, or alternate must be in `myAirports`
3. **Within range**: Flight must be within `radarRangeNm` (default 25nm) of any `myAirport`

This filtering ensures strips only appear for flights that are relevant to the controller's position and within their radar coverage area.

### Multi-Airport Support
The backend supports controlling multiple airports simultaneously:
- Configure via `--airport ESGG,ESSA` (comma-separated)
- Field elevation is dynamically determined from the nearest configured airport
- Strips appear for flights to/from any configured airport within radar range

### Hoppie DCL Integration

VatEFS integrates with the [Hoppie ACARS network](http://hoppie.nl/acars/system/tech.html) for Data-Link Clearance (DCL) delivery.

**Configuration files** (loaded from EuroScope directory):
- `ESAA/Plugins/TopSkyCPDLChoppieCode.txt` - User's Hoppie logon code (alphanumeric, <40 chars)
- `ESAA/Plugins/TopSkyCPDLC.txt` - DCL templates in `[DCL]` section (format: `DCL:<airport>:SID:<template>`)

**DCL-capable airports**: ESGG and ESSA (configured via TopSkyCPDLC.txt templates)

**DCL callsign determination**:
- Exactly one of ESGG/ESSA must be in `myAirports` (exclusive or)
- If both or neither → DCL unavailable
- With `--mock` flag → uses callsign `VATEFSTEST`

**Backend files**:
- `src/hoppie-config.ts` - Loads logon code and DCL templates from EuroScope directory
- `src/hoppie-service.ts` - HTTP client for Hoppie API (login via ping, polling every 45-75s)

**WebSocket messages**:
- `dclStatus` (server→client) - DCL status: `unavailable`, `available`, `connected`, `error`
- `hoppieMessage` (server→client) - Incoming Hoppie message (from, messageType, packet)
- `dclAction` (client→server) - Login/logout action

**Frontend**: DCL button in top bar — grey (available), green (connected), red (error). Hidden when unavailable.

**DCL Message Flow**:
1. Pilot sends telex: `REQUEST PREDEP CLEARANCE <callsign> <actype> TO <dest> AT <airport> STAND <stand> ATIS <atis>`
2. Backend validates (correct airport, flight exists) → sets `dclStatus=REQUEST` on Flight
3. Backend sends ack CPDLC: `/data2/<seq>//NE/DEPART REQUEST STATUS . FSM <HHmm> <DDMMYY> <airport> @<callsign>@ RCD RECEIVED @REQUEST BEING PROCESSED @STANDBY`
4. If invalid → sends reject CPDLC with `RCD REJECTED @REVERT TO VOICE PROCEDURES`
5. Controller reviews in clearance dialog, sets SID/CFL/squawk, clicks Send
6. Backend fills template with `@` markers, sends CPDLC: `/data2/<seq>//WU/<airport> PDC <pdc> . . . . . CLD <HHmm> <DDMMYY> <airport> PDC <pdc> @<callsign>@ <clearance>`
7. Pilot responds WILCO → `dclStatus=DONE`, clearance flag set via EuroScope plugin
8. Pilot responds UNABLE → `dclStatus=UNABLE`

**dclStatus lifecycle on Flight/FlightStrip**:
- `REQUEST` - Pilot request received, pending controller action (CLNC button yellow)
- `INVALID` - Request failed validation (CLNC button red)
- `SENT` - Clearance sent to pilot, awaiting response (CLNC button green)
- `WILCO` - Pilot accepted (transient, immediately becomes DONE)
- `UNABLE` - Pilot rejected clearance (CLNC button red)
- `REJECTED` - Controller rejected request (CLNC button red)
- `DONE` - Clearance confirmed, clearance flag set
- `undefined` - No DCL in progress, or cleared by voice (OK button)

**DCL fields on Flight** (backend only): `dclSeqNumber` (CPDLC seq for matching WILCO/UNABLE), `dclPdcNumber` (PDC counter)

**Template variables**: `<ades>`, `<drwy>`, `<sid>`, `<assr>`, `<eobt>`, `<cfl>`, `<freq_own>`, `<freq_next>`, `<atis>`, `<qnh>`, `<rmk>`
- `fillDclTemplate()` replaces with plain values (for dialog preview)
- `fillDclTemplateWithMarkers()` replaces with `@value@` (for CPDLC send)

**Frequency storage**: `staticConfig.myFrequency` set from `myselfUpdate.frequency` (or 118.505 in mock mode)

**WebSocket messages** (additional):
- `dclReject` (client→server) - Reject a DCL request (stripId)
- `dclSend` (client→server) - Send DCL clearance (stripId, remarks)

### Refactor Guardrails
- Prefer editing source files under `frontend/src`, `backend/src`, and `common/src`.
- Treat `frontend/dist`, `backend/dist`, and `*/node_modules` as generated artifacts; avoid manual edits there.
- If you change WebSocket/client-server message shape, update shared types in `common/src/messages.ts` first and then align backend/frontend handlers.
