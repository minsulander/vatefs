# VatEFS – lokal development

Kör frontend + backend lokalt så du kan tweaka UI/regler samtidigt som appen körs. Hot reload på båda två.

## Krav

- Node.js 20.19+ eller 22.12+
- Git clone av repo:t

## Första gången (install)

```bash
cd common
npm install
npm run build

cd ../backend
npm install

cd ../frontend
npm install
```

## Starta (två terminaler)

**Terminal 1 – backend** (port `17770`, hot reload via `tsx --watch`):

```bash
cd backend
npm start -- --mock
```

**Terminal 2 – frontend** (Vite, oftast `http://localhost:5173`):

```bash
cd frontend
npm start
```

Öppna frontend-URL:en i webbläsaren. Den pratar WebSocket med backend på `ws://localhost:17770`.

`--mock` = mock-flight data utan EuroScope (default ESGG). Bra för UI/regler-tweaks.

## Vanliga flags (backend)

```bash
# Mock ESGG (default med --mock)
npm start -- --mock

# Specifik airport / callsign
npm start -- --mock --airport ESGG --callsign ESGG_TWR
npm start -- --mock --airport ESSA --callsign ESSA_TWR

# Explicit config
npm start -- --mock --config ../data/config/esgg.yml

# Utan mock = online via EuroScope-plugin (UDP 17771/17772)
npm start
```

## Tweaka samtidigt

| Du ändrar… | Vad händer |
|---|---|
| `frontend/src/...` | Vite HMR – syns direkt |
| `backend/src/...` | `tsx --watch` startar om servern |
| `data/config/*.yml` | Starta om backend |
| `common/src/...` | `cd common && npm run build`, sen starta om backend/frontend |

## Spoofa CTOT / CDM (dev)

Med backend igång (TTY): skriv i backend-terminalen:

```text
efs> spoof SAS489 ctot=2055
efs> spoof SAS489 ctot=2055 reason=TEST tobt=2028 tsat=2028
efs> spoof SAS489 ctot=
efs> spoof SAS489 clear
efs> show SAS489
efs> help
```

Från en annan terminal (localhost HTTP):

```bash
cd backend
npm run spoof -- SAS489 ctot=2055
npm run spoof -- show SAS489
npm run spoof -- SAS489 clear
```

## Tips

- ESGG paper look: `--mock` eller `--config ../data/config/esgg.yml`
- Frontend från iPad/annan device: `cd frontend && npm start -- --host`
- Backend utan frontend-dev: öppna `http://localhost:17770` (servar built frontend från `public/` – för live UI-tweaks: kör Vite)
- Plugin behövs inte för mock-läge

## Portar

- Frontend (Vite): `5173`
- Backend HTTP/WS: `17770`
- UDP från EuroScope: `17771` → backend → `17772` tillbaka

## Kortversion

```bash
cd common && npm i && npm run build
cd ../backend && npm i
cd ../frontend && npm i
```

Sedan två terminaler:

```bash
# 1
cd backend && npm start -- --mock

# 2
cd frontend && npm start
```

Öppna http://localhost:5173 — ändra kod, se HMR/reload live.
