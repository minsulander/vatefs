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
        :aria-label="reason === 'role-change' ? 'Choose layout for roles' : 'Layouts'"
        @pointerdown.stop
      >
        <div class="efs-popup-header">
          {{ reason === 'role-change' ? 'Choose layout for roles' : 'Layouts' }}
        </div>
        <div v-if="currentRolesLabel" class="efs-popup-section">
          Current: {{ currentRolesLabel }}
        </div>

        <div class="workspace-layout-body">
          <div class="efs-popup-list">
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
                  class="efs-popup-item"
                  :class="{ selected: selectedId === folder.builtinId }"
                  @pointerdown.prevent="selectedId = folder.builtinId"
                >DEFAULT</button>
                <button
                  v-for="entry in folder.layouts"
                  :key="entry.id"
                  type="button"
                  class="efs-popup-item"
                  :class="{
                    selected: selectedId === entry.id,
                    'is-user-default': entry.id === folder.defaultId,
                  }"
                  @pointerdown.prevent="selectedId = entry.id"
                >
                  {{ entry.name }}
                  <span v-if="entry.id === folder.defaultId" class="layout-default-tag">AUTO</span>
                </button>
              </template>
            </template>
          </div>

          <div v-if="reason === 'menu'" class="layout-actions-row">
            <button type="button" class="efs-popup-chip" @pointerdown.prevent="onSaveCurrent">Save current</button>
            <button
              type="button"
              class="efs-popup-chip"
              :disabled="!selectedSaved"
              @pointerdown.prevent="onDelete"
            >Delete</button>
            <button
              type="button"
              class="efs-popup-chip"
              :disabled="!selectedSaved"
              @pointerdown.prevent="onRename"
            >Rename</button>
            <button
              type="button"
              class="efs-popup-chip"
              :disabled="!selectedSaved || selectedId === selectedFolderDefaultId"
              @pointerdown.prevent="onMakeDefault"
            >Make default</button>
            <button type="button" class="efs-popup-chip" @pointerdown.prevent="fileInput?.click()">Import</button>
            <button
              type="button"
              class="efs-popup-chip"
              :disabled="!selectedSaved"
              title="Export the selected saved layout"
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
        </div>

        <div class="workspace-layout-actions" :class="{ 'is-role-change': reason === 'role-change' }">
          <button
            v-if="reason === 'menu'"
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
import {
  buildExportPayload,
  deleteSavedLayout,
  downloadJson,
  getUserDefaultLayoutId,
  listSavedLayouts,
  mergeImportedLayouts,
  parseImportPayload,
  renameSavedLayout,
  saveNamedLayout,
  setUserDefaultLayout,
} from '@/workspace/storage'
import {
  builtinLayoutSelectionId,
  essaFamilyRoleCombinations,
  essaRoleKey,
  formatEssaRolesLabel,
  parseBuiltinLayoutSelectionId,
} from '@/workspace/roleLabel'
import type { SavedWorkspaceLayout } from '@/workspace/types'

/** No v-model — open state lives only on the workspace singleton. */
const store = useEfsStore()
const ws = getWorkspace()
const open = ws.layoutDialogOpen
const reason = ws.layoutDialogReason

const selectedId = ref<string>(builtinLayoutSelectionId('none'))
const fileInput = ref<HTMLInputElement | null>(null)
/** roleKey → expanded; current role opens by default */
const folderOpen = ref<Record<string, boolean>>({})

const currentRolesLabel = computed(() => formatEssaRolesLabel(store.essaRoles))
const roleKey = computed(() => essaRoleKey(store.essaRoles))
const userDefaultId = computed(() => getUserDefaultLayoutId(roleKey.value))

const savedTick = ref(0)
const allSaved = computed(() => {
  void savedTick.value
  return listSavedLayouts()
})

type RoleFolder = {
  roleKey: string
  label: string
  roles: string[]
  builtinId: string
  defaultId: string | undefined
  layouts: SavedWorkspaceLayout[]
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
  folders.sort((a, b) => {
    if (a.roleKey === roleKey.value) return -1
    if (b.roleKey === roleKey.value) return 1
    return a.label.localeCompare(b.label) || a.roleKey.localeCompare(b.roleKey)
  })
  return folders
})

const selectedSaved = computed(() =>
  allSaved.value.find((l) => l.id === selectedId.value),
)

const selectedFolderDefaultId = computed(() => {
  const entry = selectedSaved.value
  if (!entry) return undefined
  const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
  return getUserDefaultLayoutId(key)
})

function toggleFolder(key: string) {
  folderOpen.value = { ...folderOpen.value, [key]: !folderOpen.value[key] }
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
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
  },
)

/** Menu Cancel — close without applying / without confirming role prompt. */
function closeOnly() {
  open.value = false
}

function onScrim() {
  if (reason.value === 'role-change') {
    onApply()
    return
  }
  closeOnly()
}

function onApply() {
  // Confirm+close FIRST so any follow-on role/layout watch cannot reopen this frame
  const roles = [...store.essaRoles]
  const key = essaRoleKey(roles)
  ws.confirmLayoutPrompt(key)

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
      })
    } else {
      ws.applyBuiltInDefault(store.layout, roles, roles)
    }
  } catch (e) {
    console.error('Workspace layout apply failed:', e)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    onApply()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

function onSaveCurrent() {
  const active = ws.activeLayout.value
  if (!active) return
  const name = window.prompt('Layout name', `Layout ${currentRolesLabel.value}`)
  if (!name) return
  const entry = saveNamedLayout(name, {
    ...active,
    roleKey: roleKey.value,
    roles: [...store.essaRoles],
    rolesLabel: currentRolesLabel.value,
  })
  selectedId.value = entry.id
  savedTick.value++
  folderOpen.value = { ...folderOpen.value, [roleKey.value]: true }
}

function onMakeDefault() {
  const entry = selectedSaved.value
  if (!entry) return
  const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
  setUserDefaultLayout(key, entry.id)
  savedTick.value++
}

function onRename() {
  const entry = selectedSaved.value
  if (!entry) return
  const name = window.prompt('Rename layout', entry.name)
  if (name == null) return
  const trimmed = name.trim()
  if (!trimmed || trimmed === entry.name) return
  renameSavedLayout(entry.id, trimmed)
  savedTick.value++
}

function onDelete() {
  const entry = selectedSaved.value
  if (!entry) return
  if (!window.confirm(`Delete layout “${entry.name}”?`)) return
  const key = entry.layout.roleKey || essaRoleKey(entry.layout.roles || [])
  deleteSavedLayout(entry.id)
  selectedId.value = builtinLayoutSelectionId(key)
  savedTick.value++
}

function onExport() {
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
.workspace-layout-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.workspace-layout-dialog {
  width: min(480px, 100%);
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  position: relative;
  z-index: 1;
}

.workspace-layout-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  position: relative;
  z-index: 0;
}

.workspace-layout-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex-shrink: 0;
  border-top: 3px solid #333;
  position: relative;
  z-index: 2;
}

.workspace-layout-actions.is-role-change {
  grid-template-columns: 1fr;
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
}
.layout-file-input {
  display: none;
}
.selected {
  outline: 1px solid rgba(255, 255, 255, 0.35);
}
</style>
