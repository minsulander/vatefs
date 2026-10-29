/**
 * Persist shared workspace Catalog to VatEFSworkspace.json (EuroScope directory).
 * Named layouts + role defaults + defaultSortFlow — not live working boards.
 */

import fs from "fs"
import path from "path"
import type { SharedSavedWorkspaceLayout, SharedWorkspaceStore, WorkspaceSortFlow } from "@vatefs/common"
import { EMPTY_SHARED_WORKSPACE_STORE } from "@vatefs/common"

let storePath: string | undefined

function emptyStore(): SharedWorkspaceStore {
    return {
        version: 1,
        userDefaults: { ...EMPTY_SHARED_WORKSPACE_STORE.userDefaults },
        layouts: [],
        defaultSortFlow: EMPTY_SHARED_WORKSPACE_STORE.defaultSortFlow,
    }
}

function isSortFlow(value: unknown): value is WorkspaceSortFlow {
    return value === "newestBottom" || value === "newestTop"
}

function normalizeSavedLayout(raw: unknown): SharedSavedWorkspaceLayout | null {
    if (!raw || typeof raw !== "object") return null
    const o = raw as Record<string, unknown>
    if (typeof o.id !== "string" || !o.id) return null
    if (typeof o.name !== "string") return null
    if (typeof o.savedAt !== "number" || !Number.isFinite(o.savedAt)) return null
    if (!o.layout || typeof o.layout !== "object") return null
    const entry: SharedSavedWorkspaceLayout = {
        id: o.id,
        name: o.name,
        savedAt: o.savedAt,
        layout: { ...(o.layout as Record<string, unknown>) },
    }
    if (typeof o.isUserDefault === "boolean") entry.isUserDefault = o.isUserDefault
    return entry
}

/** Normalize / validate a shared workspace payload (drops active* if present). */
export function normalizeSharedWorkspaceStore(raw: unknown): SharedWorkspaceStore {
    if (!raw || typeof raw !== "object") return emptyStore()
    const o = raw as Record<string, unknown>
    if (o.version !== 1) return emptyStore()

    const layouts: SharedSavedWorkspaceLayout[] = []
    if (Array.isArray(o.layouts)) {
        for (const item of o.layouts) {
            const entry = normalizeSavedLayout(item)
            if (entry) layouts.push(entry)
        }
    }

    const userDefaults: Record<string, string> = {}
    if (o.userDefaults && typeof o.userDefaults === "object") {
        for (const [key, id] of Object.entries(o.userDefaults as Record<string, unknown>)) {
            if (typeof key === "string" && key && typeof id === "string" && id) {
                userDefaults[key] = id
            }
        }
    }

    return {
        version: 1,
        layouts,
        userDefaults,
        defaultSortFlow: isSortFlow(o.defaultSortFlow) ? o.defaultSortFlow : "newestBottom",
    }
}

/**
 * Initialize the workspace store module with a writable directory.
 * Creates the directory if needed. Must be called before load/save.
 */
export function initWorkspaceStore(dir: string) {
    try {
        fs.mkdirSync(dir, { recursive: true })
    } catch {
        // Directory may already exist or be unwritable; write will report errors
    }
    storePath = path.join(dir, "VatEFSworkspace.json")
}

/**
 * Load shared workspace Catalog from disk.
 * Returns empty store if file doesn't exist or is invalid.
 */
export function loadWorkspaceStore(): SharedWorkspaceStore {
    if (!storePath) return emptyStore()
    try {
        const raw = fs.readFileSync(storePath, "utf-8")
        return normalizeSharedWorkspaceStore(JSON.parse(raw))
    } catch {
        return emptyStore()
    }
}

/**
 * Replace shared workspace Catalog on disk (full replace of shared slice).
 * Ignores any active / activeByRoleKey fields clients may send.
 */
export function saveWorkspaceStore(update: unknown): SharedWorkspaceStore {
    const normalized = normalizeSharedWorkspaceStore(update)
    if (!storePath) return normalized
    try {
        fs.writeFileSync(storePath, JSON.stringify(normalized, null, 2), "utf-8")
    } catch (err) {
        console.error(`Failed to save workspace store: ${err instanceof Error ? err.message : err}`)
    }
    return normalized
}
