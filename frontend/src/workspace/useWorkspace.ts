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
  DtransVariantId,
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
  effectiveSectionY,
  newInstanceId,
} from './types'
import { ESSA_CATALOG_SECTIONS, SAAB_CATALOG_SECTIONS } from './catalog'
import {
  annotateCatalogSection,
  buildDefaultWorkspaceLayout,
  buildWorkspaceLayoutFromServer,
  defaultEssaStripSize,
  preferredSortFlowForWorkspaceSection,
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
  clearActiveLayouts,
  getDefaultSortFlow,
  listSavedLayouts,
  loadActiveLayoutForRole,
  persistActiveLayout,
  resolveLoadedLayoutLabel,
  sanitizeWorkspaceLayout,
  setDefaultSortFlow as persistDefaultSortFlow,
  withLoadedLayoutLabel,
} from './storage'
import {
  measureBayScale,
  measurePinnedChromePx,
  packWorkspaceOverflow,
  type OverflowHostPlan,
  type OverflowPackResult,
  type SectionOverflowPlan,
} from './overflow'
import {
  beginSectionLayoutDrag,
  endSectionLayoutDrag,
  notifyAutoFitLayoutChanged,
  sectionLayoutDragging,
} from '@/composables/useAutoFitStripSize'

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
  /** After switchSaabLayout, apply this saved workspace once server layout arrives */
  pendingSaabSavedLayout: Ref<WorkspaceLayout | null>
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
      pendingSaabSavedLayout: ref<WorkspaceLayout | null>(null),
    }
  } else {
    // HMR / older singleton shape
    if (!g.__vatefsWorkspaceState.manuallyAddedRunwayIds) {
      g.__vatefsWorkspaceState.manuallyAddedRunwayIds = ref(new Set())
    }
    if (!g.__vatefsWorkspaceState.pendingSaabSavedLayout) {
      g.__vatefsWorkspaceState.pendingSaabSavedLayout = ref(null)
    }
  }
  return g.__vatefsWorkspaceState
}

const state = getState()
const activeLayout = state.activeLayout
const layoutDialogOpen = state.layoutDialogOpen
const layoutDialogReason = state.layoutDialogReason
const searchDialogOpen = state.searchDialogOpen
const pendingRoleKey = state.pendingRoleKey
const pendingSaabSavedLayout = state.pendingSaabSavedLayout
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
    opts?: { forceBuiltIn?: boolean; saabProfileId?: string; resync?: boolean },
  ) {
    const defaultFlow = getDefaultSortFlow()
    const store = useEfsStore()

    // OTHER: mirror server bays (not ESSA role templates)
    if (store.saabLayoutsMode && !store.essaRolesMode) {
      const profileId = opts?.saabProfileId || store.saabLayoutId || '1rwy4'
      const roleKey = `saab:${profileId}`
      if (pendingSaabSavedLayout.value) {
        const pending = pendingSaabSavedLayout.value
        pendingSaabSavedLayout.value = null
        applyLayout({
          ...pending,
          roleKey,
          columnCount: Math.max(pending.columnCount, serverLayout.bays.length),
        })
        return
      }
      if (
        opts?.forceBuiltIn ||
        opts?.resync ||
        !activeLayout.value ||
        activeLayout.value.roleKey !== roleKey
      ) {
        // Restore last working board for this SAAB profile (keeps per-divider sortFlow)
        // Skip restore when resyncing after a profile switch — saved board may be
        // from a premature build against the previous profile's bays.
        const saved =
          !opts?.forceBuiltIn && !opts?.resync
            ? loadActiveLayoutForRole(roleKey)
            : null
        if (saved) {
          activeLayout.value = withLoadedLayoutLabel({
            ...saved,
            roleKey,
            columnCount: Math.max(saved.columnCount, serverLayout.bays.length),
          })
        } else {
          const profile = store.saabLayouts?.find((l) => l.id === profileId)
          activeLayout.value = sanitizeWorkspaceLayout({
            ...buildWorkspaceLayoutFromServer(serverLayout, {
              roleKey,
              defaultSortFlow: defaultFlow,
            }),
            sourceLabel: profile
              ? `${profile.name} · ${profile.bayCount} BAYS`
              : 'DEFAULT',
            sourceSavedId: undefined,
          })
        }
        closedSectionIds.value = new Set()
        manuallyAddedRunwayIds.value = new Set()
        persistActiveLayout(activeLayout.value)
      }
      return
    }

    const roleKey = essaRoleKey(roles)
    if (opts?.forceBuiltIn || !activeLayout.value || activeLayout.value.roleKey !== roleKey) {
      // Restore last working board for this ESSA role set (keeps per-divider sortFlow)
      const saved =
        !opts?.forceBuiltIn ? loadActiveLayoutForRole(roleKey) : null
      if (saved) {
        activeLayout.value = withLoadedLayoutLabel({
          ...saved,
          roleKey,
          roles: [...roles],
          rolesLabel: formatEssaRolesLabel(roles),
        })
        closedSectionIds.value = new Set()
        manuallyAddedRunwayIds.value = new Set()
        persistActiveLayout(activeLayout.value)
        syncRunwaySectionsFromServer(serverLayout)
      } else {
        activeLayout.value = sanitizeWorkspaceLayout({
          ...buildDefaultWorkspaceLayout(serverLayout, roles, {
            defaultSortFlow: defaultFlow,
          }),
          sourceLabel: 'DEFAULT',
          sourceSavedId: undefined,
        })
        closedSectionIds.value = new Set()
        manuallyAddedRunwayIds.value = new Set()
        persistActiveLayout(activeLayout.value)
      }
    } else {
      // Re-sanitize in place so duplicate CD / INBOUND APP from older saves drop
      const before = activeLayout.value
      const cleaned = sanitizeWorkspaceLayout(before)
      if (cleaned.sections.length !== before.sections.length) {
        activeLayout.value = cleaned
        persistActiveLayout(cleaned)
      }
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
      const layoutNow: WorkspaceLayout | null = activeLayout.value
      if (!layoutNow) break
      const col = preferredRunwayColumn(layoutNow, serverLayout, sec.id)
      // ARR-column runways (after CTR ARR) default first-at-bottom; DEP column first-on-top
      const afterCtrArr = layoutNow.sections.some(
        (s) =>
          s.anchorColumn === col &&
          (s.sectionId === 'ctr_arr' ||
            (s.title || '').toUpperCase().trim() === 'CTR ARR' ||
            (s.title || '').toUpperCase().trim() === 'TMA ARR'),
      )
      const preferred = preferredSortFlowForWorkspaceSection({
        sectionId: sec.id,
        title: sec.title,
      })
      const sortFlow =
        preferred ??
        (afterCtrArr
          ? 'newestTop'
          : sec.addFromTop === false
            ? 'newestBottom'
            : sec.addFromTop === true
              ? 'newestTop'
              : defaultFlow)
      const next = insertSectionWithoutOverlap(
        {
          instanceId: sec.id,
          sectionId: sec.id,
          title: sec.title,
          anchorColumn: col,
          stripSize: 'normal',
          sortFlow,
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
    // Keep previous role's per-divider sortFlow / stripSize before switching
    if (activeLayout.value && activeLayout.value.roleKey && activeLayout.value.roleKey !== roleKey) {
      persistActiveLayout(activeLayout.value)
    }
    state.lastRoleKey = roleKey

    // Prefer last working board for this role set; else tentative built-in
    const saved = loadActiveLayoutForRole(roleKey)
    if (saved) {
      activeLayout.value = sanitizeWorkspaceLayout({
        ...saved,
        roleKey,
        roles: [...roles],
        rolesLabel: formatEssaRolesLabel(roles),
      })
      syncRunwaySectionsFromServer(serverLayout)
    } else {
      activeLayout.value = buildDefaultWorkspaceLayout(serverLayout, roles, {
        defaultSortFlow: getDefaultSortFlow(),
      })
    }
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

  /**
   * Put a layout on the board without confirming/closing the picker.
   * Layout = bay count + section dividers only (info strips are independent).
   */
  function previewLayout(
    layout: WorkspaceLayout,
    opts?: {
      resetClosed?: boolean
      /** Catalog → Layout label (DEFAULT / saved name / OTHER profile). */
      sourceLabel?: string | null
      sourceSavedId?: string | null
    },
  ) {
    const roleKey = layout.roleKey || essaRoleKey(layout.roles)
    const withSource: WorkspaceLayout = {
      ...layout,
      roleKey,
      rolesLabel: layout.rolesLabel || formatEssaRolesLabel(layout.roles),
    }
    if (opts && 'sourceLabel' in opts) {
      if (opts.sourceLabel?.trim()) withSource.sourceLabel = opts.sourceLabel.trim()
      else delete withSource.sourceLabel
    }
    if (opts && 'sourceSavedId' in opts) {
      if (opts.sourceSavedId?.trim()) withSource.sourceSavedId = opts.sourceSavedId.trim()
      else delete withSource.sourceSavedId
    }
    const cleaned = sanitizeWorkspaceLayout(withSource)
    activeLayout.value = cleaned
    if (opts?.resetClosed !== false) closedSectionIds.value = new Set()
    persistActiveLayout(activeLayout.value)
  }

  function applyLayout(layout: WorkspaceLayout) {
    const roleKey = layout.roleKey || essaRoleKey(layout.roles)
    // Close + confirm first so reactive cascades cannot reopen the picker
    confirmLayoutPrompt(roleKey)
    previewLayout(layout)
  }

  /**
   * Built-in default for `structureRoles` (e.g. CD-only profile) on the board
   * without confirming the picker. `stampRoles` defaults to structureRoles.
   */
  function previewBuiltInDefault(
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
    previewLayout(
      {
        ...built,
        roleKey: essaRoleKey(stamp),
        roles: [...stamp],
        rolesLabel: formatEssaRolesLabel(stamp),
      },
      { resetClosed: false, sourceLabel: 'DEFAULT', sourceSavedId: null },
    )
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
    previewBuiltInDefault(serverLayout, structureRoles, stamp)
    confirmLayoutPrompt(essaRoleKey(stamp))
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
    const bodyH = columnBodyHeightByCol.value[col] ?? 0
    return layout.sections
      .filter((s) => s.anchorColumn === col)
      .slice()
      .sort((a, b) => {
        const ay = effectiveSectionY(a, bodyH)
        const by = effectiveSectionY(b, bodyH)
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
    const y0 = effectiveSectionY(sorted[0]!, bodyH)
    return y0 != null && y0 > 0 ? y0 : 0
  }

  /** Bake yRatio → absolute y once column body height is known (DEFAULT CD EOBT). */
  function materializeYRatios(col: number): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    const bodyH = columnBodyHeightByCol.value[col] ?? 0
    if (bodyH <= 0) return false
    const headerH = measureHeaderHeight()
    const maxY = Math.max(0, bodyH - headerH)
    let changed = false
    const sections = layout.sections.map((s) => {
      if (s.anchorColumn !== col || s.yRatio == null) return s
      let y = effectiveSectionY(s, bodyH)
      if (y == null) return s
      if (y > maxY) y = maxY
      const ratio = bodyH > 0 ? y / bodyH : s.yRatio
      if (y === s.y && ratio === s.yRatio) return s
      changed = true
      return { ...s, y, yRatio: ratio }
    })
    if (!changed) return false
    activeLayout.value = { ...layout, sections }
    return true
  }

  /** Attach absolute y + yRatio so headers reflow when the bay body resizes. */
  function yFields(y: number, bodyH: number): { y: number; yRatio?: number } {
    const yy = Math.max(0, Math.round(y))
    if (bodyH > 0) return { y: yy, yRatio: yy / bodyH }
    return { y: yy }
  }

  /**
   * Backfill missing yRatio from absolute y, clamp any header past the bay floor,
   * then rematerialize so resize / ESSA overflow columns cannot paint onto the bar.
   */
  function rescaleColumnYsForBody(col: number, bodyH: number, prevBodyH: number) {
    const layout = activeLayout.value
    if (!layout || bodyH <= 0) return false
    const headerH = measureHeaderHeight()
    const maxY = Math.max(0, bodyH - headerH)
    let changed = false
    const sections = layout.sections.map((s) => {
      if (s.anchorColumn !== col) return s
      const basis = prevBodyH > 0 ? prevBodyH : bodyH
      let next = s
      if (s.yRatio == null && s.y != null && Number.isFinite(s.y) && basis > 0) {
        changed = true
        next = { ...next, yRatio: Math.max(0, s.y) / basis }
      }
      const eff = effectiveSectionY(next, bodyH)
      if (eff != null && eff > maxY) {
        changed = true
        next = { ...next, ...yFields(maxY, bodyH) }
      }
      return next
    })
    if (changed) activeLayout.value = { ...layout, sections }
    return materializeYRatios(col) || changed
  }

  function setColumnBodyHeight(col: number, height: number) {
    const h = Math.max(0, Math.round(height))
    const prev = columnBodyHeightByCol.value[col]
    if (prev !== h) {
      columnBodyHeightByCol.value = { ...columnBodyHeightByCol.value, [col]: h }
    }
    // Reload/HMR can freeze headers at y≈0 before the bay has height; heal once body is real.
    // Also re-check when height is unchanged (Vite HMR remount keeps the workspace singleton).
    if (h >= WORKSPACE_MIN_SECTION_H * 2) {
      // Always run on first measure (prev unset) and on resize — ESSA continuous-flow
      // columns often park a header on the floor (CTR DEP / TAXIWAY DEP).
      const basis = prev != null && prev > 0 ? prev : h
      rescaleColumnYsForBody(col, h, basis)
      const ratioed = materializeYRatios(col)
      const healed = healCollapsedColumnYs(col)
      if (healed || columnHasUnsetYs(col)) syncColumnYsFromDom(col)
      else if (ratioed) scheduleOverflowRepack()
    }
    if (prev !== h) scheduleOverflowRepack()
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

  /** True when a repack was skipped mid-header-drag and must run on pointer up. */
  let overflowRepackDeferred = false

  function scheduleOverflowRepack() {
    // Header drag moves Y every frame; live repack changes primaryCount in
    // unrelated columns (RUNWAY jumps while dragging CD/TSAT). Freeze pack.
    if (sectionLayoutDragging.value) {
      overflowRepackDeferred = true
      return
    }
    if (overflowRepackRaf) cancelAnimationFrame(overflowRepackRaf)
    overflowRepackRaf = requestAnimationFrame(() => {
      overflowRepackRaf = 0
      // Drag may have started after this rAF was queued
      if (sectionLayoutDragging.value) {
        overflowRepackDeferred = true
        return
      }
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
   * True when absolute header tops form a header-only stack at the top of a tall bay
   * (reload / HMR before flex layout, or a persisted bad sync).
   */
  function columnYsLookStacked(ys: number[], bodyH: number, headerH: number): boolean {
    const n = ys.length
    if (n < 2) return false
    if (bodyH < n * WORKSPACE_MIN_SECTION_H) return false
    const sorted = ys.slice().sort((a, b) => a - b)
    const span = sorted[sorted.length - 1]! - sorted[0]!
    // Healthy equal-flex span is ~bodyH*(n-1)/n; a header clump spans ~(n-1)*headerH.
    const clumpMax = (n - 1) * headerH + 12
    return span <= clumpMax && sorted[0]! <= headerH
  }

  /** Evenly space headers down the column (fallback when DOM snapshot is collapsed). */
  function assignEvenColumnYs(col: number, bodyH: number): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    const sorted = sectionsInColumn(col)
    if (sorted.length < 1) return false
    if (bodyH < sorted.length * WORKSPACE_MIN_SECTION_H) return false
    const step = bodyH / sorted.length
    const yById = new Map<string, number>()
    sorted.forEach((s, i) => yById.set(s.instanceId, Math.round(i * step)))
    activeLayout.value = {
      ...layout,
      sections: layout.sections.map((s) => {
        const y = yById.get(s.instanceId)
        return y != null ? { ...s, ...yFields(y, bodyH) } : s
      }),
    }
    return true
  }

  /**
   * If this column's stored absolute Ys are a top-of-bay header stack, clear them
   * so equal-flex can redistribute (then a later sync can freeze healthy tops).
   */
  function healCollapsedColumnYs(col: number): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    const sorted = sectionsInColumn(col).filter((s) => s.y != null)
    if (sorted.length < 2) return false
    const bodyH =
      columnBodyHeightByCol.value[col] ??
      columnBodyEl(col)?.getBoundingClientRect().height ??
      0
    const headerH = measureHeaderHeight(sorted[0]?.instanceId)
    const ys = sorted.map((s) => s.y ?? 0)
    if (!columnYsLookStacked(ys, bodyH, headerH)) return false
    activeLayout.value = {
      ...layout,
      sections: layout.sections.map((s) => {
        if (s.anchorColumn !== col) return s
        const { y: _y, yRatio: _yr, height: _h, ...rest } = s
        return rest
      }),
    }
    persistActiveLayout(activeLayout.value)
    return true
  }

  /**
   * Capture current header tops into `y` so later removes/moves keep visual positions.
   * Rejects / repairs collapsed snapshots so reload & layout refresh cannot lock a
   * header stack at the top of each bay.
   * @returns true when the column now has usable absolute Ys
   */
  function syncColumnYsFromDom(col: number): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    const body = columnBodyEl(col)
    if (!body) return false
    const bodyH = Math.round(body.getBoundingClientRect().height)
    const bodyTop = body.getBoundingClientRect().top
    const headerH = measureHeaderHeight()
    const measured: { id: string; y: number }[] = []
    for (const s of layout.sections) {
      if (s.anchorColumn !== col) continue
      const el = document.querySelector(
        `[data-ws-instance="${CSS.escape(s.instanceId)}"]`,
      ) as HTMLElement | null
      if (!el) continue
      measured.push({
        id: s.instanceId,
        y: Math.max(0, Math.round(el.getBoundingClientRect().top - bodyTop)),
      })
    }
    if (!measured.length) return false

    const ys = measured.map((m) => m.y)
    if (columnYsLookStacked(ys, bodyH, headerH)) {
      // Prefer mathematical even spacing over writing a bad stack into the layout.
      return assignEvenColumnYs(col, bodyH)
    }

    const yById = new Map(measured.map((m) => [m.id, m.y]))
    activeLayout.value = {
      ...layout,
      sections: layout.sections.map((s) => {
        const y = yById.get(s.instanceId)
        return y != null ? { ...s, ...yFields(y, bodyH) } : s
      }),
    }
    return true
  }

  /** True when any header in this column still lacks a resolvable Y (equal-flex). */
  function columnHasUnsetYs(col: number): boolean {
    const layout = activeLayout.value
    if (!layout) return false
    const bodyH = columnBodyHeightByCol.value[col] ?? 0
    return layout.sections.some(
      (s) => s.anchorColumn === col && effectiveSectionY(s, bodyH) == null,
    )
  }

  /**
   * Freeze equal-flex columns to absolute Y once. Needed before any header in the
   * column gets a `y` — otherwise buildDisplayBays packs null-y siblings into a
   * stacked clump (seen when dragging an empty divider into/across a bay).
   */
  function ensureColumnAbsoluteYs(col: number) {
    if (!columnHasUnsetYs(col)) return
    if (syncColumnYsFromDom(col)) return
    const bodyH =
      columnBodyHeightByCol.value[col] ??
      columnBodyEl(col)?.getBoundingClientRect().height ??
      0
    assignEvenColumnYs(col, bodyH)
  }

  function clientYToColumnY(col: number, clientY: number): number {
    const body = columnBodyEl(col)
    if (!body) return Math.max(0, clientY)
    const rect = body.getBoundingClientRect()
    // Keep full header above the bay floor (and bottom bar). A fixed -20px was
    // too small when --bay-scale grows the header, so floor-parked ESSA dividers
    // (CTR DEP / TAXIWAY DEP) spilled onto the bottom bar.
    const headerH = measureHeaderHeight()
    const maxY = Math.max(0, rect.height - headerH)
    return Math.max(0, Math.min(maxY, clientY - rect.top))
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
      const last = sorted.length ? sorted[sorted.length - 1] : undefined
      const desired = last ? (last.y ?? 0) + headerH : 0
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
    const bodyH =
      columnBodyHeightByCol.value[col] ??
      columnBodyEl(col)?.getBoundingClientRect().height ??
      0

    const placed = layout2.sections.map((s) =>
      s.instanceId === instanceId ? { ...s, anchorColumn: col, ...yFields(y, bodyH) } : s,
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
    const col =
      activeLayout.value?.sections.find((s) => s.instanceId === instanceId)
        ?.anchorColumn ?? null
    // Freeze strip auto-fit + overflow pack while Y churns every pointermove
    beginSectionLayoutDrag(col)
    // Drop any already-queued pack so it cannot apply mid-drag
    if (overflowRepackRaf) {
      cancelAnimationFrame(overflowRepackRaf)
      overflowRepackRaf = 0
    }
    overflowRepackDeferred = true
  }

  function endSectionDrag() {
    draggingSectionId.value = null
    // Clear drag lock first so scheduleOverflowRepack is not deferred again
    endSectionLayoutDrag({ notify: false })
    overflowRepackDeferred = false
    scheduleOverflowRepack()
    // After the deferred pack rAF — one auto-fit with final primaryCounts
    requestAnimationFrame(() => {
      notifyAutoFitLayoutChanged()
    })
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

  /** ESSA Direct Transfer divider (green segmented header). Multiple instances allowed. */
  function addDtransDivider(variant: DtransVariantId, column: number) {
    const layout = activeLayout.value
    if (!layout) return
    const col = Math.min(layout.columnCount - 1, Math.max(0, column))
    const sec: WorkspaceSection = {
      instanceId: newInstanceId('dtrans'),
      sectionId: null,
      anchorColumn: col,
      stripSize: 'normal',
      sortFlow: getDefaultSortFlow(),
      dtrans: variant,
    }
    activeLayout.value = {
      ...layout,
      sections: insertSectionWithoutOverlap(sec, layout.sections),
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
    const store = useEfsStore()
    const isRwy = isEssaDynamicRunwaySectionId(sectionId)
    const catalogMode = store.saabLayoutsMode && !store.essaRolesMode ? 'saab' : 'essa'
    // Same YAML id, different catalog title (INBOUND APP ↔ TWR combined; TMA ↔ CTR) —
    // retitle in place instead of no-oping.
    const existing = layout.sections.find((s) => s.sectionId === sectionId)
    if (existing) {
      const anno = annotateCatalogSection(sectionId, title, catalogMode)
      const sameTitle =
        (existing.title || '').trim().toUpperCase() ===
        (anno.title ?? title).trim().toUpperCase()
      const sameGroup = (existing.groupId || '') === (anno.groupId || '')
      const sameMember = (existing.member || '') === (anno.member || '')
      if (sameTitle && sameGroup && sameMember) return
      activeLayout.value = {
        ...layout,
        sections: layout.sections.map((s) =>
          s.instanceId === existing.instanceId
            ? {
                ...s,
                title: anno.title ?? title,
                groupId: anno.groupId,
                member: anno.member,
                members: undefined,
              }
            : s,
        ),
      }
      persistActiveLayout(activeLayout.value)
      return
    }
    // Place TMA in the same column as CTR / CTR ARR / CTR DEP when possible
    let col = column
    if (catalogMode === 'saab' && sectionId === 'tma') {
      const ctrCol = layout.sections.find((s) => {
        const t = (s.title || '').toUpperCase().trim()
        return (
          t === 'CTR' ||
          t === 'CTR ARR' ||
          t === 'CTR DEP' ||
          s.groupId === 'saab_ctr' ||
          (s.groupId === 'saab_ctr_tma' && s.member === 'ctr') ||
          s.sectionId === 'ctr_arr' ||
          s.sectionId === 'ctr_dep'
        )
      })?.anchorColumn
      if (ctrCol != null) col = ctrCol
    }
    col = isRwy
      ? preferredRunwayColumn(layout, serverLayout, sectionId)
      : Math.min(layout.columnCount - 1, Math.max(0, col))
    const nextClosed = new Set(closedSectionIds.value)
    nextClosed.delete(sectionId)
    closedSectionIds.value = nextClosed
    if (isRwy) {
      const nextManual = new Set(manuallyAddedRunwayIds.value)
      nextManual.add(sectionId)
      manuallyAddedRunwayIds.value = nextManual
    }
    const anno = annotateCatalogSection(sectionId, title, catalogMode)
    const resolvedTitle = anno.title ?? title
    const sec: WorkspaceSection = {
      // Match server/YAML sections: stable instanceId === sectionId
      instanceId: sectionId,
      sectionId,
      title: resolvedTitle,
      groupId: anno.groupId,
      member: anno.member,
      anchorColumn: col,
      stripSize:
        catalogMode === 'essa'
          ? defaultEssaStripSize(sectionId, resolvedTitle)
          : 'normal',
      sortFlow:
        preferredSortFlowForWorkspaceSection({
          sectionId,
          title: resolvedTitle,
          groupId: anno.groupId,
          member: anno.member,
        }) ?? getDefaultSortFlow(),
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

    // One header per logical sectionId across the whole board (corrupt saves /
    // older catalog bugs could leave two CD or two INBOUND APP).
    const seenSectionIds = new Set<string>()

    const cols: Bay[] = []
    for (let c = 0; c < layout.columnCount; c++) {
      const sorted = sectionsInColumn(c).filter((s) => {
        if (s.sectionId) {
          if (seenSectionIds.has(s.sectionId)) return false
          seenSectionIds.add(s.sectionId)
        }
        // ESSA: never show bare "INBOUND" — drop orphan when server hid it (e.g. APP)
        // or when the title would still be the YAML placeholder.
        if (s.sectionId !== 'inbound') return true
        const wsTitle = (s.title || '').trim().toUpperCase()
        const isTwrForm =
          s.groupId === 'inbound_twr' || /^INBOUND\s+TWR\b/.test(wsTitle)
        const serverSec = findServerSection(serverLayout, 'inbound')
        // APP role hides INBOUND APP on the server; keep an explicit TWR-* catalog
        // placement, but drop APP / bare orphans.
        if (!serverSec) return isTwrForm
        const live = (serverSec.title || s.title || '').trim().toUpperCase()
        return live !== '' && live !== 'INBOUND'
      })
      // Prefer observed height; fall back to live DOM so first paint still clamps.
      let bodyH = columnBodyHeightByCol.value[c] ?? 0
      if (bodyH <= 0) {
        const live = columnBodyEl(c)?.clientHeight ?? 0
        if (live > 0) bodyH = live
      }
      const useY = sorted.some((s) => effectiveSectionY(s, bodyH) != null)
      // If absolute Y is in use, coerce missing/overlapping tops so headers never share pixels.
      // Null-y siblings must NOT pack to header-only gaps (that stacked whole columns when an
      // empty divider first introduced a `y` into an equal-flex bay) — keep a section-sized step.
      // If stored Ys are a top-of-bay header clump, fall back to equal-flex (heal runs on body size).
      let tops: number[] | null = null
      if (useY) {
        const headerH = measureHeaderHeight()
        const nullStep = Math.max(headerH, WORKSPACE_MIN_SECTION_H)
        let prev = -headerH
        let packed = sorted.map((s) => {
          let y = effectiveSectionY(s, bodyH)
          if (y == null) y = prev + nullStep
          else if (y < prev + headerH) y = prev + headerH
          prev = y
          return y
        })
        // Stale absolute Ys (saved on a taller window) must not push headers past
        // the bay floor / under the bottom bar.
        if (bodyH > 0 && packed.length > 0) {
          const maxAllowed = Math.max(0, bodyH - headerH)
          const maxTop = Math.max(...packed)
          if (maxTop > maxAllowed && maxTop > 0) {
            const scale = maxAllowed / maxTop
            packed = packed.map((t) => Math.round(t * scale))
          }
        }
        tops = columnYsLookStacked(packed, bodyH, headerH) ? null : packed
      }
      const colSections = sorted.map((s, i): Section => {
        let height = s.height
        if (tops && i < sorted.length - 1) {
          const a = tops[i]
          const b = tops[i + 1]
          height = a != null && b != null ? Math.max(0, b - a) : height
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
        // Runway + GND peer lists stay live from the server. INBOUND APP vs
        // INBOUND TWR-E,TWR-W share YAML id `inbound` — keep the workspace
        // catalog title so the server role retitle cannot turn TWR into APP.
        const liveServerTitle =
          s.sectionId === 'inbound_gnd' ||
          s.sectionId.startsWith('inbound_twr') ||
          s.sectionId.startsWith('inbound_gnd_') ||
          isEssaDynamicRunwaySectionId(s.sectionId)
        let title = liveServerTitle
          ? (serverSec?.title ?? s.title ?? s.sectionId)
          : (s.title ?? serverSec?.title ?? s.sectionId)
        if (s.sectionId === 'inbound') {
          const wsU = (s.title || '').trim().toUpperCase()
          const isTwrForm =
            s.groupId === 'inbound_twr' || /^INBOUND\s+TWR\b/.test(wsU)
          if (isTwrForm) {
            // Prefer live peer list when server is in GND-only TWR form
            const srv = (serverSec?.title || '').trim()
            title =
              srv.toUpperCase().startsWith('INBOUND TWR')
                ? srv
                : s.title || 'INBOUND TWR-E, TWR-W'
          } else if (wsU === 'INBOUND APP' || !wsU || wsU === 'INBOUND') {
            title = 'INBOUND APP'
          } else {
            title = s.title || serverSec?.title || 'INBOUND APP'
          }
        }
        // ESSA safety: never paint the empty placeholder label
        if (
          s.sectionId === 'inbound' &&
          (title || '').trim().toUpperCase() === 'INBOUND'
        ) {
          title = 'INBOUND APP'
        }
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
    opts?: { mode?: 'essa' | 'saab' },
  ): {
    sectionId: string
    title: string
    present: boolean
    flow?: 'arrival' | 'departure'
  }[] {
    const mode = opts?.mode ?? 'essa'
    const store = useEfsStore()
    const presentIds = new Set(
      (activeLayout.value?.sections ?? []).map((s) => s.sectionId).filter(Boolean) as string[],
    )
    // DEP header covers both pending_dep and cleared
    if (presentIds.has('pending_dep') || presentIds.has('cleared')) {
      presentIds.add('pending_dep')
      presentIds.add('cleared')
    }
    // Also treat server layout sections as present when workspace layout is empty
    if (presentIds.size === 0) {
      for (const bay of serverLayout.bays) {
        for (const sec of bay.sections) presentIds.add(sec.id)
      }
      if (presentIds.has('pending_dep') || presentIds.has('cleared')) {
        presentIds.add('pending_dep')
        presentIds.add('cleared')
      }
    }
    const serverTitle = new Map<string, string>()
    for (const bay of serverLayout.bays) {
      for (const sec of bay.sections) {
        if (!serverTitle.has(sec.id)) serverTitle.set(sec.id, sec.title)
      }
    }
    const out: {
      sectionId: string
      title: string
      present: boolean
      flow?: 'arrival' | 'departure'
    }[] = []
    const seen = new Set<string>()
    const push = (sectionId: string, title: string, flow?: 'arrival' | 'departure') => {
      // Allow same sectionId with different titles (ESSA TMA ARR vs CTR ARR; OTHER DEP vs PENDING CLR)
      const seenKey = `${sectionId}::${title}`
      if (seen.has(seenKey)) return
      // YAML placeholders — physical pairs are listed separately
      if (mode === 'essa' && (sectionId === 'arr_runway' || sectionId === 'dep_runway')) return
      seen.add(seenKey)
      // Prefer catalog title for fixed labels (never inherit live YAML / retitled names)
      const essaAirDividerTitle =
        title === 'TMA' ||
        title === 'TMA ARR' ||
        title === 'TMA DEP' ||
        title === 'CTR' ||
        title === 'CTR ARR' ||
        title === 'CTR DEP'
      const preferCatalog =
        (mode === 'saab' &&
          (sectionId === 'pending_dep' ||
            sectionId === 'cleared' ||
            sectionId === 'ctr_arr' ||
            sectionId === 'tma' ||
            sectionId === 'ctr' ||
            sectionId === 'taxi' ||
            sectionId === 'push_start')) ||
        (mode === 'essa' &&
          ((sectionId === 'ctr_arr' || sectionId === 'ctr_dep') && essaAirDividerTitle)) ||
        (mode === 'essa' &&
          (title === 'CD ALL' ||
            title === 'INBOUND APP' ||
            title === 'INBOUND TWR-E, TWR-W' ||
            title.startsWith('INBOUND TWR-') ||
            title.startsWith('INBOUND GND') ||
            title === 'INBOUND ACC' ||
            title === 'TSAT / EOBT' ||
            title === 'TSAT' ||
            title === 'EOBT'))
      // TMA / CTR / DEP cover multiple server ids — overridden below for saab specials
      let present = presentIds.has(sectionId)
      if (mode === 'saab' && sectionId === 'ctr_arr' && title === 'TMA / CTR') {
        present =
          presentIds.has('ctr_arr') ||
          presentIds.has('ctr_dep') ||
          presentIds.has('tma') ||
          presentIds.has('ctr')
      }
      if (mode === 'saab' && sectionId === 'pending_dep' && title === 'DEP') {
        present = presentIds.has('pending_dep') || presentIds.has('cleared')
      }
      // ESSA: TMA vs CTR share YAML ids — grey by title family, not bare sectionId
      if (
        mode === 'essa' &&
        (sectionId === 'ctr_arr' || sectionId === 'ctr_dep') &&
        essaAirDividerTitle
      ) {
        const wsSecs = activeLayout.value?.sections ?? []
        const wantTma = title.startsWith('TMA')
        const wantCtr = title.startsWith('CTR')
        const matchesFamily = (s: { title?: string; groupId?: string; member?: string; sectionId?: string | null }) => {
          const tu = (s.title || '').toUpperCase().replace(/\s+/g, ' ').trim()
          if (wantTma) {
            if (s.groupId === 'essa_tma') return true
            return tu === 'TMA' || tu.startsWith('TMA ')
          }
          if (wantCtr) {
            if (s.groupId === 'essa_ctr') return true
            return tu === 'CTR' || tu.startsWith('CTR ')
          }
          return false
        }
        if (title === 'TMA' || title === 'CTR') {
          // Merged header present, or both ARR+DEP slices of that family
          const fam = wsSecs.filter(matchesFamily)
          const hasMerged = fam.some((s) => !s.member)
          const hasArr = fam.some(
            (s) => s.member === 'arr' || (s.sectionId === 'ctr_arr' && !!s.member),
          )
          const hasDep = fam.some(
            (s) => s.member === 'dep' || (s.sectionId === 'ctr_dep' && !!s.member),
          )
          present = hasMerged || (hasArr && hasDep)
        } else if (title.endsWith(' ARR')) {
          present = wsSecs.some(
            (s) =>
              matchesFamily(s) &&
              (s.member === 'arr' ||
                !s.member ||
                (s.sectionId === 'ctr_arr' && !!s.member)),
          )
        } else if (title.endsWith(' DEP')) {
          present = wsSecs.some(
            (s) =>
              matchesFamily(s) &&
              (s.member === 'dep' ||
                !s.member ||
                (s.sectionId === 'ctr_dep' && !!s.member)),
          )
        }
      }
      // ESSA: inbound APP vs combined TWR share YAML id — grey by catalog title
      if (mode === 'essa' && sectionId === 'inbound') {
        const wsSecs = activeLayout.value?.sections ?? []
        const inbound = wsSecs.find((s) => s.sectionId === 'inbound')
        if (!inbound) {
          present = false
        } else {
          const tu = (inbound.title || '').toUpperCase().replace(/\s+/g, ' ').trim()
          const onBoardIsTwr =
            inbound.groupId === 'inbound_twr' || /^INBOUND\s+TWR\b/.test(tu)
          if (title === 'INBOUND APP') present = !onBoardIsTwr
          else if (title === 'INBOUND TWR-E, TWR-W' || title.startsWith('INBOUND TWR'))
            present = onBoardIsTwr
          else present = true
        }
      }
      // ESSA: CD ALL covers standalone CD (pending_dep) on the board
      if (mode === 'essa' && sectionId === 'pending_dep' && title === 'CD ALL') {
        present = presentIds.has('pending_dep')
      }
      out.push({
        sectionId,
        title: preferCatalog ? title : (serverTitle.get(sectionId) ?? title),
        present,
        ...(flow ? { flow } : {}),
      })
    }
    if (mode === 'saab') {
      const wsSections = activeLayout.value?.sections ?? []
      const titleU = (s: { title?: string }) => (s.title || '').toUpperCase().trim()
      const titleCompact = (s: { title?: string }) => titleU(s).replace(/\s+/g, '')
      const hasTmaOnBoard =
        presentIds.has('tma') ||
        wsSections.some((s) => {
          const t = titleCompact(s)
          return (
            s.sectionId === 'tma' ||
            (s.groupId === 'saab_ctr_tma' && s.member === 'tma') ||
            t === 'TMA/CTR' ||
            t === 'CTR/TMA'
          )
        })
      const hasCtrOnBoard =
        presentIds.has('ctr_arr') ||
        presentIds.has('ctr_dep') ||
        presentIds.has('ctr') ||
        wsSections.some((s) => {
          const t = titleU(s)
          if (t === 'CTR' || t === 'CTR ARR' || t === 'CTR DEP') return true
          if (s.groupId === 'saab_ctr') return true
          if (s.groupId === 'saab_ctr_tma' && s.member === 'ctr') return true
          return false
        })
      const hasDepMerged = wsSections.some((s) => {
        if (titleU(s) !== 'DEP') return false
        return (
          s.sectionId === 'pending_dep' ||
          s.sectionId === 'cleared' ||
          s.groupId === 'saab_clearance'
        )
      })
      const hasPendingClr =
        hasDepMerged ||
        presentIds.has('pending_dep') ||
        wsSections.some(
          (s) =>
            s.sectionId === 'pending_dep' ||
            (s.groupId === 'saab_clearance' && s.member === 'pending'),
        )
      const hasCleared =
        hasDepMerged ||
        presentIds.has('cleared') ||
        wsSections.some(
          (s) =>
            s.sectionId === 'cleared' ||
            (s.groupId === 'saab_clearance' && s.member === 'cleared'),
        )
      // Empty divider is first in the menu (TopBar). Then arr↓ / shared / dep↑ (DEP last).
      for (const entry of SAAB_CATALOG_SECTIONS) {
        push(entry.sectionId, entry.title, entry.flow)
        // Physical runway_* directly under RUNWAY
        if (entry.sectionId === 'runway') {
          for (const rwy of store.saabRunwayCatalog) {
            push(rwy.sectionId, rwy.title, 'arrival')
          }
        }
      }
      // TMA: always listed; addable only when CTR is on the board and TMA is not
      const tmaIdx = out.findIndex((e) => e.sectionId === 'tma' && e.title === 'TMA')
      if (tmaIdx >= 0) {
        out[tmaIdx]!.present = !hasCtrOnBoard || hasTmaOnBoard
        out[tmaIdx]!.title = 'TMA'
      }
      // CTR: always listed; greyed when any CTR / CTR ARR / CTR DEP / TMA·CTR is present
      const ctrIdx = out.findIndex((e) => e.sectionId === 'ctr' && e.title === 'CTR')
      if (ctrIdx >= 0) {
        out[ctrIdx]!.present = hasCtrOnBoard
        out[ctrIdx]!.title = 'CTR'
      }
      // DEP / PENDING CLR / CLEARED — greyed when already on the board (or covered by merge)
      const depIdx = out.findIndex((e) => e.sectionId === 'pending_dep' && e.title === 'DEP')
      if (depIdx >= 0) {
        out[depIdx]!.present = hasPendingClr || hasCleared
        out[depIdx]!.title = 'DEP'
      }
      const pendingClrIdx = out.findIndex(
        (e) => e.sectionId === 'pending_dep' && e.title === 'PENDING CLR',
      )
      if (pendingClrIdx >= 0) {
        out[pendingClrIdx]!.present = hasPendingClr
        out[pendingClrIdx]!.title = 'PENDING CLR'
      }
      const clearedIdx = out.findIndex((e) => e.sectionId === 'cleared' && e.title === 'CLEARED')
      if (clearedIdx >= 0) {
        out[clearedIdx]!.present = hasCleared
        out[clearedIdx]!.title = 'CLEARED'
      }
    } else {
      for (const entry of ESSA_CATALOG_SECTIONS) {
        // Never list bare YAML "CD" / "INBOUND" — catalog has CD ALL + INBOUND APP / TWR
        const t = entry.title.trim().toUpperCase()
        if (t === 'CD' || t === 'INBOUND') continue
        push(entry.sectionId, entry.title)
      }
      // Physical runway pairs only — do NOT dump server bay sections (YAML titles
      // like bare "CD" / "INBOUND" duplicated catalog entries and confused the menu).
      for (const pair of ESSA_PHYSICAL_RWY_PAIRS) {
        push(essaRunwaySectionId(pair), formatEssaRunwaySectionTitle(pair))
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

  function clearWorkspace(opts?: { clearPersisted?: boolean }) {
    activeLayout.value = null
    layoutDialogOpen.value = false
    // Keep lastRoleKey / layoutPromptConfirmedFor so a mode flicker doesn't re-prompt
    if (opts?.clearPersisted) {
      // YAML config changed — drop all role/profile working boards
      clearActiveLayouts()
    } else {
      // Leave workspace mode: keep per-role activeByRoleKey so sortFlow restores
      persistActiveLayout(null)
    }
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
    pendingSaabSavedLayout,
    closedSectionIds,
    draggingSectionId,
    ensureFromServer,
    onRolesChanged,
    applyLayout,
    previewLayout,
    applyBuiltInDefault,
    previewBuiltInDefault,
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
    healCollapsedColumnYs,
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
    addDtransDivider,
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

/** Watch roles / OTHER profile — call once from bay container. */
export function watchEssaRolesForWorkspace(
  rolesRef: Ref<string[]>,
  serverLayoutRef: Ref<EfsLayout>,
  essaRolesMode: Ref<boolean>,
  workspaceMode?: Ref<boolean>,
  saabLayoutId?: Ref<string | null>,
) {
  const ws = getWorkspace()
  const inWorkspace = () => (workspaceMode ? workspaceMode.value : essaRolesMode.value)

  // ESSA: role changes prompt the layout dialog
  watch(
    [essaRolesMode, () => essaRoleKey(rolesRef.value)],
    ([mode, key], [prevMode, prevKey]) => {
      if (!mode) return
      if (!serverLayoutRef.value.bays.length) return
      if (key !== prevKey || (mode && !prevMode)) {
        ws.onRolesChanged(serverLayoutRef.value, rolesRef.value)
      } else if (!ws.activeLayout.value) {
        ws.ensureFromServer(serverLayoutRef.value, rolesRef.value)
      }
    },
    { immediate: true },
  )

  const store = useEfsStore()

  // Drop local workspace when the YAML config file changes (OTHER↔ESSA↔RTC, …)
  watch(
    () => store.activeConfig,
    (file, prev) => {
      if (prev && file && file !== prev) {
        ws.clearWorkspace({ clearPersisted: true })
      }
    },
  )

  // OTHER: persist outgoing profile; do not rebuild here — server bays are often
  // still the previous profile until refresh+layout arrive (see serverLayout watch).
  if (saabLayoutId) {
    watch(
      saabLayoutId,
      (id, prev) => {
        if (!inWorkspace() || essaRolesMode.value) return
        if (!id) return
        if (id !== prev && ws.activeLayout.value) {
          persistActiveLayout(ws.activeLayout.value)
        }
        // Initial mount / empty board only — never stamp a new profile onto stale bays
        if (!ws.activeLayout.value && serverLayoutRef.value.bays.length) {
          ws.ensureFromServer(serverLayoutRef.value, [], {
            saabProfileId: id,
          })
        }
      },
      { immediate: true },
    )
  }

  watch(
    () => inWorkspace(),
    (mode) => {
      if (!mode) {
        ws.clearWorkspace()
        return
      }
      // Only build when we have no workspace yet — never from a stale pre-refresh layout
      if (
        serverLayoutRef.value.bays.length &&
        !ws.activeLayout.value &&
        !essaRolesMode.value
      ) {
        ws.ensureFromServer(serverLayoutRef.value, [])
      }
    },
    { immediate: true },
  )

  watch(serverLayoutRef, (layout, prev) => {
    if (!inWorkspace() || !layout.bays.length) return
    if (!ws.activeLayout.value) {
      ws.ensureFromServer(layout, essaRolesMode.value ? rolesRef.value : [])
    } else if (essaRolesMode.value) {
      // ES RWY config / assigned-pair headers — keep workspace runway dividers in sync
      ws.syncRunwaySectionsFromServer(layout)
    } else if (store.saabLayoutsMode) {
      // Profile switch clears bays then loads the new map — always resync after that
      // (roleKey may already match from saabLayoutId updating before layout arrives).
      const profileId = store.saabLayoutId || '1rwy4'
      const roleKey = `saab:${profileId}`
      const afterRefresh = !(prev?.bays?.length) && layout.bays.length > 0
      const baySig = (l: EfsLayout) =>
        l.bays.map((b) => b.sections.map((s) => s.id).join(',')).join('|')
      const structureChanged = !!prev?.bays?.length && baySig(prev) !== baySig(layout)
      if (
        afterRefresh ||
        structureChanged ||
        ws.activeLayout.value.roleKey !== roleKey
      ) {
        if (ws.activeLayout.value && ws.activeLayout.value.roleKey !== roleKey) {
          persistActiveLayout(ws.activeLayout.value)
        }
        ws.ensureFromServer(layout, [], {
          saabProfileId: profileId,
          // Fresh server bays after switch — rebuild from server (or pending saved)
          resync: afterRefresh || structureChanged,
        })
      }
    }
  })
}
