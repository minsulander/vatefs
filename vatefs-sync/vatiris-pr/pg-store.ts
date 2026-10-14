/**
 * Postgres ScribbleStore for VatIRIS (`efs_scribble` — see migration.sql).
 *
 *   import { createPgScribbleStore } from './efs-sync/pg-store'
 *   const store = createPgScribbleStore(pool)
 */

import type { Pool } from "pg"
import type { AirportMetaPayload, ScribbleStore, StripMeta } from "./routes.js"

function mergeStripMeta(prev: StripMeta | null, incoming: StripMeta | null): StripMeta | null {
  if (!incoming) return prev
  if (!prev) return incoming
  const out: StripMeta = { ...prev, ...incoming }
  if (!("qnhGiven" in incoming)) out.qnhGiven = prev.qnhGiven
  if (!("atisGiven" in incoming)) out.atisGiven = prev.atisGiven
  if (!("clearanceRead" in incoming)) out.clearanceRead = prev.clearanceRead
  if (!("noteText" in incoming)) out.noteText = prev.noteText
  if (!("std" in incoming)) out.std = prev.std
  return out
}

type Row = {
  strip_key: string
  strokes: unknown
  strip_meta: StripMeta | null
  updated_at: Date | string
  updated_by_cid: string | number | null
}

function mapRow(r: Row) {
  const updatedAt =
    r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
  const cid =
    r.updated_by_cid == null
      ? null
      : typeof r.updated_by_cid === "number"
        ? r.updated_by_cid
        : Number(r.updated_by_cid)
  return {
    stripKey: r.strip_key,
    strokes: Array.isArray(r.strokes) ? r.strokes : [],
    stripMeta: r.strip_meta && typeof r.strip_meta === "object" ? r.strip_meta : null,
    updatedAt,
    updatedByCid: Number.isFinite(cid) ? (cid as number) : null,
  }
}

export function createPgScribbleStore(pool: Pool): ScribbleStore {
  return {
    async listSince(realm, airport, since) {
      const params: unknown[] = [realm, airport]
      let sql = `
        SELECT strip_key, strokes, strip_meta, updated_at, updated_by_cid
        FROM efs_scribble
        WHERE realm = $1 AND airport = $2`
      if (since) {
        params.push(since)
        sql += ` AND updated_at > $3::timestamptz`
      }
      sql += ` ORDER BY updated_at ASC`
      const { rows } = await pool.query(sql, params)
      return (rows as Row[]).map(mapRow)
    },

    async upsert(realm, airport, stripKey, strokes, stripMeta, cid) {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const prevRes = await client.query(
          `SELECT strokes, strip_meta FROM efs_scribble
           WHERE realm = $1 AND airport = $2 AND strip_key = $3
           FOR UPDATE`,
          [realm, airport, stripKey],
        )
        const prev = prevRes.rows[0] as
          | { strokes: unknown; strip_meta: StripMeta | null }
          | undefined
        const nextStrokes =
          strokes !== undefined
            ? strokes
            : Array.isArray(prev?.strokes)
              ? prev!.strokes
              : []
        const nextMeta =
          stripMeta !== undefined
            ? mergeStripMeta(prev?.strip_meta ?? null, stripMeta)
            : (prev?.strip_meta ?? null)

        const { rows } = await client.query(
          `INSERT INTO efs_scribble (realm, airport, strip_key, strokes, strip_meta, updated_at, updated_by_cid)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW(), $6)
           ON CONFLICT (realm, airport, strip_key) DO UPDATE SET
             strokes = EXCLUDED.strokes,
             strip_meta = EXCLUDED.strip_meta,
             updated_at = EXCLUDED.updated_at,
             updated_by_cid = EXCLUDED.updated_by_cid
           RETURNING strip_key, strokes, strip_meta, updated_at, updated_by_cid`,
          [
            realm,
            airport,
            stripKey,
            JSON.stringify(nextStrokes),
            nextMeta == null ? null : JSON.stringify(nextMeta),
            cid,
          ],
        )
        await client.query("COMMIT")
        return mapRow(rows[0] as Row)
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      } finally {
        client.release()
      }
    },

    async remove(realm, airport, stripKey, cid) {
      // Soft-clear: empty strokes + null meta (matches closed-beta DELETE semantics)
      await this.upsert(realm, airport, stripKey, [], null, cid)
    },

    async getAirportMeta(realm, airport) {
      const { rows } = await pool.query(
        `SELECT meta, updated_at, updated_by_cid
         FROM efs_airport_meta
         WHERE realm = $1 AND airport = $2`,
        [realm, airport],
      )
      const r = rows[0] as
        | { meta: AirportMetaPayload; updated_at: Date | string; updated_by_cid: string | number | null }
        | undefined
      if (!r) return null
      const updatedAt =
        r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
      const cid =
        r.updated_by_cid == null
          ? null
          : typeof r.updated_by_cid === "number"
            ? r.updated_by_cid
            : Number(r.updated_by_cid)
      return {
        meta: r.meta && typeof r.meta === "object" ? r.meta : {},
        updatedAt,
        updatedByCid: Number.isFinite(cid) ? (cid as number) : null,
      }
    },

    async upsertAirportMeta(realm, airport, meta, cid) {
      const { rows } = await pool.query(
        `INSERT INTO efs_airport_meta (realm, airport, meta, updated_at, updated_by_cid)
         VALUES ($1, $2, $3::jsonb, NOW(), $4)
         ON CONFLICT (realm, airport) DO UPDATE SET
           meta = EXCLUDED.meta,
           updated_at = EXCLUDED.updated_at,
           updated_by_cid = EXCLUDED.updated_by_cid
         RETURNING meta, updated_at, updated_by_cid`,
        [realm, airport, JSON.stringify(meta), cid],
      )
      const r = rows[0] as {
        meta: AirportMetaPayload
        updated_at: Date | string
        updated_by_cid: string | number | null
      }
      const updatedAt =
        r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
      const outCid =
        r.updated_by_cid == null
          ? null
          : typeof r.updated_by_cid === "number"
            ? r.updated_by_cid
            : Number(r.updated_by_cid)
      return {
        meta: r.meta && typeof r.meta === "object" ? r.meta : meta,
        updatedAt,
        updatedByCid: Number.isFinite(outCid) ? (outCid as number) : null,
      }
    },
  }
}

/** Optional hourly TTL purge — call from a cron / setInterval. */
export async function purgeExpiredScribbles(pool: Pool, olderThanHours = 1): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM efs_scribble WHERE updated_at < NOW() - ($1::text || ' hours')::interval`,
    [String(olderThanHours)],
  )
  return rowCount ?? 0
}

export async function purgeExpiredAirportMeta(pool: Pool, olderThanHours = 1): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM efs_airport_meta WHERE updated_at < NOW() - ($1::text || ' hours')::interval`,
    [String(olderThanHours)],
  )
  return rowCount ?? 0
}
