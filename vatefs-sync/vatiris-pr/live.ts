/**
 * Live fanout for VatIRIS EFS sync rooms (WebSocket primary; SSE optional).
 */

import type { Response } from "express"
import type { WebSocket } from "ws"
import type { AirportMetaPayload, StripMeta } from "./routes.js"

export type LiveUpdate =
  | {
      type: "scribble"
      stripKey: string
      strokes: unknown[]
      strip?: StripMeta
      updatedAt: string
      updatedByCid: number | null
      deleted?: boolean
    }
  | {
      type: "meta"
      meta: AirportMetaPayload
      updatedAt: string
      updatedByCid: number | null
    }
  | {
      /** Late-joiner `.efs refresh` — peers re-write assumed CLR/CFL/CTL into ES */
      type: "reassertAssumed"
      updatedAt: string
      updatedByCid: number | null
    }

type SseClient = { kind: "sse"; res: Response; cid: number }
type WsClient = { kind: "ws"; ws: WebSocket; cid: number }
type Client = SseClient | WsClient

const rooms = new Map<string, Set<Client>>()

function roomKey(realm: string, airport: string) {
  return `${realm}/${airport}`
}

function addClient(realm: string, airport: string, client: Client): () => void {
  const key = roomKey(realm, airport)
  let set = rooms.get(key)
  if (!set) {
    set = new Set()
    rooms.set(key, set)
  }
  set.add(client)
  return () => {
    set!.delete(client)
    if (set!.size === 0) rooms.delete(key)
  }
}

export function subscribeRoom(
  realm: string,
  airport: string,
  cid: number,
  res: Response,
): () => void {
  const client: SseClient = { kind: "sse", res, cid }
  const remove = addClient(realm, airport, client)

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n")
      ;(res as typeof res & { flush?: () => void }).flush?.()
    } catch {
      cleanup()
    }
  }, 8_000)

  const cleanup = () => {
    clearInterval(heartbeat)
    remove()
  }

  res.on("close", cleanup)
  return cleanup
}

export function subscribeRoomWs(
  realm: string,
  airport: string,
  cid: number,
  ws: WebSocket,
): () => void {
  const client: WsClient = { kind: "ws", ws, cid }
  const remove = addClient(realm, airport, client)

  const heartbeat = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      cleanup()
      return
    }
    try {
      ws.ping()
    } catch {
      cleanup()
    }
  }, 20_000)

  const cleanup = () => {
    clearInterval(heartbeat)
    remove()
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { type?: string }
      if (msg?.type !== "reassertAssumed") return
      publishRoom(
        realm,
        airport,
        {
          type: "reassertAssumed",
          updatedAt: new Date().toISOString(),
          updatedByCid: cid,
        },
        cid,
      )
    } catch {
      // ignore malformed client messages
    }
  })
  ws.on("close", cleanup)
  ws.on("error", cleanup)
  return cleanup
}

/** Fan out to all subscribers except the publisher CID (when known). */
export function publishRoom(
  realm: string,
  airport: string,
  update: LiveUpdate,
  exceptCid?: number | null,
) {
  const set = rooms.get(roomKey(realm, airport))
  if (!set || set.size === 0) return
  const payload = JSON.stringify(update)
  const eventName =
    update.type === "meta" || update.type === "reassertAssumed" ? update.type : "scribble"
  for (const c of set) {
    if (exceptCid != null && c.cid === exceptCid) continue
    try {
      if (c.kind === "ws") {
        if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload)
      } else {
        c.res.write(`event: ${eventName}\ndata: ${payload}\n\n`)
        ;(c.res as typeof c.res & { flush?: () => void }).flush?.()
      }
    } catch {
      // client cleanup handlers remove broken sockets
    }
  }
}
