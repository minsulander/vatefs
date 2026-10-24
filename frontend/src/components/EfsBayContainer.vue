<template>
  <div
    ref="containerEl"
    class="efs-bay-container"
    :class="{ 'efs-bay-container--paper': store.isPaperLook }"
    @click="onContainerClick"
  >
    <EfsTopBar />
    <div
      ref="scrollEl"
      class="efs-bay-content"
      :class="{ 'efs-bay-content--table-scroll': tableScroll }"
    >
      <div
        class="bay-row"
        :class="{
          'bay-row--multi': store.multiAirport,
          'bay-row--choosing': store.pendingIdleSwap != null,
          'bay-row--paper': store.isPaperLook,
          'bay-row--workspace': store.workspaceMode && !!ws.activeLayout.value,
          'bay-row--table-scroll': tableScroll,
        }"
        :style="tableScroll ? { '--efs-bay-col-width': colWidthPx } : undefined"
      >
        <div
          v-for="(bay, index) in bays"
          :key="bay.id"
          class="bay-column"
          :class="{
            'bay-column--multi': store.multiAirport,
            'bay-column--empty': store.multiAirport && !store.columnAirports[index],
            'bay-column--swap-target': store.pendingIdleSwap != null,
            'bay-column--flash': store.flashingColumnIndex === index,
            'bay-column--paper': store.isPaperLook,
            'bay-column--workspace': store.workspaceMode && !!ws.activeLayout.value,
            'bay-column--table-fixed': tableScroll,
            'bay-column--klack-raised': bayHasKlack(bay.id, index),
          }"
          :style="store.multiAirport ? { '--bay-accent': columnAccent(index) } : undefined"
          @click="onColumnClick(index, $event)"
        >
          <div
            v-if="store.pendingIdleSwap"
            class="swap-overlay"
          >
            <span class="swap-overlay-label">{{ store.pendingIdleSwap }}</span>
            <span class="swap-overlay-hint">click to place</span>
          </div>
          <EfsBay
            :bay="bay"
            :column-index="index"
            :workspace-mode="store.workspaceMode && !!ws.activeLayout.value"
          />
        </div>
      </div>
    </div>
    <EfsBottomBar />
    <HandoverAssistantDialog
      :model-value="store.handoverAssistantOpen"
      :preferred-frequency="store.handoverAssistantPreferredFreq"
      @update:model-value="onHandoverAssistantOpen"
    />
    <WorkspaceLayoutDialog v-if="store.essaRolesMode" />
    <SaabLayoutDialog v-if="store.saabLayoutsMode" />
    <WorkspaceSearchDialog
      v-if="store.workspaceMode"
      v-model="searchDialogOpen"
    />
    <div
      v-if="store.notifyVisible"
      class="efs-notify"
      :class="store.notifyLevel === 'error' ? 'efs-notify--error' : 'efs-notify--info'"
      @click="store.dismissNotify()"
    >{{ store.notifyText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEfsStore } from '@/store/efs'
import { paperKlackPullBayIds } from '@/composables/paperKlack'
import { getWorkspace, watchEssaRolesForWorkspace } from '@/workspace'
import { serverBayIdForSection, stripSectionIdsForWorkspace } from '@/workspace/defaultLayout'
import { workspaceMemberAcceptsStrip } from '@/workspace/splitGroups'
import EfsBay from './EfsBay.vue'
import EfsTopBar from './EfsTopBar.vue'
import EfsBottomBar from './EfsBottomBar.vue'
import HandoverAssistantDialog from './HandoverAssistantDialog.vue'
import WorkspaceLayoutDialog from './WorkspaceLayoutDialog.vue'
import SaabLayoutDialog from './SaabLayoutDialog.vue'
import WorkspaceSearchDialog from './WorkspaceSearchDialog.vue'

const store = useEfsStore()
const ws = getWorkspace()
const { essaRoles, layout, essaRolesMode, workspaceMode, saabLayoutId } = storeToRefs(store)
watchEssaRolesForWorkspace(essaRoles, layout, essaRolesMode, workspaceMode, saabLayoutId)

const searchDialogOpen = ws.searchDialogOpen

const bays = computed(() => {
  if (store.workspaceMode && ws.activeLayout.value) {
    return ws.buildDisplayBays(store.layout)
  }
  return store.getBays
})
const containerEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const colWidthPx = ref('25%')

/** Same ref width / clamps as EfsBay --bay-scale (strips follow column width). */
const BAY_REF_WIDTH_PX = 400
const BAY_SCALE_MIN = 0.55
const BAY_SCALE_MAX = 2.2
const BAY_GUTTER_AT_SCALE_1_PX = 8

/** SAAB inter-bay gutter tracks strip scale (column width / 400). */
function updateBayGutterScale() {
  const root = containerEl.value
  if (!root || store.isPaperLook) return
  const col = root.querySelector('.bay-column') as HTMLElement | null
  const w = col?.clientWidth ?? 0
  if (w <= 0) return
  const s = Math.max(BAY_SCALE_MIN, Math.min(BAY_SCALE_MAX, w / BAY_REF_WIDTH_PX))
  root.style.setProperty('--efs-bay-gutter', `${Math.round(BAY_GUTTER_AT_SCALE_1_PX * s * 10) / 10}px`)
}

function onHandoverAssistantOpen(open: boolean) {
  if (open) store.openHandoverAssistant()
  else store.closeHandoverAssistant()
}

/**
 * Any strip in this column is klacked/cocked (or mid-pull) — raise above neighbours
 * so the strip can paint over the bay gutter.
 * Workspace columns use synthetic ids (`ws-col-N`) while strips keep server bayIds,
 * so match by workspace section membership in that column.
 */
function bayHasKlack(bayId: string, columnIndex: number): boolean {
  void store.stripsVersion
  void paperKlackPullBayIds.size
  void ws.activeLayout.value
  if (paperKlackPullBayIds.has(bayId)) return true

  if (store.workspaceMode && ws.activeLayout.value) {
    const colSecs = ws.sectionsInColumn(columnIndex)
    // Mid-pull registers server bayId on paperKlackPullBayIds — map to this column
    for (const pullId of paperKlackPullBayIds) {
      if (pullId === bayId) return true
      for (const sec of colSecs) {
        const sid = sec.sectionId || sec.instanceId
        if (sid && serverBayIdForSection(store.layout, sid) === pullId) return true
      }
    }
    for (const strip of store.strips.values()) {
      if (strip.klack !== 'left' && strip.klack !== 'right') continue
      for (const sec of colSecs) {
        const logicalId = sec.sectionId || sec.instanceId
        const ids = stripSectionIdsForWorkspace(logicalId, {
          member: sec.member,
          groupId: sec.groupId,
        })
        const inSection =
          ids.includes(strip.sectionId) || strip.sectionId === sec.instanceId
        if (!inSection) continue
        if (
          workspaceMemberAcceptsStrip(
            {
              groupId: sec.groupId,
              member: sec.member,
              sectionId: logicalId,
            },
            strip,
          )
        ) {
          return true
        }
      }
    }
    return false
  }

  for (const strip of store.strips.values()) {
    if (strip.bayId === bayId && (strip.klack === 'left' || strip.klack === 'right')) {
      return true
    }
  }
  return false
}

const visibleCols = computed(() => {
  const n = store.esggVisibleColumns
  return n >= 2 && n <= 5 ? n : 4
})

/**
 * Physical strip table: column width = window / visibleCols (2–5);
 * scrollbar pans when more bays exist (layout/roles unchanged).
 */
const tableScroll = computed(() => store.isPaperLook && store.esggRolesMode)

/**
 * Covering GND on a 5-col board (GND/CD staffed with TWR): pan so INBOUND
 * is one column off-screen. Solo TWR covering GND stays 4-col — no pan.
 */
const panHideInbound = computed(() => {
  if (!tableScroll.value) return false
  const covering = store.esggRoles ?? []
  if (!covering.includes('GND')) return false
  if (bays.value.length < 5) return false
  return bays.value.some((b) => b.sections.some((s) => s.id === 'inbound'))
})

function measureColWidth() {
  const el = scrollEl.value
  if (!el || !tableScroll.value) {
    colWidthPx.value = `${100 / visibleCols.value}%`
    return
  }
  const w = el.clientWidth
  if (w <= 0) return
  colWidthPx.value = `${Math.floor(w / visibleCols.value)}px`
}

let applyingDefaultScroll = false

function applyDefaultScroll() {
  measureColWidth()
  const el = scrollEl.value
  if (!el || !tableScroll.value) return
  const colW = el.clientWidth / visibleCols.value
  // GND working the right side of the table: hide INBOUND, keep scroll available
  applyingDefaultScroll = true
  el.scrollLeft = panHideInbound.value ? Math.round(colW) : 0
  requestAnimationFrame(() => {
    applyingDefaultScroll = false
  })
}

let ro: ResizeObserver | null = null
let userScrolled = false

function onScroll() {
  if (applyingDefaultScroll) return
  userScrolled = true
}

onMounted(() => {
  applyDefaultScroll()
  updateBayGutterScale()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      measureColWidth()
      updateBayGutterScale()
      // Keep GND pan after resize unless the user already scrolled
      if (!userScrolled && panHideInbound.value) applyDefaultScroll()
    })
    if (scrollEl.value) ro.observe(scrollEl.value)
  }
  window.addEventListener('resize', onWindowResize)
  scrollEl.value?.addEventListener('scroll', onScroll, { passive: true })
})

function onWindowResize() {
  measureColWidth()
  updateBayGutterScale()
}

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', onWindowResize)
  scrollEl.value?.removeEventListener('scroll', onScroll)
})

watch(
  [tableScroll, bays, panHideInbound, visibleCols, () => store.esggRoles.join(',')],
  () => {
    userScrolled = false
    requestAnimationFrame(() => {
      applyDefaultScroll()
      updateBayGutterScale()
    })
  },
)

watch(
  () => store.isPaperLook,
  () => requestAnimationFrame(updateBayGutterScale),
)

function columnAccent(index: number): string {
  return store.columnAirports[index] ? store.columnColor(index) : '#616161'
}

function onColumnClick(columnIndex: number, event: MouseEvent) {
  if (!store.pendingIdleSwap) return
  event.stopPropagation()
  store.applyPendingIdleToColumn(columnIndex)
}

function onContainerClick() {
  if (store.pendingIdleSwap) store.clearPendingIdleSwap()
}
</script>

<style scoped>
.efs-bay-container {
  position: relative;
  height: 100vh;
  overflow: hidden;
  background: var(--efs-bay-bg, #3b3c41);
  display: flex;
  flex-direction: column;
  /* SAAB gutter base at bay-scale 1 (400px column); JS sets px from column width.
   * Colour: --efs-bay-gutter-color on <html> from brightness slider (useBayBackground). */
  --efs-bay-gutter: 8px;
}

.efs-bay-container--paper {
  /* Desk floor palette — mixed via soft gradients on each bay */
  --efs-paper-bay-light: #c7a778;
  --efs-paper-bay-mid-light: #ad926b;
  --efs-paper-bay-mid: #89653b;
  --efs-paper-bay-dark: #513a26;
  --efs-paper-bay-floor: var(--efs-paper-bay-mid);
  --efs-paper-panel: #2c241c;
  background: var(--efs-paper-panel);
  /* Paper pipes own the column edge — no SAAB gutter */
  --efs-bay-gutter: 0px;
}

.efs-bay-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Paper: let klack paint across column gutters (table-scroll keeps its own overflow) */
.efs-bay-container--paper .efs-bay-content:not(.efs-bay-content--table-scroll) {
  overflow: visible;
}

/* Physical table: 4 bay-widths visible; scrollbar along the bottom for bay5 */
.efs-bay-content--table-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(201, 166, 107, 0.55) rgba(0, 0, 0, 0.25);
}

.efs-bay-content--table-scroll::-webkit-scrollbar {
  height: 10px;
}

.efs-bay-content--table-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.28);
}

.efs-bay-content--table-scroll::-webkit-scrollbar-thumb {
  background: rgba(201, 166, 107, 0.55);
  border-radius: 5px;
}

.efs-bay-content--table-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(201, 166, 107, 0.75);
}

.bay-row {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
  gap: var(--efs-bay-gutter, 0);
  background-color: var(--efs-bay-gutter-color, #232428);
}

.bay-row--table-scroll {
  flex: 0 0 100%;
  height: 100%;
  width: max-content;
  min-width: 100%;
}

.bay-row--multi {
  /* Keep SAAB gutter (--efs-bay-gutter); paper zeros it via container */
  padding: 0;
  box-sizing: border-box;
}

.bay-column {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  position: relative;
}

.bay-column--table-fixed {
  flex: 0 0 var(--efs-bay-col-width, 25%);
  width: var(--efs-bay-col-width, 25%);
  min-width: var(--efs-bay-col-width, 25%);
  max-width: var(--efs-bay-col-width, 25%);
}

/* Paper: keep flush columns (no visible inter-bay gap); pipes live inside each bay */
.bay-row--paper {
  gap: 0;
  padding: 0;
}

.bay-column--paper {
  background: transparent;
  overflow: visible;
  position: relative;
  z-index: 0;
}

/* Full coloured frame around each column — multi-airport only */
.bay-column--multi {
  border: 2px solid var(--bay-accent, #444);
  border-top-width: 5px;
  border-radius: 0;
  /* Uses dimmable --efs-bay-bg from bay brightness slider */
  background: var(--efs-bay-bg, #3b3c41);
}

.bay-column--empty {
  background: color-mix(in srgb, var(--efs-bay-bg, #3b3c41) 65%, black);
}

/* ESSA workspace empty columns still need a visible bay frame */
.bay-column--workspace {
  background: var(--efs-bay-bg, #3b3c41);
}

.bay-row--choosing .bay-column--swap-target {
  cursor: pointer;
  box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.55);
  animation: swap-pulse 1.4s ease-in-out infinite;
}

.bay-row--choosing .bay-column--swap-target:hover {
  animation: none;
  box-shadow:
    inset 0 0 0 3px #90caf9,
    0 0 18px rgba(144, 202, 249, 0.35);
  background: rgba(144, 202, 249, 0.08);
  z-index: 2;
}

.bay-column--flash {
  z-index: 3;
  animation: column-flash 0.4s ease-in-out 3;
}

.swap-overlay {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(4px * var(--efs-scale, 1));
  background: rgba(8, 10, 12, 0.35);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.bay-column--swap-target:hover .swap-overlay {
  opacity: 1;
  background: rgba(25, 60, 95, 0.45);
}

.swap-overlay-label {
  color: #fff;
  font-size: calc(28px * var(--efs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.1em;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

.swap-overlay-hint {
  color: #90caf9;
  font-size: calc(12px * var(--efs-scale, 1));
  font-weight: 600;
  letter-spacing: 0.04em;
}

@keyframes swap-pulse {
  0%,
  100% {
    box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.35);
  }
  50% {
    box-shadow: inset 0 0 0 2px rgba(144, 202, 249, 0.7);
  }
}

@keyframes column-flash {
  0%,
  100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.25);
  }
}

.efs-notify {
  position: absolute;
  left: 50%;
  bottom: calc(56px * var(--efs-scale, 1));
  transform: translateX(-50%);
  z-index: 40;
  max-width: min(90vw, 520px);
  padding: calc(10px * var(--efs-scale, 1)) calc(16px * var(--efs-scale, 1));
  border-radius: 4px;
  font-size: calc(14px * var(--efs-scale, 1));
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
}

</style>

<!-- Unscoped: klack/cock raise — strip paints over bay gutter / neighbour -->
<style>
/*
 * SAAB: don't clip cocked strips at the content edge (paper already visible).
 * Gutter is bay-row gap; strip must be free to paint into that gap above it.
 */
.efs-bay-container:not(.efs-bay-container--paper) .efs-bay-content {
  overflow: visible;
}
.efs-bay-container--paper .efs-bay-content:not(.efs-bay-content--table-scroll) {
  overflow: visible !important;
}
.efs-bay-container--paper .bay-row--paper,
.efs-bay-container:not(.efs-bay-container--paper) .bay-row {
  overflow: visible;
  isolation: isolate;
}

.bay-column.bay-column--klack-raised {
  z-index: 100 !important;
  position: relative;
  overflow: visible !important;
}

/*
 * SAAB only — widen the strip list into the gutter (paper has its own bleed).
 * Bleed padding stays transparent so bay-row gutter colour remains visible;
 * only the cocked strip paints above it. Bay fill stays on section-content
 * (in-column) — never paint bay-bg into the bleed.
 */
.efs-bay-container:not(.efs-bay-container--paper) .bay-column.bay-column--klack-raised {
  --saab-cock-bleed: calc(4px + var(--efs-bay-gutter, 8px));
}
.efs-bay-container:not(.efs-bay-container--paper) .bay-column.bay-column--klack-raised .efs-bay,
.efs-bay-container:not(.efs-bay-container--paper) .bay-column.bay-column--klack-raised .bay-body,
.efs-bay-container:not(.efs-bay-container--paper) .bay-column.bay-column--klack-raised .efs-section,
.efs-bay-container:not(.efs-bay-container--paper) .bay-column.bay-column--klack-raised .section-content {
  overflow: visible !important;
}
/*
 * Bleed only the strip list — transparent over the gutter; bay fill stays in-column.
 * pointer-events:none on the bleed box so a neighbour bay's padding (same z-index
 * raise) cannot steal clicks from this bay's cocked strip in the shared gutter;
 * children (strips, gaps, flags) re-enable hits.
 */
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .top-strips-container,
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .bottom-strips-container {
  overflow-x: clip !important;
  overflow-y: auto !important;
  margin-left: calc(-1 * var(--saab-cock-bleed));
  margin-right: calc(-1 * var(--saab-cock-bleed));
  padding-left: var(--saab-cock-bleed);
  padding-right: var(--saab-cock-bleed);
  background: transparent !important;
  position: relative;
  z-index: 2;
  pointer-events: none;
}
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .top-strips-container
  > *,
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .bottom-strips-container
  > * {
  pointer-events: auto;
}
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .section-header {
  position: relative;
  z-index: 4;
}
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .flight-strip.klack-left,
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .flight-strip.klack-right,
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .flight-strip.klack-pulling,
.efs-bay-container:not(.efs-bay-container--paper)
  .bay-column.bay-column--klack-raised
  .strip-host--cocked {
  position: relative;
  z-index: 3;
}
</style>

<style scoped>
.efs-notify--info {
  background: #1565c0;
  color: #fff;
}

.efs-notify--error {
  background: #c62828;
  color: #fff;
}
</style>
