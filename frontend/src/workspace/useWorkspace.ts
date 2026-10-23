import { computed, ref, watch, type Ref } from 'vue'
import type { Bay, EfsLayout, Section } from '@vatefs/common'
import {
  ESSA_PHYSICAL_RWY_PAIRS,
  essaRunwaySectionId,
  formatEssaRunwaySectionTitle,
  isEssaDynamicRunwaySectionId,
} from '@vatefs/common'
import { useEfsStore } from '@/store/efs'
import type {
  SectionStripSize,
  SortFlow,
  WorkspaceLayout,
  WorkspaceSection,
} from './types'
import {
  WORKSPACE_HEADER_H,
  WORKSPACE_MAX_COLUMNS,
  WORKSPACE_MIN_COLUMNS,
  WORKSPACE_MIN_SECTION_H,
  newInstanceId,
} from './types'
import { ESSA_CATALOG_SECTIONS } from './catalog'
import {
  annotateCatalogSection,
  buildDefaultWorkspaceLayout,
  serverBayIdForSection,
} from './defaultLayout'
import { essaRoleKey, formatEssaRolesLabel } from './roleLabel'
import {
  canMergeSection,
  canSplitSection,
  closeOrMergeOnX,
  mergeWorkspaceMembers,
  splitWorkspaceSection,
} from './splitGroups'
import {
  getDefaultSortFlow,
  listSavedLayouts,
  persistActiveLayout,
  sanitizeWorkspaceLayout,
  setDefaultSortFlow as persistDefaultSortFlow,
} from './storage'
import {
  measureBayScale,
  measurePinnedChromePx,
  packWorkspaceOverflow,
  type OverflowHostPlan,
  type OverflowPackResult,
  type SectionOverflowPlan,
} from './overflow'

/**
 * ESSA flexible workspace state (client-only).
 * Activated when essaRolesMode is true; ignored for paper/RTC.
 * Kept on globalThis so Vite HMR cannot split singletons across modules.
 */
type WorkspaceModuleState = {
  activeLayout: Ref<WorkspaceLayout | null>
  layoutDialogOpen: Ref<boolean>
  layoutDialogReason: Ref<'role-change' | 'menu'>
  searchDialogOpen: Ref<boolean>
  pendingRoleKey: Ref<string>
  closedSectionIds: Ref<Set<string>>
  /** Runway headers the user added from catalog (kept even when not in ES config). */
  manuallyAddedRunwayIds: Ref<Set<string>>
  draggingSectionId: Ref<string | null>
  lastRoleKey: string
  layoutPromptConfirmedFor: string
}

const g = globalThis as typeof globalThis & { __vatefsWorkspaceState?: WorkspaceModuleState }

function getState(): WorkspaceModuleState {
  if (!g.__vatefsWorkspaceState) {
    g.__vatefsWorkspaceState = {
      activeLayout: ref<WorkspaceLayout | null>(null),
      layoutDialogOpen: ref(false),
      layoutDialogReason: ref<'role-change' | 'menu'>('menu'),
      searchDialogOpen: ref(false),
      pendingRoleKey: ref(''),
      closedSectionIds: ref(new Set()),
      manuallyAddedRunwayIds: ref(new Set()),
      draggingSectionId: ref(null),
      lastRoleKey: '',
      layoutPromptConfirmedFor: '',
    }
  } else if (!g.__vatefsWorkspaceState.manuallyAddedRunwayIds) {
    // HMR / older singleton shape
    g.__vatefsWorkspaceState.manuallyAddedRunwayIds = ref(new Set())
  }
  return g.__vatefsWorkspaceState
}

const state = getState()
const activeLayout = state.activeLayout
const layoutDialogOpen = state.layoutDialogOpen
const layoutDialogReason = state.layoutDialogReason
const searchDialogOpen = state.searchDialogOpen
const pendingRoleKey = state.pendingRoleKey
const closedSectionIds = state.closedSectionIds
const manuallyAddedRunwayIds = state.manuallyAddedRunwayIds
const draggingSectionId = state.draggingSectionId

/** Bay-body heights from ResizeObserver (overflow capacity). */
const columnBodyHeightByCol = ref<Record<number, number>>({})
/** Visual top-strip order reported by each primary EfsSection. */
const sectionTopOrderByInstance = ref<Record<string, string[]>>({})
/** Latest continuous-overflow pack. */
const overflowPack = ref<OverflowPackResult>({ byInstance: {}, byHostColumn: {} })
let overflowRepackRaf = 0

function listServerRunwaySections(serverLayout: EfsLayout): Section[] {
  const out: Section[] = []
  for (const bay of serverLayout.bays) {
    for (const sec of bay.sections) {
      if (isEssaDynamicRunwaySectionId(sec.id)) out.push(sec)
    }
  }
  return out
}

function serverBayIndexForSection(serverLayout: EfsLayout, sectionId: string): number {
  return serverLayout.bays.findIndex((b) => b.sections.some((s) => s.id === sectionId))
}

function preferredRunwayColumn(layout: WorkspaceLayout, serverLayout: EfsLayout, sectionId: string): number {
  const bayIdx = serverBayIndexForSection(serverLayout, sectionId)
  if (bayIdx >= 0) return Math.min(layout.columnCount - 1, bayIdx)
  const withCtrDep = layout.sections.find((s) => s.sectionId === 'ctr_dep')
  if (withCtrDep) return withCtrDep.anchorColumn
  const existingRwy = layout.sections.find(
    (s) => s.sectionId && isEssaDynamicRunwaySectionId(s.sectionId),
  )
  if (existingRwy) return existingRwy.anchorColumn
  return Math.min(layout.columnCount - 1, 1)
}

export function useWorkspace() {
  const enabled = computed(() => !!activeLayout.value)

  const columnCount = computed(() => activeLayout.value?.columnCount ?? 4)

  const sections = computed(() => activeLayout.value?.sections ?? [])

  function ensureFromServer(
    serverLayout: EfsLayout,
    roles: string[],
    opts?: { forceBuiltIn?: boolean },
  ) {
    const roleKey = essaRoleKey(roles)
    const defaultFlow = getDefaultSortFlow()

    if (opts?.forceBuiltIn || !activeLayout.value || activeLayout.value.roleKey !== roleKey) {
      activeLayout.value = buildDefaultWorkspaceLayout(serverLayout, roles, {
        defaultSortFlow: defaultFlow,
      })
      closedSectionIds.value = new Set()
      manuallyAddedRunwayIds.value = new Set()
      persistActiveLayout(activeLayout.value)
    } else {
      syncRunwaySectionsFromServer(serverLayout)
    }
  }

  /**
   * Keep workspace runway headers in sync with ES-selected / strip-driven pairs
   * from the server layout. Manually catalog-added runways are kept until closed.
   */
  function syncRunwaySectionsFromServer(serverLayout: EfsLayout) {
    const layout = activeLayout.value
    if (!layout) return

    const serverRwys = listServerRunwaySections(serverLayout)
    const serverIds = new Set(serverRwys.map((s) => s.id))

    // Allow auto-reappear after ES drops then re-selects a pair the user had closed
    let closed = closedSectionIds.value
    let closedChanged = false
    for (const id of [...closed]) {
      if (isEssaDynamicRunwaySectionId(id) && !serverIds.has(id)) {
        if (!closedChanged) {
          closed = new Set(closed)
          closedChanged = true
        }
        closed.delete(id)
      }
    }
    if (closedChanged) closedSectionIds.value = closed

    const present = new Set(
      layout.sections.map((s) => s.sectionId).filter((id): id is string => !!id),
    )

    let sections = layout.sections.filter((s) => {
      if (!s.sectionId || !isEssaDynamicRunwaySectionId(s.sectionId)) return true
      if (serverIds.has(s.sectionId)) return true
      if (manuallyAddedRunwayIds.value.has(s.sectionId)) return true
      return false
    })

    if (
      sections.length === layout.sections.length &&
      serverRwys.every((s) => present.has(s.id) || closedSectionIds.value.has(s.id))
    ) {
      return
    }

    // Start from filtered list (removed stale auto-runways)
    activeLayout.value = { ...layout, sections }
    const defaultFlow = getDefaultSortFlow()
    let added = 0
    for (const sec of serverRwys) {
      if (present.has(sec.id)) continue
      if (closedSectionIds.value.has(sec.id)) continue
      const layoutNow = activeLayout.value
      if (!layoutNow) break
      const col = preferredRunwayColumn(layoutNow, serverLayout, sec.id)
      const next = insertSectionWithoutOverlap(
        {
          instanceId: sec.id,
          sectionId: sec.id,
          title: sec.title,
          anchorColumn: col,
          stripSize: 'normal',
          sortFlow: sec.addFromTop === false ? 'newestBottom' : defaultFlow,
        },
        layoutNow.sections,
      )
      activeLayout.value = { ...layoutNow, sections: next }
      present.add(sec.id)
      added++
    }

    if (added === 0 && sections.length === layout.sections.length) return
    if (activeLayout.value) persistActiveLayout(activeLayout.value)
  }

  /** Mark role key confirmed and force the layout picker closed. */
  function confirmLayoutPrompt(roleKey: string) {
    state.layoutPromptConfirmedFor = roleKey
    if (roleKey) state.lastRoleKey = roleKey
    layoutDialogOpen.value = false
  }

  /** Forget confirmation so the next role-driven prompt can open again. */
  function invalidateLayoutPrompt() {
    state.layoutPromptConfirmedFor = ''
  }

  /**
   * Called when ESSA roles change. Opens layout dialog; applies built-in
   * tentatively so the board isn't empty while choosing.
   */
  function onRolesChanged(serverLayout: EfsLayout, roles: string[]) {
    const roleKey = essaRoleKey(roles)
    pendingRoleKey.value = roleKey

    // User already OK'd this role set — never re-open (even if layout was cleared)
    if (roleKey === state.layoutPromptConfirmedFor) {
      state.lastRoleKey = roleKey
      layoutDialogOpen.value = false
      if (!activeLayout.value) ensureFromServer(serverLayout, roles)
      return
    }

    if (roleKey === state.lastRoleKey && activeLayout.value && !layoutDialogOpen.value) {
      return
    }

    const prev = state.lastRoleKey
    state.lastRoleKey = roleKey

    // Tentative built-in so strips have somewhere to go
    activeLayout.value = buildDefaultWorkspaceLayout(serverLayout, roles, {
      defaultSortFlow: getDefaultSortFlow(),
    })
    closedSectionIds.value = new Set()
    persistActiveLayout(activeLayout.value)

    // Skip dialog on first connect with no previous roles
    if (prev === '' && !listSavedLayouts(roleKey).length) {
      state.layoutPromptConfirmedFor = roleKey
      return
    }
    layoutDialogReason.value = 'role-change'
    layoutDialogOpen.value = true
  }

  function dismissLayoutDialog(roles?: string[]) {
    const key =
      (roles && essaRoleKey(roles)) ||
      activeLayout.value?.roleKey ||
      essaRoleKey(activeLayout.value?.roles ?? [])
    confirmLayoutPrompt(key)
  }

  function applyLayout(layout: WorkspaceLayout) {
    const roleKey = layout.roleKey || essaRoleKey(layout.roles)
    // Close + confirm first so reactive cascades cannot reopen the picker
    confirmLayoutPrompt(roleKey)
    // Dividers + bay count only — never restore info-strip state from a layout file
    const cleaned = sanitizeWorkspaceLayout({
      ...layout,
      roleKey,
      rolesLabel: layout.rolesLabel || formatEssaRolesLabel(layout.roles),
    })
    activeLayout.value = cleaned
    closedSectionIds.value = new Set()
    persistActiveLayout(activeLayout.value)
  }

  /**
   * Apply a built-in default for `structureRoles` (e.g. CD-only profile).
   * `stampRoles` defaults to structureRoles; pass current live roles when
   * loading another combo's DEFAULT without changing the role selection.
   */
  function applyBuiltInDefault(
    serverLayout: EfsLayout,
    structureRoles: string[],
    stampRoles?: string[],
  ) {
    const stamp = stampRoles ?? structureRoles
    const built = buildDefaultWorkspaceLayout(serverLayout, structureRoles, {
      defaultSortFlow: getDefaultSortFlow(),
    })
    // Prevent live TWR runway sync from re-adding headers the profile omitted
    const kept = new Set(
      built.sections.map((s) => s.sectionId).filter((id): id is string => !!id),
    )
    const closed = new Set(closedSectionIds.value)
    for (const bay of serverLayout.bays) {
      for (const sec of bay.sections) {
        if (isEssaDynamicRunwaySectionId(sec.id) && !kept.has(sec.id)) {
          closed.add(sec.id)
        }
      }
    }
    closedSectionIds.value = closed
    applyLayout({
      ...built,
      roleKey: essaRoleKey(stamp),
      roles: [...stamp],
      rolesLabel: formatEssaRolesLabel(stamp),
    })
  }

  function setColumnCount(n: number, serverLayout: EfsLayout) {
    const layout = activeLayout.value
    if (!layout) return
    const next = Math.min(WORKSPACE_MAX_COLUMNS, Math.max(WORKSPACE_MIN_COLUMNS, Math.round(n)))
    if (next === layout.columnCount) return

    if (next < layout.columnCount) {
      // Clamp anchors into last remaining column; do not auto-merge
      const last = next - 1
      const sections = layout.sections.map((s) =>
        s.anchorColumn >= next ? { ...s, anchorColumn: last } : s,
      )
      activeLayout.value = { ...layout, columnCount: next, sections }
    } else {
      // + : only increase capacity; headers stay put (overflow may release)
      activeLayout.value = { ...layout, columnCount: next }
    }
    persistActiveLayout(activeLayout.value)
    void serverLayout
  }

  function adjustColumnCount(delta: number, serverLayout: EfsLayout) {
    setColumnCount(columnCount.value + delta, serverLayout)
  }

  function updateSection(instanceId: string, patch: Partial<WorkspaceSection>) {
    const layout = activeLayout.value
    if (!layout) return
    activeLayout.value = {
      ...layout,
      sections: layout.sections.map((s) => (s.instanceId === instanceId ? { ...s, ...patch } : s)),
    }
    persistActiveLayout(activeLayout.value)
  }

  /**
   * Set pixel height for a workspace section (non-last in column).
   * `persist=false` during live resize drag; call `persistHeights()` on pointer up.
   */
  function setSectionHeight(instanceId: string, height: number, persist = true) {
    const layout = activeLayout.value
    if (!layout) return
    const minH = 80
    const h = Math.max(minH, Math.round(height))
    activeLayout.value = {
      ...layout,
      sections: layout.sections.map((s) =>
        s.instanceId === instanceId ? { ...s, height: h } : s,
      ),
    }
    if (persist) persistActiveLayout(activeLayout.value)
  }

  function persistHeights() {
    if (activeLayout.value) persistActiveLayout(activeLayout.value)
  }

  function clearSectionHeight(instanceId: string) {
    const layout = activeLayout.value
    if (!layout) return
    activeLayout.value = {
      ...layout,
      sections: layout.sections.map((s) => {
        if (s.instanceId !== instanceId) return s
        const { height: _h, ...rest } = s
        return rest
      }),
    }
    persistActiveLayout(activeLayout.value)
  }

  function sectionsInColumn(col: number): WorkspaceSection[] {
    const layout = activeLayout.value
    if (!layout) return []
    return layout.sections
      .filter((s) => s.anchorColumn === col)
      .slice()
      .sort((a, b) => {
        const ay = a.y
        const by = b.y
        if (ay != null && by != null && ay !== by) return ay - by
        if (ay != null && by == null) return -1
        if (ay == null && by != null) return 1
        return 0
      })
  }

  /**
   * Overflow capacity above the first header (extension of previous bay).
   * Empty column (no headers) = full bay-body height — can receive overflow.
   * First header at y===0 (real or empty blocker) = barrier (0).
   */
  function getColumnTopGap(col: number): number {
    const sorted = sectionsInColumn(col)
    const bodyH = columnBodyHeightByCol.value[col] ?? 0
    if (!sorted.length) return bodyH > 0 ? bodyH : 0
    const y0 = sorted[0]!.y
    return y0 != null && y0 > 0 ? y0 : 0
  }

  function setColumnBodyHeight(col: number, height: number) {
    const h = Math.max(0, Math.round(height))
    if (columnBodyHeightByCol.value[col] === h) return
    columnBodyHeightByCol.value = { ...columnBodyHeightByCol.value, [col]: h }
    scheduleOverflowRepack()
  }

  function setSectionTopOrder(instanceId: string, stripIds: string[]) {
    const prev = sectionTopOrderByInstance.value[instanceId]
    if (
      prev &&
      prev.length === stripIds.length &&
      prev.every((id, i) => id === stripIds[i])
    ) {
      return
    }
    sectionTopOrderByInstance.value = {
      ...sectionTopOrderByInstance.value,
      [instanceId]: stripIds.slice(),
    }
    scheduleOverflowRepack()
  }

  function getSectionOverflow(instanceId: string | undefined): SectionOverflowPlan | undefined {
    if (!instanceId) return undefined
    return overflowPack.value.byInstance[instanceId]
  }

  function getColumnOverflowHost(col: number): OverflowHostPlan | undefined {
    return overflowPack.value.byHostColumn[col]
  }

  function scheduleOverflowRepack() {
    if (overflowRepackRaf) cancelAnimationFrame(overflowRepackRaf)
    overflowRepackRaf = requestAnimationFrame(() => {
      overflowRepackRaf = 0
      repackOverflow()
    })
  }

  function repackOverflow() {
    const layout = activeLayout.value
    if (!layout) {
      overflowPack.value = { byInstance: {}, byHostColumn: {} }
      return
    }

    const store = useEfsStore()
    const bayFor = (sectionId: string) =>
      serverBayIdForSection(store.layout, sectionId) || store.layout.bays[0]?.id || ''
    const gapPx = (sectionId: string, bayId: string, index: number) => {
      const gaps = store.getGapsForSection(bayId, sectionId)
      return gaps[index] ?? 0
    }

    overflowPack.value = packWorkspaceOverflow({
      columnCount: layout.columnCount,
      sectionsInColumn,
      getColumnTopGap,
      columnBodyHeight: (col) => columnBodyHeightByCol.value[col] ?? 0,
      topOrderByInstance: sectionTopOrderByInstance.value,
      bayIdForSection: bayFor,
      measureHeaderHeight,
      measurePinnedChrome: measurePinnedChromePx,
      bayScaleForColumn: measureBayScale,
      gapPxBeforeIndex: gapPx,
    })
  }

  // Layout / column geometry changes → repack
  watch(
    () =>
      activeLayout.value
        ? {
            n: activeLayout.value.columnCount,
            sections: activeLayout.value.sections.map((s) => ({
              id: s.instanceId,
              col: s.anchorColumn,
              y: s.y,
              sid: s.sectionId,
            })),
          }
        : null,
    () => scheduleOverflowRepack(),
    { deep: true },
  )

  function columnBodyEl(col: number): HTMLElement | null {
    return document.querySelector(
      `.efs-bay[data-ws-column="${col}"] .bay-body`,
    ) as HTMLElement | null
  }

  /**
   * Capture current header tops into `y` so later removes/moves keep visual positions.
   */
  function syncColumnYsFromDom(col: number) {
    const layout = activeLayout.value
    if (!layout) return
    const body = columnBodyEl(col)
    if (!body) return
    const bodyTop = body.getBoundingClientRect().top
    const next = layout.sections.map((s) => {
      if (s.anchorColumn !== col) return s
      const el = document.querySelector(
        `[data-ws-instance="${CSS.escape(s.instanceId)}"]`,
      ) as HTMLElement | null
      if (!el) return s
      const y = Math.max(0, Math.round(el.getBoundingClientRect().top - bodyTop))
      return { ...s, y }
    })
    activeLayout.value = { ...layout, sections: next }
  }

  /** True when any header in this column still lacks an absolute `y` (equal-flex). */
  function columnHasUnsetYs(col: number): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    return layout.sections.some((s) => s.anchorColumn === col && s.y == null)
  }

  /**
   * Freeze equal-flex columns to absolute Y once. Needed before any header in the
   * column gets a `y` — otherwise buildDisplayBays packs null-y siblings into a
   * stacked clump (seen when dragging an empty divider into/across a bay).
   */
  function ensureColumnAbsoluteYs(col: number) {
    if (!columnHasUnsetYs(col)) return
    syncColumnYsFromDom(col)
  }

  function clientYToColumnY(col: number, clientY: number): number {
    const body = columnBodyEl(col)
    if (!body) return Math.max(0, clientY)
    const rect = body.getBoundingClientRect()
    return Math.max(0, Math.min(rect.height - 20, clientY - rect.top))
  }

  /**
   * Which bay the cursor is over. When `fromColumn` is set (header drag), only
   * switch to a neighbour after the cursor is past 25% of that bay's width
   * from the shared edge — avoids accidental bay hops at the border.
   */
  function columnAtClientX(clientX: number, fromColumn?: number | null): number | null {
    const layout = activeLayout.value
    if (!layout) return null
    let rawCol: number | null = null
    let rawRect: DOMRect | null = null
    for (let c = 0; c < layout.columnCount; c++) {
      const bay = document.querySelector(`.efs-bay[data-ws-column="${c}"]`) as HTMLElement | null
      if (!bay) continue
      const r = bay.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right) {
        rawCol = c
        rawRect = r
        break
      }
    }
    if (rawCol == null || rawRect == null) return fromColumn ?? null
    if (fromColumn == null || rawCol === fromColumn) return rawCol

    const inset = rawRect.width * 0.25
    if (rawCol > fromColumn) {
      // Entering from the left — require past left 25%
      if (clientX < rawRect.left + inset) return fromColumn
    } else {
      // Entering from the right — require past right 25%
      if (clientX > rawRect.right - inset) return fromColumn
    }
    return rawCol
  }

  function canMergePair(a: WorkspaceSection, b: WorkspaceSection): boolean {
    return (
      !!a.groupId &&
      a.groupId === b.groupId &&
      canMergeSection(a) &&
      canMergeSection(b) &&
      a.instanceId !== b.instanceId
    )
  }

  /** Live `.section-header` height (matches visible border); falls back to constant. */
  function measureHeaderHeight(instanceId?: string): number {
    if (instanceId) {
      const el = document.querySelector(
        `[data-ws-instance="${CSS.escape(instanceId)}"] .section-header`,
      ) as HTMLElement | null
      const h = el?.getBoundingClientRect().height
      if (h && h > 0) return h
    }
    const any = document.querySelector(
      '.efs-bay--workspace .section-header',
    ) as HTMLElement | null
    const h = any?.getBoundingClientRect().height
    return h && h > 0 ? h : WORKSPACE_HEADER_H
  }

  /**
   * Push `desiredY` so the moving header does not overlap another header's bar.
   * Crashbox = exact rendered header height (top↔bottom border).
   * Mergeable siblings are skipped (drop-to-merge is allowed to overlap).
   */
  function collideHeaderY(
    moving: WorkspaceSection,
    col: number,
    desiredY: number,
    all: WorkspaceSection[],
    opts?: { allowMergeOverlap?: boolean },
  ): number {
    const allowMerge = opts?.allowMergeOverlap !== false
    const moveH = measureHeaderHeight(moving.instanceId)
    // Nearest obstacle by Y — array order made pass-through feel random
    const obstacles = all
      .filter((o) => {
        if (o.instanceId === moving.instanceId) return false
        if (o.anchorColumn !== col || o.y == null) return false
        if (allowMerge && canMergePair(moving, o)) return false
        return true
      })
      .slice()
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    let y = Math.max(0, desiredY)
    for (let pass = 0; pass < 12; pass++) {
      let blocked: WorkspaceSection | null = null
      let blockedH = moveH
      for (const o of obstacles) {
        const oH = measureHeaderHeight(o.instanceId)
        const oy = o.y!
        // AABB: moving [y, y+moveH) vs obstacle [oy, oy+oH)
        if (y < oy + oH && y + moveH > oy) {
          blocked = o
          blockedH = oH
          break
        }
      }
      if (!blocked || blocked.y == null) break
      const oy = blocked.y
      const mid = oy + blockedH / 2
      // Stay on the side we're approaching from — sit flush on the border
      y = y + moveH / 2 < mid ? Math.max(0, oy - moveH) : oy + blockedH
    }
    return Math.round(y)
  }

  /**
   * Push any overlapping headers in a column downward so bars never share pixels.
   * Stable top→bottom order; does not allow merge overlap.
   */
  function resolveColumnHeaderOverlaps(
    col: number,
    sections: WorkspaceSection[],
  ): WorkspaceSection[] {
    const ordered = sections
      .filter((s) => s.anchorColumn === col && s.y != null)
      .slice()
      .sort((a, b) => {
        const dy = (a.y ?? 0) - (b.y ?? 0)
        if (dy !== 0) return dy
        return a.instanceId.localeCompare(b.instanceId)
      })
    if (ordered.length < 2) return sections

    const yById = new Map<string, number>()
    let prevBottom = -Infinity
    let changed = false
    for (const s of ordered) {
      const h = measureHeaderHeight(s.instanceId)
      let y = s.y ?? 0
      if (y < prevBottom) {
        y = prevBottom
        changed = true
      }
      yById.set(s.instanceId, y)
      prevBottom = y + h
    }
    if (!changed) return sections
    return sections.map((s) => {
      const y = yById.get(s.instanceId)
      return y != null && y !== s.y ? { ...s, y } : s
    })
  }

  /** True when this column already uses absolute header tops. */
  function columnUsesAbsoluteY(col: number, sections: WorkspaceSection[]): boolean {
    return sections.some((s) => s.anchorColumn === col && s.y != null)
  }

  /**
   * Insert a new header without stacking on an existing one.
   * If the column uses absolute Y (or DOM sync reveals it), assign a free Y below
   * the last header and resolve any residual overlaps.
   */
  function insertSectionWithoutOverlap(
    sec: WorkspaceSection,
    sections: WorkspaceSection[],
  ): WorkspaceSection[] {
    const col = sec.anchorColumn
    const hadY = columnUsesAbsoluteY(col, sections)
    // Freeze live positions before inserting
    syncColumnYsFromDom(col)
    const layout = activeLayout.value
    let all = (layout?.sections ?? sections).filter((s) => s.instanceId !== sec.instanceId)
    const usesY = hadY || columnUsesAbsoluteY(col, all)

    let next = sec
    if (usesY) {
      const headerH = measureHeaderHeight()
      const sorted = all
        .filter((s) => s.anchorColumn === col && s.y != null)
        .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
      const desired = sorted.length ? (sorted[sorted.length - 1].y ?? 0) + headerH : 0
      const probe = { ...sec, y: desired }
      const y = collideHeaderY(probe, col, desired, [...all, probe], {
        allowMergeOverlap: false,
      })
      next = { ...sec, y }
    }

    all = [...all, next]
    return usesY ? resolveColumnHeaderOverlaps(col, all) : all
  }

  /** Mergeable header whose bar overlaps `y` in this column (for drop-to-merge). */
  function findMergeableAtY(instanceId: string, col: number, y: number): string | null {
    const layout = activeLayout.value
    if (!layout) return null
    const moving = layout.sections.find((s) => s.instanceId === instanceId)
    if (!moving) return null
    const moveH = measureHeaderHeight(instanceId)
    let best: { id: string; dist: number } | null = null
    for (const o of layout.sections) {
      if (o.anchorColumn !== col || o.y == null) continue
      if (!canMergePair(moving, o)) continue
      const oH = measureHeaderHeight(o.instanceId)
      if (y < o.y + oH && y + moveH > o.y) {
        const dist = Math.abs(y - o.y)
        if (!best || dist < best.dist) best = { id: o.instanceId, dist }
      }
    }
    return best?.id ?? null
  }

  /**
   * Place a header at an absolute Y in a column (same gesture for resize + cross-bay move).
   * Other headers keep their `y` so removing one leaves a gap (overflow / extension).
   * Non-mergeable headers collide; mergeable pairs may overlap (merge on drop).
   */
  function placeSection(
    instanceId: string,
    toColumn: number,
    clientY: number,
    opts?: { persist?: boolean; syncDom?: boolean },
  ) {
    const layout = activeLayout.value
    if (!layout) return
    const col = Math.min(layout.columnCount - 1, Math.max(0, toColumn))
    const moving = layout.sections.find((s) => s.instanceId === instanceId)
    if (!moving) return

    const fromCol = moving.anchorColumn
    if (opts?.syncDom !== false) {
      syncColumnYsFromDom(fromCol)
      if (col !== fromCol) syncColumnYsFromDom(col)
    } else {
      // Live drag: do not re-read every frame (fights the cursor), but freeze any
      // equal-flex column once so a single absolute y cannot stack null-y siblings.
      ensureColumnAbsoluteYs(fromCol)
      if (col !== fromCol) ensureColumnAbsoluteYs(col)
    }

    const layout2 = activeLayout.value
    if (!layout2) return
    const moving2 = layout2.sections.find((s) => s.instanceId === instanceId) ?? moving
    const rawY = Math.round(clientYToColumnY(col, clientY))
    const y = collideHeaderY(moving2, col, rawY, layout2.sections)

    const placed = layout2.sections.map((s) =>
      s.instanceId === instanceId ? { ...s, anchorColumn: col, y } : s,
    )
    // After a committed place, guarantee no residual header overlap in the target column
    activeLayout.value = {
      ...layout2,
      sections:
        opts?.persist === false
          ? placed
          : resolveColumnHeaderOverlaps(col, placed),
    }
    if (opts?.persist !== false) persistActiveLayout(activeLayout.value)
  }

  /** @deprecated prefer placeSection — kept for call sites */
  function moveSection(instanceId: string, toColumn: number, beforeInstanceId?: string | null) {
    const layout = activeLayout.value
    if (!layout) return
    const col = Math.min(layout.columnCount - 1, Math.max(0, toColumn))
    if (beforeInstanceId) {
      const before = layout.sections.find((s) => s.instanceId === beforeInstanceId)
      const y = before?.y ?? 0
      placeSection(instanceId, col, (columnBodyEl(col)?.getBoundingClientRect().top ?? 0) + y)
      return
    }
    const body = columnBodyEl(col)
    const top = body?.getBoundingClientRect().top ?? 0
    placeSection(instanceId, col, top + (body?.getBoundingClientRect().height ?? 0) * 0.5)
  }

  function moveSectionByClientY(instanceId: string, toColumn: number, clientY: number) {
    placeSection(instanceId, toColumn, clientY)
  }

  function beginSectionDrag(instanceId: string) {
    draggingSectionId.value = instanceId
  }

  function endSectionDrag() {
    draggingSectionId.value = null
  }

  function cycleStripSize(instanceId: string) {
    const order: SectionStripSize[] = ['compact', 'normal', 'expanded']
    const layout = activeLayout.value
    const s = layout?.sections.find((x) => x.instanceId === instanceId)
    if (!s) return
    const i = order.indexOf(s.stripSize)
    updateSection(instanceId, { stripSize: order[(i + 1) % order.length] })
  }

  /** Flip newestTop/newestBottom (addFromTop). Caller reverses strip positions. */
  function toggleSortFlow(instanceId: string) {
    const s = activeLayout.value?.sections.find((x) => x.instanceId === instanceId)
    if (!s) return
    updateSection(instanceId, {
      sortFlow: s.sortFlow === 'newestTop' ? 'newestBottom' : 'newestTop',
    })
  }

  function splitSection(instanceId: string, liveTitle?: string) {
    const layout = activeLayout.value
    if (!layout) return
    const s = layout.sections.find((x) => x.instanceId === instanceId)
    if (!s) return
    // Freeze current header tops so we can subdivide this section's span
    syncColumnYsFromDom(s.anchorColumn)
    const layout2 = activeLayout.value
    if (!layout2) return
    const fresh = layout2.sections.find((x) => x.instanceId === instanceId) ?? s
    const titled = { ...fresh, title: liveTitle || fresh.title }
    if (!canSplitSection(titled)) return

    const headerH = measureHeaderHeight(fresh.instanceId)
    const col = fresh.anchorColumn
    const baseY = fresh.y ?? 0
    // Next splitter below this header (or column bottom if last)
    const below = layout2.sections
      .filter(
        (x) =>
          x.anchorColumn === col &&
          x.instanceId !== fresh.instanceId &&
          x.y != null &&
          x.y > baseY,
      )
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    const body = columnBodyEl(col)
    const columnBottom = body
      ? Math.max(baseY + headerH, Math.round(body.getBoundingClientRect().height))
      : baseY + 160
    const spanEnd = below[0]?.y ?? columnBottom

    const splitSecs = splitWorkspaceSection(titled, layout2.sections, { headerH, spanEnd })
    activeLayout.value = {
      ...layout2,
      sections: resolveColumnHeaderOverlaps(col, splitSecs),
    }
    persistActiveLayout(activeLayout.value)
  }

  function tryMergeDrop(draggedId: string, targetId: string): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    const a = layout.sections.find((s) => s.instanceId === draggedId)
    const b = layout.sections.find((s) => s.instanceId === targetId)
    if (!a || !b || !canMergeSection(a) || !canMergeSection(b)) return false
    if (a.groupId !== b.groupId) return false
    // Combined header sits where the drop target was
    activeLayout.value = {
      ...layout,
      sections: mergeWorkspaceMembers(a, b, layout.sections, {
        placeAtInstanceId: b.instanceId,
      }),
    }
    persistActiveLayout(activeLayout.value)
    return true
  }

  function closeSection(instanceId: string) {
    const layout = activeLayout.value
    if (!layout) return
    const s = layout.sections.find((x) => x.instanceId === instanceId)
    if (!s) return
    // Freeze current header Ys so neighbours keep their place (top becomes overflow gap)
    syncColumnYsFromDom(s.anchorColumn)
    const layout2 = activeLayout.value
    if (!layout2) return
    const fresh = layout2.sections.find((x) => x.instanceId === instanceId) ?? s
    if (fresh.sectionId) {
      const nextClosed = new Set(closedSectionIds.value)
      nextClosed.add(fresh.sectionId)
      closedSectionIds.value = nextClosed
      if (isEssaDynamicRunwaySectionId(fresh.sectionId)) {
        const nextManual = new Set(manuallyAddedRunwayIds.value)
        nextManual.delete(fresh.sectionId)
        manuallyAddedRunwayIds.value = nextManual
      }
    }
    // Plain remove keeps remaining `y` values — do not reflow upward.
    // Auto-combine only when exactly one mergeable sibling remains (pairwise).
    const nextSections =
      canMergeSection(fresh) &&
      layout2.sections.filter(
        (x) => x.groupId === fresh.groupId && canMergeSection(x),
      ).length === 2
        ? closeOrMergeOnX(fresh, layout2.sections)
        : layout2.sections.filter((x) => x.instanceId !== instanceId)
    activeLayout.value = { ...layout2, sections: nextSections }
    persistActiveLayout(activeLayout.value)
  }

  function addEmptyHeader(column: number) {
    const layout = activeLayout.value
    if (!layout) return
    const col = Math.min(layout.columnCount - 1, Math.max(0, column))
    const empty: WorkspaceSection = {
      instanceId: newInstanceId('empty'),
      sectionId: null,
      anchorColumn: col,
      stripSize: 'normal',
      sortFlow: getDefaultSortFlow(),
    }
    activeLayout.value = {
      ...layout,
      sections: insertSectionWithoutOverlap(empty, layout.sections),
    }
    persistActiveLayout(activeLayout.value)
  }

  function addSectionFromCatalog(
    sectionId: string,
    title: string,
    column: number,
    serverLayout: EfsLayout,
  ) {
    const layout = activeLayout.value
    if (!layout) return
    // Already present?
    if (layout.sections.some((s) => s.sectionId === sectionId)) return
    const isRwy = isEssaDynamicRunwaySectionId(sectionId)
    const col = isRwy
      ? preferredRunwayColumn(layout, serverLayout, sectionId)
      : Math.min(layout.columnCount - 1, Math.max(0, column))
    const bayId = serverBayIdForSection(serverLayout, sectionId)
    void bayId
    const nextClosed = new Set(closedSectionIds.value)
    nextClosed.delete(sectionId)
    closedSectionIds.value = nextClosed
    if (isRwy) {
      const nextManual = new Set(manuallyAddedRunwayIds.value)
      nextManual.add(sectionId)
      manuallyAddedRunwayIds.value = nextManual
    }
    const anno = annotateCatalogSection(sectionId, title)
    const sec: WorkspaceSection = {
      instanceId: sectionId,
      sectionId,
      title: anno.title ?? title,
      groupId: anno.groupId,
      member: anno.member,
      anchorColumn: col,
      stripSize: 'normal',
      sortFlow: getDefaultSortFlow(),
    }
    activeLayout.value = {
      ...layout,
      sections: insertSectionWithoutOverlap(sec, layout.sections),
    }
    persistActiveLayout(activeLayout.value)
  }

  /** Build synthetic Bay[] for EfsBayContainer from workspace + server titles. */
  function buildDisplayBays(serverLayout: EfsLayout): Bay[] {
    const layout = activeLayout.value
    if (!layout) return serverLayout.bays

    const cols: Bay[] = []
    for (let c = 0; c < layout.columnCount; c++) {
      const sorted = sectionsInColumn(c)
      const useY = sorted.some((s) => s.y != null)
      // If absolute Y is in use, coerce missing/overlapping tops so headers never share pixels.
      // Null-y siblings must NOT pack to header-only gaps (that stacked whole columns when an
      // empty divider first introduced a `y` into an equal-flex bay) — keep a section-sized step.
      const tops = useY
        ? (() => {
            const headerH = measureHeaderHeight()
            const nullStep = Math.max(headerH, WORKSPACE_MIN_SECTION_H)
            let prev = -headerH
            return sorted.map((s) => {
              let y = s.y
              if (y == null) y = prev + nullStep
              else if (y < prev + headerH) y = prev + headerH
              prev = y
              return y
            })
          })()
        : null
      const colSections = sorted.map((s, i): Section => {
        let height = s.height
        if (tops && i < sorted.length - 1) {
          height = Math.max(0, tops[i + 1] - tops[i])
        } else if (tops && i === sorted.length - 1) {
          height = undefined // last flexes to fill
        }
        if (!s.sectionId) {
          // Synthetic parking id = instanceId (manual drops); rules never target this id.
          return {
            id: s.instanceId,
            title: '',
            hideHeader: false,
            height,
            addFromTop: s.sortFlow === 'newestTop',
          }
        }
        const serverSec = findServerSection(serverLayout, s.sectionId)
        // Split/merged workspace titles (TSAT / EOBT, …) win over YAML; else live server title
        const title =
          s.member || s.groupId
            ? (s.title ?? serverSec?.title ?? s.sectionId)
            : (serverSec?.title ?? s.title ?? s.sectionId)
        return {
          id: s.sectionId,
          title,
          height,
          addFromTop: s.sortFlow === 'newestTop',
        }
      })
      cols.push({
        id: `ws-col-${c}`,
        sections: colSections,
      })
    }
    return cols
  }

  function findServerSection(serverLayout: EfsLayout, sectionId: string): Section | undefined {
    for (const bay of serverLayout.bays) {
      const s = bay.sections.find((x) => x.id === sectionId)
      if (s) return s
    }
    return undefined
  }

  /**
   * Catalog of placeable sections — full ESSA set irrespective of role.
   * Includes headers already on the board (`present`) so the menu can grey them out.
   */
  function catalogSections(
    serverLayout: EfsLayout,
    _roles?: string[],
  ): { sectionId: string; title: string; present: boolean }[] {
    const presentIds = new Set(
      (activeLayout.value?.sections ?? []).map((s) => s.sectionId).filter(Boolean) as string[],
    )
    const serverTitle = new Map<string, string>()
    for (const bay of serverLayout.bays) {
      for (const sec of bay.sections) {
        if (!serverTitle.has(sec.id)) serverTitle.set(sec.id, sec.title)
      }
    }
    const out: { sectionId: string; title: string; present: boolean }[] = []
    const seen = new Set<string>()
    const push = (sectionId: string, title: string) => {
      if (seen.has(sectionId)) return
      // YAML placeholders — physical pairs are listed separately
      if (sectionId === 'arr_runway' || sectionId === 'dep_runway') return
      seen.add(sectionId)
      out.push({
        sectionId,
        title: serverTitle.get(sectionId) ?? title,
        present: presentIds.has(sectionId),
      })
    }
    for (const entry of ESSA_CATALOG_SECTIONS) {
      push(entry.sectionId, entry.title)
    }
    for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
      push(essaRunwaySectionId(pair), formatEssaRunwaySectionTitle(pair))
    }
    // Any extra server section not in the static catalog
    for (const bay of serverLayout.bays) {
      for (const sec of bay.sections) {
        push(sec.id, sec.title)
      }
    }
    return out
  }

  function openLayoutMenu() {
    layoutDialogReason.value = 'menu'
    layoutDialogOpen.value = true
  }

  function openSearchDialog() {
    searchDialogOpen.value = true
  }

  function setDefaultSortFlow(flow: SortFlow) {
    persistDefaultSortFlow(flow)
  }

  function clearWorkspace() {
    activeLayout.value = null
    layoutDialogOpen.value = false
    // Keep lastRoleKey / layoutPromptConfirmedFor so a mode flicker doesn't re-prompt
    persistActiveLayout(null)
  }

  function isLayoutDialogOpen() {
    return layoutDialogOpen.value
  }

  function getWorkspaceSection(instanceIdOrSectionId: string): WorkspaceSection | undefined {
    const layout = activeLayout.value
    if (!layout) return undefined
    return (
      layout.sections.find((s) => s.instanceId === instanceIdOrSectionId) ||
      layout.sections.find((s) => s.sectionId === instanceIdOrSectionId)
    )
  }

  return {
    enabled,
    activeLayout: activeLayout as Ref<WorkspaceLayout | null>,
    columnCount,
    sections,
    layoutDialogOpen,
    layoutDialogReason,
    searchDialogOpen,
    pendingRoleKey,
    closedSectionIds,
    draggingSectionId,
    ensureFromServer,
    onRolesChanged,
    applyLayout,
    applyBuiltInDefault,
    confirmLayoutPrompt,
    invalidateLayoutPrompt,
    dismissLayoutDialog,
    isLayoutDialogOpen,
    setColumnCount,
    adjustColumnCount,
    updateSection,
    setSectionHeight,
    persistHeights,
    clearSectionHeight,
    getColumnTopGap,
    setColumnBodyHeight,
    setSectionTopOrder,
    getSectionOverflow,
    getColumnOverflowHost,
    scheduleOverflowRepack,
    overflowPack,
    sectionsInColumn,
    syncColumnYsFromDom,
    columnAtClientX,
    placeSection,
    findMergeableAtY,
    moveSection,
    moveSectionByClientY,
    beginSectionDrag,
    endSectionDrag,
    cycleStripSize,
    toggleSortFlow,
    splitSection,
    tryMergeDrop,
    closeSection,
    addEmptyHeader,
    addSectionFromCatalog,
    syncRunwaySectionsFromServer,
    buildDisplayBays,
    catalogSections,
    openLayoutMenu,
    openSearchDialog,
    setDefaultSortFlow,
    getDefaultSortFlow,
    clearWorkspace,
    getWorkspaceSection,
    canSplitSection,
    canMergeSection,
  }
}

/** Singleton-style access — also on globalThis so HMR cannot fork API + state. */
type WorkspaceApi = ReturnType<typeof useWorkspace>
const gApi = globalThis as typeof globalThis & { __vatefsWorkspaceApi?: WorkspaceApi }
export function getWorkspace() {
  if (!gApi.__vatefsWorkspaceApi) gApi.__vatefsWorkspaceApi = useWorkspace()
  return gApi.__vatefsWorkspaceApi
}

/** Watch roles fingerprint and open dialog — call once from bay container. */
export function watchEssaRolesForWorkspace(
  rolesRef: Ref<string[]>,
  serverLayoutRef: Ref<EfsLayout>,
  essaRolesMode: Ref<boolean>,
) {
  const ws = getWorkspace()
  // Only role/mode changes prompt the layout dialog — not every layout websocket refresh
  watch(
    [essaRolesMode, () => essaRoleKey(rolesRef.value)],
    ([mode, key], [prevMode, prevKey]) => {
      if (!mode) {
        ws.clearWorkspace()
        return
      }
      if (!serverLayoutRef.value.bays.length) return
      if (key !== prevKey || (mode && !prevMode)) {
        ws.onRolesChanged(serverLayoutRef.value, rolesRef.value)
      } else if (!ws.activeLayout.value) {
        ws.ensureFromServer(serverLayoutRef.value, rolesRef.value)
      }
    },
    { immediate: true },
  )
  watch(serverLayoutRef, (layout) => {
    if (!essaRolesMode.value || !layout.bays.length) return
    if (!ws.activeLayout.value) {
      ws.ensureFromServer(layout, rolesRef.value)
    } else {
      // ES RWY config / assigned-pair headers — keep workspace runway dividers in sync
      ws.syncRunwaySectionsFromServer(layout)
    }
  })
}
