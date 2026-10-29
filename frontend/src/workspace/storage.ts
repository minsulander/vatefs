import { shallowRef } from 'vue'
import type { SharedWorkspaceStore } from '@vatefs/common'
import type {
  SavedWorkspaceLayout,
  SortFlow,
  WorkspaceLayout,
  WorkspaceSection,
  WorkspaceStoreFile,
} from './types'
import { WORKSPACE_STORAGE_KEY, newInstanceId } from './types'
import { formatEssaRolesLabel } from './roleLabel'
import { isDtransVariantId } from './dtrans'

/** Bumped when shared Catalog changes (server push or local mutate) — for Vue computeds. */
export const workspaceSharedRevision = shallowRef(0)

function emptyShared(): SharedWorkspaceStore {
  return { version: 1, userDefaults: {}, layouts: [], defaultSortFlow: 'newestBottom' }
}

function emptyActive(): Pick<WorkspaceStoreFile, 'active' | 'activeByRoleKey'> {
  return { active: null, activeByRoleKey: {} }
}

/** Server-backed Catalog mirror (named layouts + defaults). */
let sharedMirror: SharedWorkspaceStore = emptyShared()
/** True after first `workspaceStore` from backend (or after offline legacy hydrate). */
let sharedFromServer = false
let migrateAttempted = false
let pushShared: ((store: SharedWorkspaceStore) => void) | null = null

function bumpSharedRevision() {
  workspaceSharedRevision.value++
}

function cloneShared(store: SharedWorkspaceStore): SharedWorkspaceStore {
  return {
    version: 1,
    userDefaults: { ...store.userDefaults },
    layouts: store.layouts.map((l) => ({
      ...l,
      layout: { ...l.layout },
      isUserDefault: l.isUserDefault,
    })),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
}

function sharedPayload(): SharedWorkspaceStore {
  return cloneShared(sharedMirror)
}

function asSavedLayouts(layouts: SharedWorkspaceStore['layouts']): SavedWorkspaceLayout[] {
  return layouts.map((l) => ({
    id: l.id,
    name: l.name,
    savedAt: l.savedAt,
    layout: sanitizeWorkspaceLayout(l.layout as unknown as WorkspaceLayout),
    isUserDefault: l.isUserDefault,
  }))
}

function toSharedLayouts(layouts: SavedWorkspaceLayout[]): SharedWorkspaceStore['layouts'] {
  return layouts.map((l) => ({
    id: l.id,
    name: l.name,
    savedAt: l.savedAt,
    layout: sanitizeWorkspaceLayout(l.layout) as unknown as Record<string, unknown>,
    isUserDefault: l.isUserDefault,
  }))
}

/** Register WebSocket push for shared Catalog writes. */
export function bindWorkspaceSharedPush(push: (store: SharedWorkspaceStore) => void): void {
  pushShared = push
}

function persistSharedToServer(): void {
  bumpSharedRevision()
  pushShared?.(sharedPayload())
}

/**
 * Apply install-shared Catalog from the backend.
 * One-shot migrates browser localStorage layouts when the server file is empty.
 */
export function applyServerWorkspaceStore(store: SharedWorkspaceStore): void {
  const incoming: SharedWorkspaceStore = {
    version: 1,
    userDefaults:
      store.userDefaults && typeof store.userDefaults === 'object' ? { ...store.userDefaults } : {},
    layouts: Array.isArray(store.layouts) ? [...store.layouts] : [],
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }

  sharedFromServer = true

  if (!migrateAttempted) {
    migrateAttempted = true
    const legacy = readLegacyLocalStore()
    // Always peel active boards into the local-only slice.
    persistLocalActive({
      active: legacy.active ?? null,
      activeByRoleKey: normalizeActiveByRoleKey(legacy.activeByRoleKey, legacy.active ?? null),
    })
    stripLegacySharedFromLocalStorage()

    if (incoming.layouts.length === 0 && legacy.layouts.length > 0) {
      sharedMirror = {
        version: 1,
        layouts: toSharedLayouts(legacy.layouts),
        userDefaults: { ...legacy.userDefaults },
        defaultSortFlow: legacy.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
      }
      bumpSharedRevision()
      pushShared?.(sharedPayload())
      return
    }
  }

  sharedMirror = incoming
  bumpSharedRevision()
}

/**
 * Named/active layouts store only bay count + section dividers.
 * Info strips (Breakout/MAP/DEP/…) live in separate localStorage and must never
 * be snapshotted into workspace layout JSON.
 */
export function sanitizeWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const mapped: WorkspaceSection[] = layout.sections.map((s) => {
    const out: WorkspaceSection = {
      instanceId: s.instanceId,
      sectionId: s.sectionId,
      anchorColumn: s.anchorColumn,
      stripSize: s.stripSize,
      sortFlow: s.sortFlow,
    }
    if (s.title != null) out.title = s.title
    if (s.groupId != null) out.groupId = s.groupId
    if (s.member != null) out.member = s.member
    if (s.members?.length) out.members = [...s.members]
    if (s.y != null) out.y = s.y
    if (s.yRatio != null) out.yRatio = s.yRatio
    if (s.height != null) out.height = s.height
    if (s.dtrans != null && isDtransVariantId(s.dtrans)) out.dtrans = s.dtrans
    return out
  })

  // One workspace header per logical sectionId (empty blockers keep unique instanceIds).
  // Stops duplicate CD / INBOUND APP from older catalog bugs or corrupt saves.
  const seenIds = new Set<string>()
  const sections: WorkspaceSection[] = []
  for (const s of mapped) {
    if (s.sectionId) {
      if (seenIds.has(s.sectionId)) continue
      seenIds.add(s.sectionId)
    }
    sections.push(s)
  }

  // ESSA: "CD ALL" only when CD is merged with TSAT / EOBT. Standalone pending → "CD".
  // Also retag standalone TSAT / EOBT as cd_all.cleared so it can merge with CD.
  const hasSeparateCleared = sections.some((s) => {
    if (s.sectionId !== 'cleared' && s.sectionId !== 'cleared_tsat' && s.sectionId !== 'cleared_eobt') {
      return false
    }
    const t = (s.title || '').toUpperCase().trim()
    return t !== 'CD ALL' && t !== 'CDALL'
  })
  for (const s of sections) {
    if (
      s.sectionId === 'cleared' &&
      (s.groupId === 'cd_cleared' || !s.groupId) &&
      !s.member &&
      !s.members?.length
    ) {
      const t = (s.title || '').toUpperCase().trim()
      if (t === 'TSAT / EOBT' || t === 'TSAT/EOBT' || t === 'TSAT' || !s.title) {
        s.groupId = 'cd_all'
        s.member = 'cleared'
        if (!s.title || t === 'TSAT') s.title = 'TSAT / EOBT'
      }
    }
    if (s.sectionId !== 'pending_dep' && s.groupId !== 'cd_all') continue
    const t = (s.title || '').toUpperCase().trim()
    if (s.member === 'pending') {
      if (t === 'CD ALL' || t === 'CDALL' || !s.title) s.title = 'CD'
      continue
    }
    // Wrongly tagged as full merge (no member) while TSAT / EOBT is a separate header
    if (
      !s.member &&
      !s.members?.length &&
      (t === 'CD ALL' || t === 'CDALL') &&
      hasSeparateCleared
    ) {
      s.member = 'pending'
      s.groupId = 'cd_all'
      s.title = 'CD'
    }
  }

  const out: WorkspaceLayout = {
    version: 1,
    columnCount: Math.max(1, Math.round(layout.columnCount) || 1),
    sections,
    roleKey: layout.roleKey || '',
    roles: [...(layout.roles || [])],
  }
  if (layout.rolesLabel) out.rolesLabel = layout.rolesLabel
  if (layout.sourceLabel?.trim()) out.sourceLabel = layout.sourceLabel.trim()
  if (layout.sourceSavedId?.trim()) out.sourceSavedId = layout.sourceSavedId.trim()
  return out
}

function normalizeActiveByRoleKey(
  raw: unknown,
  legacyActive: WorkspaceLayout | null | undefined,
): Record<string, WorkspaceLayout> {
  const out: Record<string, WorkspaceLayout> = {}
  if (raw && typeof raw === 'object') {
    for (const [key, layout] of Object.entries(raw as Record<string, unknown>)) {
      if (!key || !layout || typeof layout !== 'object') continue
      const cleaned = sanitizeWorkspaceLayout(layout as WorkspaceLayout)
      if (cleaned.roleKey) out[cleaned.roleKey] = cleaned
      else out[key] = { ...cleaned, roleKey: key }
    }
  }
  // Migrate legacy single `active` into the per-role map once.
  if (legacyActive && typeof legacyActive === 'object') {
    const cleaned = sanitizeWorkspaceLayout(legacyActive)
    const key = cleaned.roleKey
    if (key && !out[key]) out[key] = cleaned
  }
  return out
}

function readLegacyLocalStore(): WorkspaceStoreFile {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return { version: 1, userDefaults: {}, layouts: [], ...emptyActive() }
    const parsed = JSON.parse(raw) as WorkspaceStoreFile
    if (!parsed || parsed.version !== 1) {
      return { version: 1, userDefaults: {}, layouts: [], ...emptyActive() }
    }
    const active = parsed.active ?? null
    return {
      version: 1,
      userDefaults: parsed.userDefaults && typeof parsed.userDefaults === 'object' ? parsed.userDefaults : {},
      layouts: Array.isArray(parsed.layouts) ? parsed.layouts : [],
      active,
      activeByRoleKey: normalizeActiveByRoleKey(parsed.activeByRoleKey, active),
      defaultSortFlow: parsed.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
    }
  } catch {
    return { version: 1, userDefaults: {}, layouts: [], ...emptyActive() }
  }
}

function loadLocalActive(): Pick<WorkspaceStoreFile, 'active' | 'activeByRoleKey'> {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return emptyActive()
    const parsed = JSON.parse(raw) as WorkspaceStoreFile
    if (!parsed || parsed.version !== 1) return emptyActive()
    const active = parsed.active ?? null
    return {
      active,
      activeByRoleKey: normalizeActiveByRoleKey(parsed.activeByRoleKey, active),
    }
  } catch {
    return emptyActive()
  }
}

function persistLocalActive(active: Pick<WorkspaceStoreFile, 'active' | 'activeByRoleKey'>): void {
  try {
    const payload: WorkspaceStoreFile = {
      version: 1,
      userDefaults: {},
      layouts: [],
      active: active.active ?? null,
      activeByRoleKey: active.activeByRoleKey ?? {},
    }
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

/** After migrate: drop shared fields from localStorage so Catalog isn't dual-sourced. */
function stripLegacySharedFromLocalStorage(): void {
  const active = loadLocalActive()
  persistLocalActive(active)
}

/**
 * Combined view: shared Catalog (+ optional legacy until server sync) + local active boards.
 */
export function loadWorkspaceStore(): WorkspaceStoreFile {
  const active = loadLocalActive()
  if (!sharedFromServer) {
    const legacy = readLegacyLocalStore()
    return {
      version: 1,
      userDefaults: legacy.userDefaults,
      layouts: legacy.layouts,
      defaultSortFlow: legacy.defaultSortFlow,
      active: active.active ?? legacy.active ?? null,
      activeByRoleKey: {
        ...normalizeActiveByRoleKey(legacy.activeByRoleKey, legacy.active ?? null),
        ...(active.activeByRoleKey ?? {}),
      },
    }
  }
  return {
    version: 1,
    userDefaults: { ...sharedMirror.userDefaults },
    layouts: asSavedLayouts(sharedMirror.layouts),
    defaultSortFlow: sharedMirror.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
    active: active.active ?? null,
    activeByRoleKey: active.activeByRoleKey ?? {},
  }
}

/** @deprecated Prefer mutating helpers that push shared or persist local active. */
export function saveWorkspaceStore(store: WorkspaceStoreFile): void {
  sharedMirror = {
    version: 1,
    userDefaults: { ...(store.userDefaults ?? {}) },
    layouts: toSharedLayouts(store.layouts ?? []),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
  persistLocalActive({
    active: store.active ?? null,
    activeByRoleKey: store.activeByRoleKey ?? {},
  })
  if (sharedFromServer) persistSharedToServer()
  else bumpSharedRevision()
}

export function getDefaultSortFlow(): SortFlow {
  return loadWorkspaceStore().defaultSortFlow ?? 'newestBottom'
}

export function setDefaultSortFlow(flow: SortFlow): void {
  const store = loadWorkspaceStore()
  store.defaultSortFlow = flow
  sharedMirror.defaultSortFlow = flow
  if (sharedFromServer) persistSharedToServer()
  else {
    // Pre-connect: keep in legacy blob so migrate uploads it
    try {
      const legacy = readLegacyLocalStore()
      legacy.defaultSortFlow = flow
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(legacy))
    } catch {
      /* ignore */
    }
    bumpSharedRevision()
  }
}

export function listSavedLayouts(roleKey?: string): SavedWorkspaceLayout[] {
  const store = loadWorkspaceStore()
  const list = store.layouts
  if (!roleKey) return [...list].sort((a, b) => b.savedAt - a.savedAt)
  return list
    .filter((l) => l.layout.roleKey === roleKey)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function getUserDefaultLayoutId(roleKey: string): string | undefined {
  return loadWorkspaceStore().userDefaults[roleKey]
}

export function saveNamedLayout(name: string, layout: WorkspaceLayout): SavedWorkspaceLayout {
  const store = loadWorkspaceStore()
  const cleaned = sanitizeWorkspaceLayout(layout)
  const entry: SavedWorkspaceLayout = {
    id: newInstanceId('layout'),
    name: name.trim() || 'Untitled',
    savedAt: Date.now(),
    layout: {
      ...cleaned,
      rolesLabel: cleaned.rolesLabel || formatEssaRolesLabel(cleaned.roles),
    },
  }
  store.layouts.push(entry)
  sharedMirror = {
    version: 1,
    userDefaults: { ...store.userDefaults },
    layouts: toSharedLayouts(store.layouts),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
  if (sharedFromServer) persistSharedToServer()
  else {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    bumpSharedRevision()
  }
  return entry
}

export function setUserDefaultLayout(roleKey: string, layoutId: string | null): void {
  const store = loadWorkspaceStore()
  if (!layoutId) {
    delete store.userDefaults[roleKey]
  } else {
    store.userDefaults[roleKey] = layoutId
  }
  for (const l of store.layouts) {
    if (l.layout.roleKey === roleKey) {
      l.isUserDefault = l.id === layoutId
    }
  }
  sharedMirror = {
    version: 1,
    userDefaults: { ...store.userDefaults },
    layouts: toSharedLayouts(store.layouts),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
  if (sharedFromServer) persistSharedToServer()
  else {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    bumpSharedRevision()
  }
}

export function deleteSavedLayout(layoutId: string): void {
  const store = loadWorkspaceStore()
  store.layouts = store.layouts.filter((l) => l.id !== layoutId)
  for (const [key, id] of Object.entries(store.userDefaults)) {
    if (id === layoutId) delete store.userDefaults[key]
  }
  sharedMirror = {
    version: 1,
    userDefaults: { ...store.userDefaults },
    layouts: toSharedLayouts(store.layouts),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
  if (sharedFromServer) persistSharedToServer()
  else {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    bumpSharedRevision()
  }
}

export function renameSavedLayout(layoutId: string, name: string): SavedWorkspaceLayout | null {
  const store = loadWorkspaceStore()
  const entry = store.layouts.find((l) => l.id === layoutId)
  if (!entry) return null
  const trimmed = name.trim()
  if (!trimmed) return entry
  entry.name = trimmed
  entry.savedAt = Date.now()
  sharedMirror = {
    version: 1,
    userDefaults: { ...store.userDefaults },
    layouts: toSharedLayouts(store.layouts),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
  if (sharedFromServer) persistSharedToServer()
  else {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    bumpSharedRevision()
  }
  return entry
}

export function persistActiveLayout(layout: WorkspaceLayout | null): void {
  const active = loadLocalActive()
  if (!layout) {
    persistLocalActive({ active: null, activeByRoleKey: active.activeByRoleKey ?? {} })
    return
  }
  const cleaned = sanitizeWorkspaceLayout(layout)
  const byRole = { ...(active.activeByRoleKey ?? {}) }
  if (cleaned.roleKey) byRole[cleaned.roleKey] = cleaned
  persistLocalActive({ active: cleaned, activeByRoleKey: byRole })
}

/** Last working board for this ESSA role key / SAAB profile (`saab:1rwy4`, …). */
export function loadActiveLayoutForRole(roleKey: string): WorkspaceLayout | null {
  if (!roleKey) return null
  const store = loadWorkspaceStore()
  const byRole = store.activeByRoleKey?.[roleKey]
  if (byRole) return sanitizeWorkspaceLayout(byRole)
  if (store.active?.roleKey === roleKey) return sanitizeWorkspaceLayout(store.active)
  return null
}

/**
 * Display name for Catalog → Layout / ESSA folders dialog.
 * Prefer persisted sourceLabel; else resolve saved id; else DEFAULT.
 */
export function resolveLoadedLayoutLabel(
  layout: WorkspaceLayout | null | undefined,
): string {
  if (!layout) return ''
  const labeled = layout.sourceLabel?.trim()
  if (labeled) return labeled
  const savedId = layout.sourceSavedId?.trim()
  if (savedId) {
    const entry = listSavedLayouts().find((l) => l.id === savedId)
    if (entry?.name?.trim()) return entry.name.trim()
  }
  // ESSA / OTHER working boards without a stamp → delivered DEFAULT
  return 'DEFAULT'
}

/** Ensure sourceLabel is set (backfill older persisted boards). */
export function withLoadedLayoutLabel(layout: WorkspaceLayout): WorkspaceLayout {
  const label = resolveLoadedLayoutLabel(layout)
  if (layout.sourceLabel?.trim() === label) return layout
  return sanitizeWorkspaceLayout({ ...layout, sourceLabel: label })
}

/** Drop all working boards (e.g. YAML config file changed). */
export function clearActiveLayouts(): void {
  persistLocalActive({ active: null, activeByRoleKey: {} })
}

export interface LayoutExportFile {
  type: 'vatefs-essa-workspace'
  version: 1
  exportedAt: number
  layouts: SavedWorkspaceLayout[]
}

export function buildExportPayload(layoutIds?: string[]): LayoutExportFile {
  const store = loadWorkspaceStore()
  const layouts = (layoutIds?.length
    ? store.layouts.filter((l) => layoutIds.includes(l.id))
    : [...store.layouts]
  ).map((l) => ({
    ...l,
    layout: sanitizeWorkspaceLayout(l.layout),
  }))
  return {
    type: 'vatefs-essa-workspace',
    version: 1,
    exportedAt: Date.now(),
    layouts,
  }
}

export function parseImportPayload(raw: unknown): SavedWorkspaceLayout[] {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid file')
  const obj = raw as Record<string, unknown>
  if (obj.type !== 'vatefs-essa-workspace') throw new Error('Not a VatEFS workspace export')
  if (obj.version !== 1) throw new Error(`Unsupported export version: ${String(obj.version)}`)
  if (!Array.isArray(obj.layouts)) throw new Error('Missing layouts array')
  return obj.layouts.filter(
    (l): l is SavedWorkspaceLayout =>
      !!l &&
      typeof l === 'object' &&
      typeof (l as SavedWorkspaceLayout).id === 'string' &&
      typeof (l as SavedWorkspaceLayout).name === 'string' &&
      !!(l as SavedWorkspaceLayout).layout &&
      (l as SavedWorkspaceLayout).layout.version === 1,
  )
}

export type ImportConflictMode = 'replace' | 'keepBoth' | 'skip'

export function mergeImportedLayouts(
  imported: SavedWorkspaceLayout[],
  mode: ImportConflictMode,
): { added: number; replaced: number; skipped: number } {
  const store = loadWorkspaceStore()
  let added = 0
  let replaced = 0
  let skipped = 0

  for (const item of imported) {
    const existingIdx = store.layouts.findIndex(
      (l) => l.name === item.name && l.layout.roleKey === item.layout.roleKey,
    )
    const cleaned = sanitizeWorkspaceLayout(item.layout)
    const existing = existingIdx >= 0 ? store.layouts[existingIdx] : undefined
    const normalized: SavedWorkspaceLayout = {
      ...item,
      id: mode === 'keepBoth' || !existing ? newInstanceId('layout') : existing.id,
      savedAt: Date.now(),
      layout: {
        ...cleaned,
        rolesLabel: cleaned.rolesLabel || formatEssaRolesLabel(cleaned.roles || []),
      },
      isUserDefault: false,
    }

    if (existingIdx >= 0) {
      if (mode === 'skip') {
        skipped++
        continue
      }
      if (mode === 'replace') {
        store.layouts[existingIdx] = normalized
        replaced++
        continue
      }
      // keepBoth
      normalized.name = `${item.name} (import)`
      normalized.id = newInstanceId('layout')
    }
    store.layouts.push(normalized)
    added++
  }

  sharedMirror = {
    version: 1,
    userDefaults: { ...store.userDefaults },
    layouts: toSharedLayouts(store.layouts),
    defaultSortFlow: store.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
  }
  if (sharedFromServer) persistSharedToServer()
  else {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    bumpSharedRevision()
  }
  return { added, replaced, skipped }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
