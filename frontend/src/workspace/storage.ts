import type {
  SavedWorkspaceLayout,
  SortFlow,
  WorkspaceLayout,
  WorkspaceSection,
  WorkspaceStoreFile,
} from './types'
import { WORKSPACE_STORAGE_KEY, newInstanceId } from './types'
import { formatEssaRolesLabel } from './roleLabel'

function emptyStore(): WorkspaceStoreFile {
  return { version: 1, userDefaults: {}, layouts: [], defaultSortFlow: 'newestBottom' }
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
  return out
}

export function loadWorkspaceStore(): WorkspaceStoreFile {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as WorkspaceStoreFile
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.layouts)) return emptyStore()
    return {
      version: 1,
      userDefaults: parsed.userDefaults && typeof parsed.userDefaults === 'object' ? parsed.userDefaults : {},
      layouts: parsed.layouts,
      active: parsed.active ?? null,
      defaultSortFlow: parsed.defaultSortFlow === 'newestTop' ? 'newestTop' : 'newestBottom',
    }
  } catch {
    return emptyStore()
  }
}

export function saveWorkspaceStore(store: WorkspaceStoreFile): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

export function getDefaultSortFlow(): SortFlow {
  return loadWorkspaceStore().defaultSortFlow ?? 'newestBottom'
}

export function setDefaultSortFlow(flow: SortFlow): void {
  const store = loadWorkspaceStore()
  store.defaultSortFlow = flow
  saveWorkspaceStore(store)
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
  saveWorkspaceStore(store)
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
  saveWorkspaceStore(store)
}

export function deleteSavedLayout(layoutId: string): void {
  const store = loadWorkspaceStore()
  store.layouts = store.layouts.filter((l) => l.id !== layoutId)
  for (const [key, id] of Object.entries(store.userDefaults)) {
    if (id === layoutId) delete store.userDefaults[key]
  }
  saveWorkspaceStore(store)
}

export function renameSavedLayout(layoutId: string, name: string): SavedWorkspaceLayout | null {
  const store = loadWorkspaceStore()
  const entry = store.layouts.find((l) => l.id === layoutId)
  if (!entry) return null
  const trimmed = name.trim()
  if (!trimmed) return entry
  entry.name = trimmed
  entry.savedAt = Date.now()
  saveWorkspaceStore(store)
  return entry
}

export function persistActiveLayout(layout: WorkspaceLayout | null): void {
  const store = loadWorkspaceStore()
  store.active = layout ? sanitizeWorkspaceLayout(layout) : null
  saveWorkspaceStore(store)
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

  saveWorkspaceStore(store)
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
