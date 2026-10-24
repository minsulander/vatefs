<template>
  <v-menu v-model="open" location="bottom end" offset="4">
    <template #activator="{ props: menuProps }">
      <button
        type="button"
        class="bay-catalog-btn top-menu-btn"
        :class="{ 'is-open': open }"
        title="Catalog"
        v-bind="menuProps"
      >
        <span class="top-menu-tri top-menu-tri--right" aria-hidden="true" />
      </button>
    </template>
    <div
      class="efs-popup-menu efs-popup-menu--wide efs-popup-menu--bay-fill"
      :style="maxHStyle"
      @click.stop
    >
      <div class="efs-popup-list">
        <!-- ESSA info strips when this column is ESSA -->
        <template v-if="isEssaColumn">
          <template v-for="folder in infoCatalogFolders" :key="folder.id">
            <button
              type="button"
              class="efs-popup-section efs-popup-folder"
              :aria-expanded="!!folderOpen[folder.id]"
              @click.stop="toggleFolder(folder.id)"
            >
              <span>{{ folder.label }}</span>
              <span
                class="efs-popup-folder-chevron"
                :class="{ 'is-open': folderOpen[folder.id] }"
                aria-hidden="true"
              />
            </button>
            <template v-if="folderOpen[folder.id]">
              <button
                v-for="entry in folder.items"
                :key="`${entry.kind}:${entry.forceKey}`"
                type="button"
                class="efs-popup-item"
                :class="{ 'is-disabled': entry.shown || !entry.available }"
                :disabled="entry.shown || !entry.available"
                @click="onShowInfo(entry)"
              >{{ entry.label }}</button>
            </template>
          </template>
        </template>

        <template v-if="rwyFlagRows.length > 0">
          <button
            type="button"
            class="efs-popup-section efs-popup-folder"
            :aria-expanded="!!folderOpen.rwyClosed"
            @click.stop="toggleFolder('rwyClosed')"
          >
            <span>Runway closed</span>
            <span
              class="efs-popup-folder-chevron"
              :class="{ 'is-open': folderOpen.rwyClosed }"
              aria-hidden="true"
            />
          </button>
          <template v-if="folderOpen.rwyClosed">
            <button
              v-for="row in rwyFlagRows"
              :key="'clsd-' + row.sectionId"
              type="button"
              class="efs-popup-item"
              :class="{ 'is-disabled': row.closed }"
              :disabled="row.closed"
              @click="onShowRwyFlag(row.sectionId, 'rwyClosed')"
            >{{ row.label }}</button>
          </template>
          <button
            type="button"
            class="efs-popup-section efs-popup-folder"
            :aria-expanded="!!folderOpen.rwyVehicle"
            @click.stop="toggleFolder('rwyVehicle')"
          >
            <span>Runway vehicle</span>
            <span
              class="efs-popup-folder-chevron"
              :class="{ 'is-open': folderOpen.rwyVehicle }"
              aria-hidden="true"
            />
          </button>
          <template v-if="folderOpen.rwyVehicle">
            <button
              v-for="row in rwyFlagRows"
              :key="'occ-' + row.sectionId"
              type="button"
              class="efs-popup-item"
              :class="{ 'is-disabled': row.occupied }"
              :disabled="row.occupied"
              @click="onShowRwyFlag(row.sectionId, 'rwyOccupied')"
            >{{ row.label }}</button>
          </template>
        </template>

        <button
          type="button"
          class="efs-popup-section efs-popup-folder"
          :aria-expanded="sectionsOpen"
          @click.stop="sectionsOpen = !sectionsOpen"
        >
          <span>Sections</span>
          <span
            class="efs-popup-folder-chevron"
            :class="{ 'is-open': sectionsOpen }"
            aria-hidden="true"
          />
        </button>
        <template v-if="sectionsOpen">
          <button type="button" class="efs-popup-item" @click="onAddEmpty">
            Empty divider
          </button>
          <button
            v-for="sec in sectionRows"
            :key="sec.logical"
            type="button"
            class="efs-popup-item"
            :class="{ 'is-disabled': sec.present }"
            :disabled="sec.present"
            @click="onAddSection(sec.logical)"
          >{{ sec.title }}</button>
        </template>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, onUnmounted } from 'vue'
import type { Bay } from '@/types/efs'
import { useInfoStripMenu } from '@/composables/useInfoStrips'
import {
  useRwyFlagMenu,
  type RwyFlagKind,
} from '@/composables/useRunwayFlagStrips'
import {
  RTC_CATALOG_SECTIONS,
  addRtcEmptyDivider,
  ensureRtcLogicalSection,
  isRtcLogicalPresent,
  rtcExtrasVersion,
} from '@/composables/rtcColumnExtras'

const props = defineProps<{
  bay: Bay
  airport: string | null
}>()

const open = ref(false)
const sectionsOpen = ref(true)
const folderOpen = reactive<Record<string, boolean>>({})
const isEssaColumn = computed(() => (props.airport || '').toUpperCase() === 'ESSA')
const infoMenu = useInfoStripMenu({ forceEssaCatalog: () => isEssaColumn.value })
const infoCatalogFolders = computed(() => infoMenu.folders.value)

const rwyFlags = useRwyFlagMenu(() => props.airport, () => props.bay.id)
const rwyFlagRows = computed(() => rwyFlags.rows.value)

const sectionRows = computed(() => {
  void rtcExtrasVersion()
  return RTC_CATALOG_SECTIONS.map((s) => ({
    ...s,
    present: isRtcLogicalPresent(props.bay, s.logical),
  }))
})

const catalogMaxH = ref(480)
const maxHStyle = computed(() => ({
  maxHeight: `${catalogMaxH.value}px`,
  overflowY: 'auto' as const,
}))

function refreshMaxH() {
  const bayRow = document.querySelector('.bay-row') as HTMLElement | null
  if (!bayRow) return
  const h = bayRow.getBoundingClientRect().height
  if (h > 80) catalogMaxH.value = Math.floor(h - 48)
}

function onResize() {
  refreshMaxH()
}

onMounted(() => {
  refreshMaxH()
  window.addEventListener('resize', onResize)
})
onUnmounted(() => window.removeEventListener('resize', onResize))

function toggleFolder(id: string) {
  folderOpen[id] = !folderOpen[id]
}

function onShowInfo(entry: Parameters<typeof infoMenu.showEntry>[0]) {
  if (!entry.available || entry.shown) return
  infoMenu.showEntry(entry)
  open.value = false
}

function onShowRwyFlag(sectionId: string, kind: RwyFlagKind) {
  rwyFlags.toggle(sectionId, kind)
  open.value = false
}

function onAddEmpty() {
  const last = props.bay.sections[props.bay.sections.length - 1]
  addRtcEmptyDivider(props.bay.id, last?.id ?? null)
  open.value = false
}

function onAddSection(logical: string) {
  ensureRtcLogicalSection(props.bay.id, logical)
  open.value = false
}
</script>

<style scoped>
.bay-catalog-btn {
  margin-left: auto;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.85);
  background: transparent;
  border: none;
  padding: 2px 6px;
  cursor: pointer;
  appearance: none;
}
.bay-catalog-btn:hover {
  filter: brightness(1.2);
}
.bay-catalog-btn.is-open .top-menu-tri--right {
  /* Point down when open (shared open rule uses .top-menu-tri) */
  border-width: calc(7px * var(--tb, 1)) calc(5px * var(--tb, 1)) 0 calc(5px * var(--tb, 1));
  border-color: currentColor transparent transparent transparent;
}

/* Mirror EfsTopBar triangle tokens for bay chrome */
.top-menu-tri {
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: calc(5px * var(--tb, 1)) 0 calc(5px * var(--tb, 1)) calc(7px * var(--tb, 1));
  border-color: transparent transparent transparent currentColor;
}
.top-menu-tri--right {
  border-width: calc(5px * var(--tb, 1)) calc(7px * var(--tb, 1)) calc(5px * var(--tb, 1)) 0;
  border-color: transparent currentColor transparent transparent;
}
.bay-catalog-btn.is-open .top-menu-tri {
  border-width: calc(7px * var(--tb, 1)) calc(5px * var(--tb, 1)) 0 calc(5px * var(--tb, 1));
  border-color: currentColor transparent transparent transparent;
}
</style>
