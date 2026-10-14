import express, { type Request, type Response } from "express"
import cors from "cors"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { WebSocketServer } from "ws"
import {
  getAirportMeta,
  getOrder,
  initDb,
  listSince,
  purgeExpired,
  remove,
  touchHeartbeat,
  upsert,
  upsertAirportMeta,
  upsertOrder,
  validateAirportMeta,
  validateOrderBody,
  validateSepBody,
  validateStrokes,
  type StripMeta,
} from "./db.js"
import { authModeSummary, getCid, rateLimit, requireCid } from "./auth.js"
import { publishRoom, subscribeRoom, subscribeRoomWs } from "./live.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 17880)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data")

const REALMS = new Set(["live", "sweatbox", "playback", "local"])

initDb(DATA_DIR)
purgeExpired()
setInterval(purgeExpired, 60 * 60 * 1000)

const app = express()
app.use(cors())
app.use(express.json({ limit: "256kb" }))

app.get("/health", (_req, res) => {
  res.json({ ok: true, auth: authModeSummary() })
})

function parseRoom(realm: string, airport: string): { ok: true } | { ok: false; error: string } {
  if (!REALMS.has(realm)) return { ok: false, error: "invalid realm" }
  if (!/^[A-Z0-9]{3,4}$/i.test(airport)) return { ok: false, error: "invalid airport" }
  return { ok: true }
}

function parseAllowlistCid(raw: string | null): number | null {
  if (!raw) return null
  const cid = Number(String(raw).trim())
  if (!Number.isInteger(cid) || cid <= 0) return null
  const allow = process.env.ALLOWED_CIDS?.trim()
  if (!allow) return cid
  const set = new Set(
    allow
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  )
  return set.has(cid) ? cid : null
}

const efs = express.Router()
efs.use(requireCid)

efs.get(
  "/sync/:realm/:airport",
  rateLimit({ windowMs: 60_000, max: 360 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const since = typeof req.query.since === "string" ? req.query.since : undefined
    const list = listSince(realm, airport, since)
    const strips: Record<
      string,
      { strokes: unknown[]; strip?: StripMeta; updatedAt: string; updatedByCid: number | null }
    > = {}
    let updatedAt = since || ""
    for (const row of list) {
      strips[row.stripKey] = {
        strokes: row.strokes,
        ...(row.stripMeta ? { strip: row.stripMeta } : {}),
        updatedAt: row.updatedAt,
        updatedByCid: row.updatedByCid,
      }
      if (row.updatedAt > updatedAt) updatedAt = row.updatedAt
    }
    res.json({ updatedAt: updatedAt || new Date(0).toISOString(), strips })
  },
)

/** Legacy SSE (often delayed/buffered on Cloudflare quick tunnels). Prefer /ws. */
efs.get("/sync/:realm/:airport/stream", (req, res) => {
  const realm = String(req.params.realm || "").toLowerCase()
  const airport = String(req.params.airport || "").toUpperCase()
  const room = parseRoom(realm, airport)
  if (!room.ok) {
    res.status(400).json({ error: room.error })
    return
  }
  const cid = getCid(req)
  res.status(200)
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  ;(res as typeof res & { flushHeaders?: () => void }).flushHeaders?.()
  res.write(`event: hello\ndata: ${JSON.stringify({ realm, airport, cid })}\n\n`)
  subscribeRoom(realm, airport, cid, res)
  console.log(`[vatefs-sync] SSE subscribe ${realm}/${airport} cid=${cid}`)
})

/** Locked contract: full bay order snapshot. */
efs.put(
  "/sync/:realm/:airport/order",
  rateLimit({ windowMs: 60_000, max: 300 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const checked = validateOrderBody(req.body)
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    const cid = getCid(req)
    const row = upsertOrder(realm, airport, checked.order, cid)
    publishRoom(
      realm,
      airport,
      {
        type: "order",
        order: row.order,
        updatedAt: row.updatedAt,
        updatedByCid: row.updatedByCid,
      },
      cid,
    )
    res.json({ ok: true, order: row.order, updatedAt: row.updatedAt })
  },
)

efs.get(
  "/sync/:realm/:airport/order",
  rateLimit({ windowMs: 60_000, max: 360 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const row = getOrder(realm, airport)
    if (!row) {
      res.json({
        order: { revision: 0, entries: [] },
        updatedAt: new Date(0).toISOString(),
        efsActive: false,
      })
      return
    }
    const fresh = Date.now() - Date.parse(row.lastHeartbeatAt) < 5 * 60 * 1000
    res.json({
      order: row.order,
      updatedAt: row.updatedAt,
      lastHeartbeatAt: row.lastHeartbeatAt,
      efsActive: fresh,
    })
  },
)

/** Locked contract: SEP/DLV/DEP GAP. */
efs.put(
  "/sync/:realm/:airport/sep",
  rateLimit({ windowMs: 60_000, max: 120 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const checked = validateSepBody(req.body)
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    const cid = getCid(req)
    const meta = {
      essaSep: checked.sep,
      sep: checked.sep.sep,
      dlv: checked.sep.dlv,
      depGap: checked.sep.depGap,
    }
    const row = upsertAirportMeta(realm, airport, meta, cid)
    touchHeartbeat(realm, airport, cid)
    publishRoom(
      realm,
      airport,
      {
        type: "meta",
        meta: row.meta,
        updatedAt: row.updatedAt,
        updatedByCid: row.updatedByCid,
      },
      cid,
    )
    res.json({ ok: true, ...checked.sep, updatedAt: row.updatedAt })
  },
)

efs.get(
  "/sync/:realm/:airport/sep",
  rateLimit({ windowMs: 60_000, max: 360 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const row = getAirportMeta(realm, airport)
    const s = row?.meta?.essaSep || {
      sep: row?.meta?.sep ?? "",
      dlv: row?.meta?.dlv ?? "",
      depGap: row?.meta?.depGap ?? "",
    }
    res.json({
      sep: s.sep ?? "",
      dlv: s.dlv ?? "",
      depGap: s.depGap ?? "",
      updatedAt: row?.updatedAt || new Date(0).toISOString(),
    })
  },
)

efs.put(
  "/sync/:realm/:airport/heartbeat",
  rateLimit({ windowMs: 60_000, max: 120 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const cid = getCid(req)
    const row = touchHeartbeat(realm, airport, cid)
    publishRoom(
      realm,
      airport,
      { type: "heartbeat", updatedAt: row.lastHeartbeatAt, updatedByCid: cid },
      cid,
    )
    res.json({ ok: true, updatedAt: row.lastHeartbeatAt })
  },
)

/** Locked contract strip path — same handler as legacy /:stripKey. */
function putStripHandler(req: Request, res: Response) {
  const realm = String(req.params.realm || "").toLowerCase()
  const airport = String(req.params.airport || "").toUpperCase()
  const stripKey = decodeURIComponent(String(req.params.stripKey || ""))
  const room = parseRoom(realm, airport)
  if (!room.ok) {
    res.status(400).json({ error: room.error })
    return
  }
  if (!stripKey || stripKey.length > 128) {
    res.status(400).json({ error: "invalid stripKey" })
    return
  }
  const body = req.body && typeof req.body === "object" ? req.body : {}
  const hasStrokes = Object.prototype.hasOwnProperty.call(body, "strokes")
  const hasStrip = Object.prototype.hasOwnProperty.call(body, "strip")
  if (!hasStrokes && !hasStrip) {
    res.status(400).json({ error: "strokes and/or strip required" })
    return
  }
  let strokes: unknown[] | undefined
  if (hasStrokes) {
    const checked = validateStrokes((body as { strokes?: unknown }).strokes)
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    strokes = checked.strokes
  }
  let stripMeta: StripMeta | null | undefined
  if (hasStrip) {
    const raw = (body as { strip?: unknown }).strip
    if (raw == null) {
      stripMeta = null
    } else if (typeof raw === "object") {
      const s = raw as StripMeta
      stripMeta = {
        kind: typeof s.kind === "string" ? s.kind : undefined,
        paperInfoKind: typeof s.paperInfoKind === "string" ? s.paperInfoKind : undefined,
        airport: typeof s.airport === "string" ? s.airport.toUpperCase() : undefined,
        callsign: typeof s.callsign === "string" ? s.callsign : undefined,
        aircraftType: typeof s.aircraftType === "string" ? s.aircraftType : undefined,
        adep: typeof s.adep === "string" ? s.adep : undefined,
        ades: typeof s.ades === "string" ? s.ades : undefined,
        flightRules: typeof s.flightRules === "string" ? s.flightRules : undefined,
        bayId: typeof s.bayId === "string" ? s.bayId : undefined,
        sectionId: typeof s.sectionId === "string" ? s.sectionId : undefined,
        position: typeof s.position === "number" && Number.isFinite(s.position) ? s.position : undefined,
        bottom: typeof s.bottom === "boolean" ? s.bottom : undefined,
        clearanceRead: typeof s.clearanceRead === "boolean" ? s.clearanceRead : undefined,
        qnhGiven:
          s.qnhGiven === null
            ? null
            : typeof s.qnhGiven === "number" && Number.isFinite(s.qnhGiven)
              ? s.qnhGiven
              : undefined,
        atisGiven:
          s.atisGiven === null ? null : typeof s.atisGiven === "string" ? s.atisGiven : undefined,
        noteText: typeof s.noteText === "string" ? s.noteText : undefined,
        std: typeof s.std === "string" ? s.std : undefined,
      }
    } else {
      res.status(400).json({ error: "strip must be an object or null" })
      return
    }
  }
  const cid = getCid(req)
  const row = upsert(realm, airport, stripKey, strokes, stripMeta, cid)
  publishRoom(
    realm,
    airport,
    {
      type: "strip",
      stripKey: row.stripKey,
      strokes: row.strokes,
      ...(row.stripMeta ? { strip: row.stripMeta } : {}),
      updatedAt: row.updatedAt,
      updatedByCid: row.updatedByCid,
    },
    cid,
  )
  res.json({
    ok: true,
    stripKey: row.stripKey,
    updatedAt: row.updatedAt,
    updatedByCid: row.updatedByCid,
  })
}

function deleteStripHandler(req: Request, res: Response) {
  const realm = String(req.params.realm || "").toLowerCase()
  const airport = String(req.params.airport || "").toUpperCase()
  const stripKey = decodeURIComponent(String(req.params.stripKey || ""))
  const room = parseRoom(realm, airport)
  if (!room.ok) {
    res.status(400).json({ error: room.error })
    return
  }
  const cid = getCid(req)
  remove(realm, airport, stripKey, cid)
  const updatedAt = new Date().toISOString()
  publishRoom(
    realm,
    airport,
    {
      type: "stripDeleted",
      stripKey,
      strokes: [],
      updatedAt,
      updatedByCid: cid,
      deleted: true,
    },
    cid,
  )
  res.json({ ok: true })
}

efs.put("/sync/:realm/:airport/strips/:stripKey", rateLimit({ windowMs: 60_000, max: 300 }), putStripHandler)
efs.delete(
  "/sync/:realm/:airport/strips/:stripKey",
  rateLimit({ windowMs: 60_000, max: 120 }),
  deleteStripHandler,
)

/** Legacy airport meta (SEP) — prefer /sep. Must be registered before :stripKey. */
efs.get(
  "/sync/:realm/:airport/meta",
  rateLimit({ windowMs: 60_000, max: 360 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const row = getAirportMeta(realm, airport)
    if (!row) {
      res.json({
        meta: {},
        updatedAt: new Date(0).toISOString(),
        updatedByCid: null,
      })
      return
    }
    res.json({
      meta: row.meta,
      updatedAt: row.updatedAt,
      updatedByCid: row.updatedByCid,
    })
  },
)

efs.put(
  "/sync/:realm/:airport/meta",
  rateLimit({ windowMs: 60_000, max: 120 }),
  (req, res) => {
    const realm = String(req.params.realm || "").toLowerCase()
    const airport = String(req.params.airport || "").toUpperCase()
    const room = parseRoom(realm, airport)
    if (!room.ok) {
      res.status(400).json({ error: room.error })
      return
    }
    const checked = validateAirportMeta(req.body)
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    const cid = getCid(req)
    const row = upsertAirportMeta(realm, airport, checked.meta, cid)
    publishRoom(
      realm,
      airport,
      {
        type: "meta",
        meta: row.meta,
        updatedAt: row.updatedAt,
        updatedByCid: row.updatedByCid,
      },
      cid,
    )
    res.json({
      ok: true,
      meta: row.meta,
      updatedAt: row.updatedAt,
      updatedByCid: row.updatedByCid,
    })
  },
)

/** Legacy strip paths — prefer /strips/:stripKey. */
efs.put("/sync/:realm/:airport/:stripKey", rateLimit({ windowMs: 60_000, max: 300 }), putStripHandler)
efs.delete(
  "/sync/:realm/:airport/:stripKey",
  rateLimit({ windowMs: 60_000, max: 120 }),
  deleteStripHandler,
)

app.use("/efs", efs)

const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on("upgrade", (req, socket, head) => {
  try {
    const host = req.headers.host || "127.0.0.1"
    const url = new URL(req.url || "/", `http://${host}`)
    const m = url.pathname.match(/^\/efs\/sync\/([^/]+)\/([^/]+)\/ws\/?$/i)
    if (!m) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
      socket.destroy()
      return
    }
    const realm = m[1]!.toLowerCase()
    const airport = m[2]!.toUpperCase()
    if (!parseRoom(realm, airport).ok) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
      socket.destroy()
      return
    }
    const cid =
      parseAllowlistCid(url.searchParams.get("cid")) ??
      parseAllowlistCid(req.headers["x-vatsim-cid"] as string | undefined ?? null)
    if (cid == null) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      subscribeRoomWs(realm, airport, cid, ws)
      ws.send(JSON.stringify({ type: "hello", realm, airport, cid }))
      console.log(`[vatefs-sync] WS subscribe ${realm}/${airport} cid=${cid}`)
    })
  } catch {
    socket.destroy()
  }
})

server.listen(PORT, () => {
  console.log(`[vatefs-sync] http://127.0.0.1:${PORT}`)
  console.log(`[vatefs-sync] data: ${DATA_DIR}`)
  console.log(`[vatefs-sync] auth: ${authModeSummary()}`)
  console.log(`[vatefs-sync] live: WebSocket /efs/sync/:realm/:airport/ws?cid=…`)
  console.log(`[vatefs-sync] tunnel: cloudflared tunnel --url http://127.0.0.1:${PORT}`)
})
