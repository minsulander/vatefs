import type { Request, Response, NextFunction } from "express"

/** Comma-separated CIDs; empty = allow any positive integer CID (dev only). */
function parseAllowlist(): Set<number> | null {
  const raw = process.env.ALLOWED_CIDS?.trim()
  if (!raw) return null
  const set = new Set<number>()
  for (const part of raw.split(",")) {
    const n = Number(part.trim())
    if (Number.isInteger(n) && n > 0) set.add(n)
  }
  return set
}

const allowlist = parseAllowlist()

export function requireCid(req: Request, res: Response, next: NextFunction) {
  const header = req.header("x-vatsim-cid") || req.header("X-Vatsim-Cid")
  const q = typeof req.query.cid === "string" ? req.query.cid : undefined
  const bodyCid =
    req.body && typeof req.body === "object" && "cid" in req.body
      ? (req.body as { cid?: unknown }).cid
      : undefined
  const raw = header || q || (bodyCid != null ? String(bodyCid) : undefined)
  const cid = raw != null ? Number(String(raw).trim()) : NaN
  if (!Number.isInteger(cid) || cid <= 0) {
    res.status(401).json({ error: "Missing or invalid X-Vatsim-Cid" })
    return
  }
  if (allowlist && !allowlist.has(cid)) {
    res.status(403).json({
      error: "CID not on allowlist (log in / ask beta host to add your CID)",
    })
    return
  }
  ;(req as Request & { cid: number }).cid = cid
  next()
}

export function getCid(req: Request): number {
  return (req as Request & { cid: number }).cid
}

/** Simple per-CID sliding window rate limit. */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<number, number[]>()
  return (req: Request, res: Response, next: NextFunction) => {
    const cid = getCid(req)
    const now = Date.now()
    const arr = (hits.get(cid) || []).filter((t) => now - t < opts.windowMs)
    if (arr.length >= opts.max) {
      res.status(429).json({ error: "Rate limit exceeded" })
      return
    }
    arr.push(now)
    hits.set(cid, arr)
    next()
  }
}

export function authModeSummary(): string {
  if (!allowlist) return "any positive CID (ALLOWED_CIDS unset)"
  return `allowlist (${allowlist.size} CID(s))`
}
