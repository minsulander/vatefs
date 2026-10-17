/**
 * Live fanout: WebSocket (primary — works through Cloudflare tunnels) + SSE (legacy).
 */

import type { Response } from "express"
import type { WebSocket } from "ws"
import type { AirportMetaPayload, StripMeta } from "./db.js"

export type LiveUpdate =
  | {
      /** IRIS name; "scribble" accepted as legacy alias when publishing */
      type: "strip" | "scribble"
      stripKey: string
      strokes: unknown[]
      strip?: StripMeta
      updatedAt: string
      updatedByCid: number | null
      deleted?: boolean
    }
  | {
      type: "stripDeleted"
      stripKey: string
      strokes: []
      updatedAt: string
      updatedByCid: number | null
      deleted: true
    }
  | {
      type: "meta"
      meta: AirportMetaPayload
      updatedAt: string
      updatedByCid: number | null
    }
  | {
      type: "order"
      order: { revision: number; entries: unknown[] }
      updatedAt: string
      updatedByCid: number | null
    }
  | {
      type: "heartbeat"
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

/** Legacy SSE subscribe (often buffered by Cloudflare quick tunnels). */
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

/** WebSocket subscribe — preferred path through tunnels. */
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

  ws.on("close", cleanup)
  ws.on("error", cleanup)
  return cleanup
}

export function publishRoom(realm: string, airport: string, update: LiveUpdate, exceptCid?: number) {
  const set = rooms.get(roomKey(realm, airport))
  if (!set?.size) return
  const eventName =
    update.type === "meta" ||
    update.type === "order" ||
    update.type === "heartbeat" ||
    update.type === "stripDeleted"
      ? update.type
      : update.type === "strip"
        ? "strip"
        : "strip"
  const ssePayload = `event: ${eventName}\ndata: ${JSON.stringify(update)}\n\n`
  const wsPayload = JSON.stringify(update)
  for (const client of [...set]) {
    if (exceptCid != null && client.cid === exceptCid) continue
    try {
      if (client.kind === "sse") {
        client.res.write(ssePayload)
        ;(client.res as typeof client.res & { flush?: () => void }).flush?.()
      } else if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(wsPayload)
      } else {
        set.delete(client)
      }
    } catch {
      set.delete(client)
    }
  }
}
