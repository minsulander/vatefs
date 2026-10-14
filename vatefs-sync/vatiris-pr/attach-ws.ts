/**
 * Attach `/efs/sync/:realm/:airport/ws` upgrade handler to an http.Server.
 *
 *   import { createScribbleRouter, attachEfsSyncWebSocket } from './efs-sync'
 *   const server = http.createServer(app)
 *   attachEfsSyncWebSocket(server, { userExists })
 */

import type { IncomingMessage, Server } from "http"
import type { Duplex } from "stream"
import { WebSocketServer } from "ws"
import { subscribeRoomWs } from "./live.js"

export type AttachWsDeps = {
  /** Same auth as REST: CID must exist in useraccount. */
  userExists: (cid: number) => boolean | Promise<boolean>
  /** Path prefix before `/sync/.../ws` (default `/efs`). */
  basePath?: string
}

const REALMS = new Set(["live", "sweatbox", "playback", "local"])

function parseCid(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const cid = Number(String(raw).trim())
  if (!Number.isInteger(cid) || cid <= 0) return null
  return cid
}

export function attachEfsSyncWebSocket(server: Server, deps: AttachWsDeps): WebSocketServer {
  const base = (deps.basePath || "/efs").replace(/\/+$/, "")
  const pathRe = new RegExp(
    `^${base.replace(/\//g, "\\/")}\\/sync\\/([^/]+)\\/([^/]+)\\/ws\\/?$`,
    "i",
  )
  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      try {
        const host = req.headers.host || "127.0.0.1"
        const url = new URL(req.url || "/", `http://${host}`)
        const m = url.pathname.match(pathRe)
        if (!m) return // other upgrade handlers may own the path

        const realm = m[1]!.toLowerCase()
        const airport = m[2]!.toUpperCase()
        if (!REALMS.has(realm) || !/^[A-Z0-9]{3,4}$/.test(airport)) {
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
          socket.destroy()
          return
        }

        const cid =
          parseCid(url.searchParams.get("cid")) ??
          parseCid((req.headers["x-vatsim-cid"] as string | undefined) ?? null)
        if (cid == null) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
          socket.destroy()
          return
        }

        const ok = await deps.userExists(cid)
        if (!ok) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
          socket.destroy()
          return
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          subscribeRoomWs(realm, airport, cid, ws)
          ws.send(JSON.stringify({ type: "hello", realm, airport, cid }))
        })
      } catch {
        try {
          socket.destroy()
        } catch {
          // ignore
        }
      }
    })()
  })

  return wss
}
