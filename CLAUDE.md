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

The `common` package (`@vatefs/common`) contains shared code between frontend and backend. Currently minimal (just version constants), but intended for shared types and utilities.

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
- `src/store/efs.ts` - WebSocket connection management
- `src/components/Strip.vue` - Flight strip component
- `src/views/HomeView.vue` - Main view

### Backend Structure
- `src/server.ts` - Single-file server with Express, WebSocket, and UDP logic

### EuroScope Plugin Structure
- `src/plugin.h` / `src/plugin.cpp` - Main plugin implementation
- `src/main.cpp` - DLL entry point
- `src/Version.h.in` - Version template (configured by CMake)

### Plugin Event Handlers
- `OnFlightPlanFlightPlanDataUpdate` - Flight plan changes
- `OnFlightPlanControllerAssignedDataUpdate` - Controller assignments (squawk, altitude, heading, etc.)
- `OnTimer` - Periodic updates, handles connection state and UDP receive
- `UpdateMyself` - Collects controller and runway configuration data
- `PostUpdates` - Sends batched updates via UDP

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
