<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="workspace-layout-overlay"
      @pointerdown.self="onScrim"
    >
      <div
        class="efs-popup-menu efs-popup-menu--wide workspace-layout-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Layout"
        @pointerdown.stop
      >
        <div class="efs-popup-header">
          Layout
          <span
            v-if="loadedLayoutLabel"
            class="layout-dialog-loaded"
            :title="`Loaded: ${loadedLayoutLabel}`"
          >{{ loadedLayoutLabel }}</span>
        </div>

        <div class="efs-popup-list workspace-layout-list">
          <button
            v-for="row in layoutRows"
            :key="row.id"
            type="button"
            class="efs-popup-item efs-popup-item--start layout-pick-item"
            :class="{
              selected: selectedId === row.id,
              'is-user-default': row.isUserDefault,
            }"
            @pointerdown.prevent="selectLayout(row.id)"
          >
            <span class="layout-pick-name">{{ row.name }}</span>
            <span class="layout-pick-meta">
              <span v-if="row.isUserDefault" class="layout-default-tag">AUTO</span>
              <span class="layout-cols-tag">{{ formatColCount(row.bayCount) }}</span>
            </span>
          </button>
        </div>

        <div class="layout-actions-row">
          <button type="button" class="efs-popup-chip" @pointerdown.prevent="onSaveCurrent">Save current</button>
          <button
            type="button"
            class="efs-popup-chip"
            :disabled="!canMutateSelected"
            :title="builtinGuardTitle"
            @pointerdown.prevent="onDelete"
          >Delete</button>
          <button
            type="button"
            class="efs-popup-chip"
            :disabled="!canMutateSelected"
            :title="builtinGuardTitle"
            @pointerdown.prevent="onRename"
          >Rename</button>
          <button
            type="button"
            class="efs-popup-chip"
            :disabled="!canMakeDefault"
            :title="makeDefaultTitle"
            @pointerdown.prevent="onMakeDefault"
          >Make default</button>
          <button type="button" class="efs-popup-chip" @pointerdown.prevent="fileInput?.click()">Import</button>
          <button
            type="button"
            class="efs-popup-chip"
            :disabled="!canMutateSelected"
            :title="canMutateSelected ? 'Export the selected saved layout' : builtinGuardTitle"
            @pointerdown.prevent="onExport"
          >Export</button>
          <input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            class="layout-file-input"
            @change="onImportFile"
          />
        </div>

        <div class="workspace-layout-actions">
          <button
            type="button"
            class="efs-popup-footer workspace-layout-action"
            @pointerdown.prevent.stop="closeOnly"
          >Cancel</button>
          <button
            type="button"
            class="efs-popup-footer workspace-layout-action"
            @pointerdown.prevent.stop="onApply"
          >OK</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEfsStore } from '@/store/efs'
import { getWorkspace } from '@/workspace'
import { buildWorkspaceLayoutFromServer } from '@/workspace/defaultLayout'
import {
  buildExportPayload,
  deleteSavedLayout,
  downloadJson,
  getDefaultSortFlow,
  getUserDefaultLayoutId,
  listSavedLayouts,
  mergeImportedLayouts,
  parseImportPayload,
  renameSavedLayout,
  resolveLoadedLayoutLabel,
  saveNamedLayout,
  setUserDefaultLayout,
  workspaceSharedRevision,
} from '@/workspace/storage'
import type { WorkspaceLayout } from '@/workspace/types'

const SAAB_ROLE_PREFIX = 'saab:'
/** Single AUTO slot for all OTHER (saab.yml) layouts (not per-profile). */
const SAAB_AUTO_KEY = 'saab'

function saabRoleKey(profileId: string): string {
  return `${SAAB_ROLE_PREFIX}${profileId}`
}

function parseSaabRoleKey(roleKey: string): string | null {
  if (!roleKey.startsWith(SAAB_ROLE_PREFIX)) return null
  return roleKey.slice(SAAB_ROLE_PREFIX.length) || null
}

function builtinSaabId(profileId: string): string {
  return `builtin:saab:${profileId}`
}

function parseBuiltinSaabId(id: string): string | null {
  const p = 'builtin:saab:'
  if (!id.startsWith(p)) return null
  return id.slice(p.length) || null
}

const store = useEfsStore()
const ws = getWorkspace()
const open = ws.layoutDialogOpen
const loadedLayoutLabel = computed(() =>
  resolveLoadedLayoutLabel(ws.activeLayout.value),
)

const selectedId = ref<string>('')
const fileInput = ref<HTMLInputElement | null>(null)
const layoutBeforeOpen = ref<WorkspaceLayout | null>(null)
const profileBeforeOpen = ref<string>('')
/** Builtin id used for AUTO when no user default is set (frozen while dialog is open). */
const autoFallbackId = ref('')
/** True only after the user clicks a layout row (open must not touch the board). */
const didPick = ref(false)
/** After click → switchSaabLayout, preview when the new server bays arrive. */
const pendingPreviewProfileId = ref<string | null>(null)
/** True after switch until layout has been cleared (refresh) then refilled. */
const awaitingLayoutAfterSwitch = ref(false)
const savedTick = ref(0)

const currentProfileId = computed(() => store.saabLayoutId || '1rwy4')

const profiles = computed(() =>
  store.saabLayouts.length
    ? store.saabLayouts
    : [
        { id: '1rwy3', name: '1RWY', bayCount: 3 },
        { id: '1rwy4', name: '1RWY', bayCount: 4 },
        { id: '2rwy4', name: '2RWY', bayCount: 4 },
      ],
)

const allSaved = computed(() => {
  void savedTick.value
  void workspaceSharedRevision.value
  return listSavedLayouts().filter((e) => {
    const key = e.layout.roleKey || ''
    return key.startsWith(SAAB_ROLE_PREFIX) || profiles.value.some((p) => key === saabRoleKey(p.id))
  })
})

/** Exactly one AUTO row: user pick, else the profile that was active when the dialog opened. */
function saabAutoLayoutId(): string {
  void savedTick.value
  void workspaceSharedRevision.value
  return getUserDefaultLayoutId(SAAB_AUTO_KEY) || autoFallbackId.value || builtinSaabId('1rwy4')
}

type LayoutRow = {
  id: string
  name: string
  bayCount: number
  isBuiltin: boolean
  isUserDefault: boolean
  profileId: string
}

/** Flat list: built-in profiles, then saved layouts (no folders). */
const layoutRows = computed((): LayoutRow[] => {
  const autoId = saabAutoLayoutId()
  const rows: LayoutRow[] = profiles.value.map((p) => {
    const id = builtinSaabId(p.id)
    return {
      id,
      name: `${p.name} · ${p.bayCount} BAYS`,
      bayCount: p.bayCount,
      isBuiltin: true,
      isUserDefault: id === autoId,
      profileId: p.id,
    }
  })
  for (const entry of allSaved.value) {
    const profileId =
      parseSaabRoleKey(entry.layout.roleKey || '') || currentProfileId.value
    rows.push({
      id: entry.id,
      name: entry.name,
      bayCount: entry.layout.columnCount,
      isBuiltin: false,
      isUserDefault: entry.id === autoId,
      profileId,
    })
  }
  return rows
})

const selectedSaved = computed(() => allSaved.value.find((l) => l.id === selectedId.value))
const selectedIsBuiltin = computed(() => parseBuiltinSaabId(selectedId.value) != null)
const canMutateSelected = computed(() => !!selectedSaved.value && !selectedIsBuiltin.value)

const selectionIsAlreadyDefault = computed(
  () => !!selectedId.value && selectedId.value === saabAutoLayoutId(),
)

const canMakeDefault = computed(() => {
  if (selectionIsAlreadyDefault.value) return false
  if (selectedIsBuiltin.value) return true
  return canMutateSelected.value
})

const builtinGuardTitle = computed(() =>
  selectedIsBuiltin.value ? 'Delivered profiles cannot be changed' : undefined,
)

const makeDefaultTitle = computed(() => {
  if (selectionIsAlreadyDefault.value) return 'Already the automatic OTHER layout'
  if (selectedIsBuiltin.value) return 'Use this profile automatically when opening OTHER'
  if (!selectedSaved.value) return undefined
  return 'Use this layout automatically when opening OTHER'
})

function formatColCount(n: number): string {
  const cols = Math.max(1, Math.round(n) || 1)
  return `${cols} BAYS`
}

function profileSourceLabel(profileId: string): string {
  const profile = profiles.value.find((p) => p.id === profileId)
  return profile ? `${profile.name} · ${profile.bayCount} BAYS` : 'DEFAULT'
}

function previewBuiltinOnBoard(profileId: string) {
  const built = buildWorkspaceLayoutFromServer(store.layout, {
    roleKey: saabRoleKey(profileId),
    defaultSortFlow: getDefaultSortFlow(),
  })
  ws.previewLayout(built, {
    sourceLabel: profileSourceLabel(profileId),
    sourceSavedId: null,
  })
}

/** Click loads immediately (switch profile / preview saved). Cancel restores. */
function selectLayout(id: string) {
  selectedId.value = id
  didPick.value = true
  const builtinPid = parseBuiltinSaabId(id)
  if (builtinPid) {
    if (builtinPid !== currentProfileId.value) {
      pendingPreviewProfileId.value = builtinPid
      awaitingLayoutAfterSwitch.value = true
      store.switchSaabLayout(builtinPid)
    } else {
      pendingPreviewProfileId.value = null
      awaitingLayoutAfterSwitch.value = false
      previewBuiltinOnBoard(builtinPid)
    }
    return
  }
  const entry = allSaved.value.find((l) => l.id === id)
  if (!entry) return
  const labeled = {
    ...entry.layout,
    sourceLabel: entry.name,
    sourceSavedId: entry.id,
  }
  const targetPid =
    parseSaabRoleKey(entry.layout.roleKey || '') || currentProfileId.value
  if (targetPid !== currentProfileId.value) {
    pendingPreviewProfileId.value = null
    awaitingLayoutAfterSwitch.value = true
    ws.pendingSaabSavedLayout.value = labeled
    store.switchSaabLayout(targetPid)
  } else {
    pendingPreviewProfileId.value = null
    awaitingLayoutAfterSwitch.value = false
    ws.previewLayout(labeled, {
      sourceLabel: entry.name,
      sourceSavedId: entry.id,
    })
  }
}

function onSaveCurrent() {
  const layout = ws.activeLayout.value
  if (!layout) return
  const name = window.prompt('Layout name')
  if (!name?.trim()) return
  const trimmed = name.trim()
  const key = saabRoleKey(currentProfileId.value)
  const profile = profiles.value.find((l) => l.id === currentProfileId.value)
  const entry = saveNamedLayout(trimmed, {
    ...layout,
    roleKey: key,
    roles: [],
    rolesLabel: profile ? `${profile.name} · ${profile.bayCount} BAYS` : key,
  })
  savedTick.value++
  selectedId.value = entry.id
  ws.previewLayout(ws.activeLayout.value!, {
    resetClosed: false,
    sourceLabel: entry.name,
    sourceSavedId: entry.id,
  })
}

function onDelete() {
  if (!selectedSaved.value) return
  if (!window.confirm(`Delete layout “${selectedSaved.value.name}”?`)) return
  const deletedId = selectedSaved.value.id
  deleteSavedLayout(deletedId)
  if (getUserDefaultLayoutId(SAAB_AUTO_KEY) === deletedId) {
    setUserDefaultLayout(SAAB_AUTO_KEY, null)
  }
  selectedId.value = builtinSaabId(currentProfileId.value)
  savedTick.value++
  selectLayout(selectedId.value)
}

function onRename() {
  if (!selectedSaved.value) return
  const name = window.prompt('Rename layout', selectedSaved.value.name)
  if (!name?.trim()) return
  const trimmed = name.trim()
  const id = selectedSaved.value.id
  renameSavedLayout(id, trimmed)
  savedTick.value++
  if (ws.activeLayout.value?.sourceSavedId === id) {
    ws.previewLayout(ws.activeLayout.value, {
      resetClosed: false,
      sourceLabel: trimmed,
      sourceSavedId: id,
    })
  }
}

function onMakeDefault() {
  if (!selectedId.value || selectionIsAlreadyDefault.value) return
  setUserDefaultLayout(SAAB_AUTO_KEY, selectedId.value)
  savedTick.value++
}

function onExport() {
  if (!selectedSaved.value) return
  downloadJson(
    `vatefs-layout-${selectedSaved.value.name}.json`,
    buildExportPayload([selectedSaved.value.id]),
  )
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const imported = parseImportPayload(JSON.parse(text))
    const mode = window.confirm('Replace layouts with the same name? OK=replace, Cancel=keep both')
      ? 'replace'
      : 'keepBoth'
    mergeImportedLayouts(imported, mode)
    savedTick.value++
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Import failed')
  }
}

function closeOnly() {
  // Revert only if the user clicked a layout and changed the board
  if (didPick.value) {
    const backPid = profileBeforeOpen.value
    if (backPid && backPid !== currentProfileId.value) {
      if (layoutBeforeOpen.value) {
        ws.pendingSaabSavedLayout.value = layoutBeforeOpen.value
      }
      store.switchSaabLayout(backPid)
    } else if (layoutBeforeOpen.value) {
      ws.previewLayout(layoutBeforeOpen.value)
    }
  }
  pendingPreviewProfileId.value = null
  awaitingLayoutAfterSwitch.value = false
  didPick.value = false
  ws.layoutDialogOpen.value = false
}

function onScrim() {
  closeOnly()
}

function onApply() {
  // No row clicked — keep the board as-is (so Save current still works)
  if (!didPick.value) {
    pendingPreviewProfileId.value = null
    awaitingLayoutAfterSwitch.value = false
    ws.layoutDialogOpen.value = false
    return
  }
  // Row click already switched/previewed. Board rebuild after profile switch is
  // finished by the layout watch (while dialog open) and/or ensureFromServer resync.
  if (ws.activeLayout.value && !awaitingLayoutAfterSwitch.value) {
    ws.applyLayout(ws.activeLayout.value)
  } else {
    ws.confirmLayoutPrompt(SAAB_AUTO_KEY)
  }
  pendingPreviewProfileId.value = null
  awaitingLayoutAfterSwitch.value = false
  didPick.value = false
  ws.layoutDialogOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeOnly()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    onApply()
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  // Snapshot only — do not preview/rebuild the board until the user clicks a row
  didPick.value = false
  pendingPreviewProfileId.value = null
  awaitingLayoutAfterSwitch.value = false
  profileBeforeOpen.value = currentProfileId.value
  autoFallbackId.value = builtinSaabId(currentProfileId.value)
  layoutBeforeOpen.value = ws.activeLayout.value
    ? JSON.parse(JSON.stringify(ws.activeLayout.value))
    : null
  selectedId.value = builtinSaabId(currentProfileId.value)
})

/**
 * Preview after a click-triggered profile switch once server bays are ready.
 * Must wait for refresh to clear bays then refill — saabLayoutId updates before
 * the new layout arrives; previewing against the previous profile's bays is wrong
 * and used to clear pendingPreview too early (needed a second click).
 */
watch(
  () => store.layout.bays.length,
  (n, prev) => {
    if (!awaitingLayoutAfterSwitch.value || !open.value || !didPick.value) return
    // Refresh clears to 0 — keep waiting for the refill
    if (n === 0) return
    // Only accept a refill after we saw (or started from) an empty board
    if (prev !== 0 && prev != null) return
    const want = pendingPreviewProfileId.value
    if (want) {
      if (store.saabLayoutId !== want) return
      pendingPreviewProfileId.value = null
      awaitingLayoutAfterSwitch.value = false
      previewBuiltinOnBoard(want)
      return
    }
    // Saved layout applied via pendingSaabSavedLayout in ensureFromServer
    awaitingLayoutAfterSwitch.value = false
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
@import '@/styles/efs-popup-menu.css';

.workspace-layout-overlay {
  position: fixed;
  inset: 0;
  z-index: 2400;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}

.efs-popup-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.layout-dialog-loaded {
  margin-left: auto;
  color: #888;
  font-weight: 500;
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}

.layout-pick-item {
  justify-content: space-between;
  gap: 10px;
}

.layout-pick-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-pick-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.layout-cols-tag,
.layout-default-tag {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  text-transform: none;
}

.layout-default-tag {
  color: #1a3a6e;
  opacity: 1;
}

.workspace-layout-dialog {
  width: min(480px, 100%);
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
}

.workspace-layout-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.layout-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid #888;
  flex-shrink: 0;
}

.layout-file-input {
  display: none;
}

.workspace-layout-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0;
  flex-shrink: 0;
  border-top: 1px solid #888;
}

.workspace-layout-action {
  flex: 1 1 0;
}
</style>
