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
        :aria-label="reason === 'role-change' ? 'Choose layout' : 'Layout'"
        @pointerdown.stop
      >
        <div class="efs-popup-header">
          {{ reason === 'role-change' ? 'Choose layout' : 'Layout' }}
          <span
            v-if="loadedLayoutLabel"
            class="layout-dialog-loaded"
            :title="`Loaded: ${loadedLayoutLabel}`"
          >{{ loadedLayoutLabel }}</span>
        </div>
        <div v-if="currentRolesLabel" class="efs-popup-section">
          Current: {{ currentRolesLabel }}
        </div>

        <!-- Only the folder list scrolls; Save/Rename chips + Cancel/OK stay pinned -->
        <div class="efs-popup-list workspace-layout-list">
          <template v-for="folder in roleFolders" :key="folder.roleKey">
            <button
              type="button"
              class="efs-popup-section efs-popup-folder"
              :aria-expanded="!!folderOpen[folder.roleKey]"
              @pointerdown.prevent.stop="toggleFolder(folder.roleKey)"
            >
              <span>{{ folder.label }}</span>
              <span
                class="efs-popup-folder-chevron"
                :class="{ 'is-open': folderOpen[folder.roleKey] }"
                aria-hidden="true"
              />
            </button>
            <template v-if="folderOpen[folder.roleKey]">
              <button
                type="button"
                class="efs-popup-item efs-popup-item--start layout-pick-item"
                :class="{ selected: selectedId === folder.builtinId }"
                @pointerdown.prevent="selectLayout(folder.builtinId)"
              >
                <span class="layout-pick-name">DEFAULT</span>
                <span class="layout-pick-meta">
                  <span class="layout-cols-tag">{{ formatColCount(folder.builtinColumnCount) }}</span>
                </span>
              </button>
              <button
                v-for="entry in folder.layouts"
                :key="entry.id"
                type="button"
                class="efs-popup-item efs-popup-item--start layout-pick-item"
                :class="{
                  selected: selectedId === entry.id,
                  'is-user-default': entry.id === folder.defaultId,
                }"
                @pointerdown.prevent="selectLayout(entry.id)"
              >
                <span class="layout-pick-name">{{ entry.name }}</span>
                <span class="layout-pick-meta">
                  <span v-if="entry.id === folder.defaultId" class="layout-default-tag">AUTO</span>
                  <span class="layout-cols-tag">{{ formatColCount(entry.layout.columnCount) }}</span>
                </span>
              </button>
            </template>
          </template>
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
            :disabled="mustConfirm"
            :title="mustConfirm ? 'Must choose a layout (OK or Enter)' : undefined"
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
import { buildDefaultWorkspaceLayout } from '@/workspace/defaultLayout'
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
  sanitizeWorkspaceLayout,
  saveNamedLayout,
  setUserDefaultLayout,
  workspaceSharedRevision,
} from '@/workspace/storage'
import {
  builtinLayoutSelectionId,
  compareEssaRoleFolderOrder,
  essaFamilyRoleCombinations,
  essaRoleKey,
  formatEssaRolesLabel,
  parseBuiltinLayoutSelectionId,
} from '@/workspace/roleLabel'
import type { SavedWorkspaceLayout, WorkspaceLayout } from '@/workspace/types'

/** No v-model — open state lives only on the workspace singleton. */
const store = useEfsStore()
const ws = getWorkspace()
const open = ws.layoutDialogOpen
const reason = ws.layoutDialogReason

const selectedId = ref<string>(builtinLayoutSelectionId('none'))
const fileInput = ref<HTMLInputElement | null>(null)
/** roleKey → expanded; current role opens by default */
const folderOpen = ref<Record<string, boolean>>({})
/** Snapshot when dialog opens — menu Cancel restores this after live preview */
const layoutBeforeOpen = ref<WorkspaceLayout | null>(null)

const mustConfirm = computed(() => reason.value === 'role-change')

const currentRolesLabel = computed(() => formatEssaRolesLabel(store.essaRoles))
const roleKey = computed(() => essaRoleKey(store.essaRoles))
const userDefaultId = computed(() => {
  void workspaceSharedRevision.value
  return getUserDefaultLayoutId(roleKey.value)
})
const loadedLayoutLabel = computed(() =>
  resolveLoadedLayoutLabel(ws.activeLayout.value),
)

const savedTick = ref(0)
const allSaved = computed(() => {
  void savedTick.value
  void workspaceSharedRevision.value
  return listSavedLayouts()
})

type RoleFolder = {
  roleKey: string
  label: string
  roles: string[]
  builtinId: string
  builtinColumnCount: number
  defaultId: string | undefined
  layouts: SavedWorkspaceLayout[]
}

function builtinColumnCountFor(roles: string[]): number {
  if (!store.layout.bays.length) return 4
  return buildDefaultWorkspaceLayout(store.layout, roles, {
    defaultSortFlow: getDefaultSortFlow(),
  }).columnCount
}

/**
 * All CD/GND/TWR family combos (always), plus any partial-split roleKeys from
 * saved layouts / current selection. Each folder lists DEFAULT then saved layouts.
 */
const roleFolders = computed((): RoleFolder[] => {
  const byKey = new Map<string, RoleFolder>()

  const ensure = (key: string, roles: string[], label: string) => {
    let folder = byKey.get(key)
    if (!folder) {
      folder = {
        roleKey: key,
        label,
        roles: [...roles],
        builtinId: builtinLayoutSelectionId(key),
        builtinColumnCount: builtinColumnCountFor(roles),
        defaultId: getUserDefaultLayoutId(key),
        layouts: [],
      }
      byKey.set(key, folder)
    }
    return folder
  }

  for (const combo of essaFamilyRoleCombinations()) {
    ensure(combo.roleKey, combo.roles, combo.label)
  }

  // Current roles (may be a partial split not in the family catalog)
  ensure(roleKey.value, [...store.essaRoles], currentRolesLabel.value)

  for (const entry of allSaved.value) {
    const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
    const folder = ensure(
      key,
      entry.layout.roles || [],
      entry.layout.rolesLabel || formatEssaRolesLabel(entry.layout.roles || []),
    )
    folder.layouts.push(entry)
  }

  const folders = [...byKey.values()]
  folders.sort((a, b) => compareEssaRoleFolderOrder(a.roles, a.roleKey, b.roles, b.roleKey))
  return folders
})

const selectedSaved = computed(() =>
  allSaved.value.find((l) => l.id === selectedId.value),
)

/** Built-in DEFAULT profile for a role folder — not a user-saved layout. */
const selectedIsBuiltin = computed(
  () => parseBuiltinLayoutSelectionId(selectedId.value) != null,
)

const selectedFolderDefaultId = computed(() => {
  const entry = selectedSaved.value
  if (!entry) return undefined
  const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
  return getUserDefaultLayoutId(key)
})

/** Effective default for the folder of the current selection (saved or builtin). */
const selectionIsAlreadyDefault = computed(() => {
  if (selectedIsBuiltin.value) {
    const key = parseBuiltinLayoutSelectionId(selectedId.value) ?? ''
    // Builtin DEFAULT is the effective default when no user AUTO layout is set
    return !getUserDefaultLayoutId(key)
  }
  return !!selectedSaved.value && selectedId.value === selectedFolderDefaultId.value
})

/** User-saved only — delivered DEFAULT profiles cannot be deleted/renamed/exported. */
const canMutateSelected = computed(() => !!selectedSaved.value && !selectedIsBuiltin.value)

/** Saved layout → set AUTO; builtin DEFAULT → clear AUTO (restore delivered default). */
const canMakeDefault = computed(() => {
  if (selectionIsAlreadyDefault.value) return false
  if (selectedIsBuiltin.value) return true // clears user default for that role
  return canMutateSelected.value
})

const builtinGuardTitle = computed(() =>
  selectedIsBuiltin.value ? 'Delivered DEFAULT profiles cannot be changed' : undefined,
)

const makeDefaultTitle = computed(() => {
  if (selectionIsAlreadyDefault.value) return 'Already the default for this role'
  if (selectedIsBuiltin.value) return 'Restore delivered DEFAULT as the automatic layout'
  if (!selectedSaved.value) return undefined
  return 'Use this layout automatically for this role'
})

function toggleFolder(key: string) {
  folderOpen.value = { ...folderOpen.value, [key]: !folderOpen.value[key] }
}

function formatColCount(n: number): string {
  const cols = Math.max(1, Math.round(n) || 1)
  return `${cols} BAYS`
}

/** Live-preview the selected layout on the board behind the dialog. */
function previewSelectedOnBoard() {
  const roles = [...store.essaRoles]
  const key = essaRoleKey(roles)
  try {
    const builtinKey = parseBuiltinLayoutSelectionId(selectedId.value)
    if (builtinKey != null) {
      const folder = roleFolders.value.find((f) => f.roleKey === builtinKey)
      const structureRoles = folder?.roles?.length ? folder.roles : roles
      ws.previewBuiltInDefault(store.layout, structureRoles, roles)
      return
    }
    const entry = allSaved.value.find((l) => l.id === selectedId.value)
    if (entry) {
      ws.previewLayout(
        {
          ...entry.layout,
          roleKey: key,
          roles,
          rolesLabel: currentRolesLabel.value,
        },
        { sourceLabel: entry.name, sourceSavedId: entry.id },
      )
    } else {
      ws.previewBuiltInDefault(store.layout, roles, roles)
    }
  } catch (e) {
    console.error('Workspace layout preview failed:', e)
  }
}

function selectLayout(id: string) {
  selectedId.value = id
  previewSelectedOnBoard()
}

function snapshotLayoutBeforeOpen() {
  const active = ws.activeLayout.value
  layoutBeforeOpen.value = active ? sanitizeWorkspaceLayout(active) : null
}

/** Select default for current roles and expand that folder (close the others). */
function syncSelectionAndFolders() {
  savedTick.value++
  const def = userDefaultId.value
  selectedId.value =
    def && allSaved.value.some((l) => l.id === def)
      ? def
      : builtinLayoutSelectionId(roleKey.value)
  const openMap: Record<string, boolean> = {}
  for (const f of roleFolders.value) {
    openMap[f.roleKey] = f.roleKey === roleKey.value
  }
  folderOpen.value = openMap
  previewSelectedOnBoard()
}

// immediate: dialog often mounts with open already true (Ctrl+F5 / role prompt)
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    snapshotLayoutBeforeOpen()
    syncSelectionAndFolders()
  },
  { immediate: true },
)

// Roles can arrive after the dialog is already open — keep present-roles folder expanded
watch(roleKey, () => {
  if (!open.value) return
  syncSelectionAndFolders()
})

/** Menu Cancel — restore board layout snapshot and close. Disabled when must confirm. */
function closeOnly() {
  if (mustConfirm.value) return
  if (layoutBeforeOpen.value) {
    ws.previewLayout(layoutBeforeOpen.value)
  }
  layoutBeforeOpen.value = null
  open.value = false
}

/** Must-confirm: scrim does nothing. Menu: same as Cancel. */
function onScrim() {
  if (mustConfirm.value) return
  closeOnly()
}

function onApply() {
  const roles = [...store.essaRoles]
  const key = essaRoleKey(roles)
  layoutBeforeOpen.value = null
  // Board already shows the selection from live preview; re-apply confirms + closes
  try {
    const builtinKey = parseBuiltinLayoutSelectionId(selectedId.value)
    if (builtinKey != null) {
      // Load that folder's built-in profile (e.g. CD DEFAULT), even if live roles differ
      const folder = roleFolders.value.find((f) => f.roleKey === builtinKey)
      const structureRoles = folder?.roles?.length ? folder.roles : roles
      ws.applyBuiltInDefault(store.layout, structureRoles, roles)
      return
    }
    const entry = selectedSaved.value
    if (entry) {
      ws.applyLayout({
        ...entry.layout,
        roleKey: key,
        roles,
        rolesLabel: currentRolesLabel.value,
        sourceLabel: entry.name,
        sourceSavedId: entry.id,
      })
    } else {
      ws.applyBuiltInDefault(store.layout, roles, roles)
    }
  } catch (e) {
    console.error('Workspace layout apply failed:', e)
    ws.confirmLayoutPrompt(key)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    onApply()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    // Must-confirm (Choose layout): only OK / Enter — ignore Escape
    if (mustConfirm.value) return
    closeOnly()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

function onSaveCurrent() {
  const active = ws.activeLayout.value
  if (!active) return
  const name = window.prompt('Layout name', `Layout ${currentRolesLabel.value}`)
  if (!name) return
  const trimmed = name.trim()
  if (!trimmed) return
  const entry = saveNamedLayout(trimmed, {
    ...active,
    roleKey: roleKey.value,
    roles: [...store.essaRoles],
    rolesLabel: currentRolesLabel.value,
  })
  selectedId.value = entry.id
  savedTick.value++
  folderOpen.value = { ...folderOpen.value, [roleKey.value]: true }
  // Catalog → Layout shows this name as the loaded layout
  if (ws.activeLayout.value) {
    ws.previewLayout(ws.activeLayout.value, {
      resetClosed: false,
      sourceLabel: entry.name,
      sourceSavedId: entry.id,
    })
  }
}

function onMakeDefault() {
  if (!canMakeDefault.value) return
  const builtinKey = parseBuiltinLayoutSelectionId(selectedId.value)
  if (builtinKey != null) {
    // Reset role AUTO → delivered DEFAULT
    setUserDefaultLayout(builtinKey, null)
    savedTick.value++
    return
  }
  const entry = selectedSaved.value
  if (!entry) return
  const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
  setUserDefaultLayout(key, entry.id)
  savedTick.value++
}

function onRename() {
  if (!canMutateSelected.value) return
  const entry = selectedSaved.value
  if (!entry) return
  const name = window.prompt('Rename layout', entry.name)
  if (name == null) return
  const trimmed = name.trim()
  if (!trimmed || trimmed === entry.name) return
  renameSavedLayout(entry.id, trimmed)
  savedTick.value++
  if (ws.activeLayout.value?.sourceSavedId === entry.id) {
    ws.previewLayout(ws.activeLayout.value, {
      resetClosed: false,
      sourceLabel: trimmed,
      sourceSavedId: entry.id,
    })
  }
}

function onDelete() {
  if (!canMutateSelected.value) return
  const entry = selectedSaved.value
  if (!entry) return
  if (!window.confirm(`Delete layout “${entry.name}”?`)) return
  const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
  deleteSavedLayout(entry.id)
  selectLayout(builtinLayoutSelectionId(key))
  savedTick.value++
}

function onExport() {
  if (!canMutateSelected.value) return
  const entry = selectedSaved.value
  if (!entry) return
  const payload = buildExportPayload([entry.id])
  const safe = entry.name.replace(/[^\w\-]+/g, '_').replace(/^_|_$/g, '') || 'layout'
  downloadJson(`vatefs-essa-layout-${safe}.json`, payload)
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
    const result = mergeImportedLayouts(imported, mode)
    savedTick.value++
    store.showNotify(
      `Imported ${result.added} layout(s)` +
        (result.replaced ? `, replaced ${result.replaced}` : ''),
      'info',
    )
  } catch (e) {
    store.showNotify(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}
</script>

<style scoped>
/* Keep the board readable — selection live-previews behind */
.workspace-layout-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: auto;
}

.layout-pick-item {
  justify-content: space-between;
  gap: 10px;
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

.layout-cols-tag {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  text-transform: none;
}

.workspace-layout-dialog {
  width: min(480px, 100%);
  /* Grow with content; only cap at nearly full viewport (overlay padding 16px×2) */
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  position: relative;
  z-index: 1;
}

/* Single scrollbar: list only (overrides global .efs-popup-list 50vh/320px cap) */
.workspace-layout-list {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.workspace-layout-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex-shrink: 0;
  border-top: 3px solid #333;
  position: relative;
  z-index: 2;
}

.workspace-layout-action {
  border-top: none;
  border-right: 1px solid #777;
  cursor: pointer;
  pointer-events: auto;
  position: relative;
  z-index: 3;
}

.workspace-layout-action:last-child {
  border-right: none;
}

.workspace-layout-action:disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
  color: #666;
}

.layout-default-tag {
  margin-left: 6px;
  font-size: 10px;
  opacity: 0.8;
}
.is-user-default .efs-popup-item-title {
  font-weight: 600;
}
.layout-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  flex-shrink: 0;
  border-top: 2px solid #555;
}
.layout-file-input {
  display: none;
}
.selected {
  outline: 1px solid rgba(255, 255, 255, 0.35);
}
</style>
