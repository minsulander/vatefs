<template>
  <ClearanceDialog v-model="clncDialogOpen" :strip="strip" />
  <FlightplanDialog v-model="fplDialogOpen" :strip="strip" />

  <v-dialog v-model="deleteDialogOpen" max-width="300" content-class="delete-dialog-wrapper">
    <div class="delete-dialog">
      <div class="delete-dialog-text">Delete strip for flight {{ strip.callsign }}?</div>
      <div class="delete-dialog-actions">
        <button class="delete-dialog-btn delete-dialog-cancel" @click="deleteDialogOpen = false">Cancel</button>
        <button class="delete-dialog-btn delete-dialog-confirm" @click="onDeleteConfirm">DELETE</button>
      </div>
    </div>
  </v-dialog>

  <v-menu v-model="menuOpen" :target="menuPosition" location="end" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu">
      <v-list-item v-if="isDeparture" @click="onClncMenuClick">
        <v-list-item-title>Clearance</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="!isNote" @click="onFplClick">
        <v-list-item-title>Flightplan</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="strip.transferPending === 'out' && !isNote && store.isController" @click="onAssumeClick">
        <v-list-item-title>Assume</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="strip.isAssumed && !isNote" @click="onReleaseClick">
        <v-list-item-title>Release</v-list-item-title>
      </v-list-item>
      <template v-if="strip.isAssumed && !isNote && store.controllers.length > 0">
        <v-list-item @click.stop="transferMenuOpen = true">
          <v-list-item-title>
            Transfer to...
            <v-icon size="small" class="ml-1">mdi-chevron-right</v-icon>
          </v-list-item-title>
        </v-list-item>
      </template>
      <v-list-item v-if="!isNote && store.isController" @click.stop="groundStateMenuOpen = true">
        <v-list-item-title>
          State: {{ groundStateLabel }}
          <v-icon size="small" class="ml-1">mdi-chevron-right</v-icon>
        </v-list-item-title>
      </v-list-item>
      <v-list-item v-if="!isNote && store.isController" @click="onRemarksMenuClick">
        <v-list-item-title>Remarks</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canSendRea" @click="onSendReaClick">
        <v-list-item-title>Set REA</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canClearRea" @click="onClearReaClick">
        <v-list-item-title>Remove REA</v-list-item-title>
      </v-list-item>
      <v-list-item @click="onDeleteClick">
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- CTOT menu (reason + REA) -->
  <v-menu v-model="ctotMenuOpen" :target="menuPosition" location="end" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu ctot-menu">
      <v-list-item class="ctot-reason-item" disabled>
        <v-list-item-title class="ctot-reason-title">
          {{ strip.ctotReason || 'No regulation reason' }}
        </v-list-item-title>
      </v-list-item>
      <v-divider v-if="canSendRea || canClearRea" />
      <v-list-item v-if="canSendRea" @click="onSendReaClick">
        <v-list-item-title>Set REA</v-list-item-title>
      </v-list-item>
      <v-list-item v-if="canClearRea" @click="onClearReaClick">
        <v-list-item-title>Remove REA</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- REA badge menu (above TOBT when no CTOT) -->
  <v-menu v-model="reaMenuOpen" :target="menuPosition" location="end" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu ctot-menu">
      <v-list-item v-if="canClearRea" @click="onClearReaClick">
        <v-list-item-title>Remove REA</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- Ground state submenu -->
  <v-menu v-model="groundStateMenuOpen" :target="menuPosition" location="end" offset="150" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu groundstate-submenu">
      <v-list-item
        v-for="gs in groundStateOptions"
        :key="gs.action"
        :class="{ 'v-list-item--active': gs.groundstate === (strip.groundstate ?? '') && !gs.extra }"
        @click="onGroundStateClick(gs.action)"
      >
        <v-list-item-title><span class="gs-code">{{ gs.code }}</span> {{ gs.label }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- Transfer submenu -->
  <v-menu v-model="transferMenuOpen" :target="menuPosition" location="end" offset="150" :close-on-content-click="true">
    <v-list density="compact" class="strip-context-menu transfer-submenu">
      <v-list-item
        v-for="ctrl in store.controllers"
        :key="ctrl.callsign"
        @click="onTransferClick(ctrl.callsign)"
      >
        <v-list-item-title>{{ ctrl.callsign }} <span class="transfer-freq">{{ ctrl.frequency }}</span></v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <div ref="stripElement" class="flight-strip"
    :class="[stripTypeClass, { dragging: isDragging, 'is-bottom': strip.bottom, 'strip-note-layout': isNote, 'auto-move-hidden': isAutoMoving, 'owned-by-other': shouldDimOwnership, 'transfer-pending-in': isTransferIn, 'transfer-pending-out': isTransferOut }]" :style="stripStyle"
    :data-strip-id="strip.id" draggable="true" @dragstart="onDragStart" @dragend="onDragEnd"
    @touchstart="onDragAreaTouchStart" @touchmove.prevent="onDragAreaTouchMove" @touchend="onDragAreaTouchEnd"
    @touchcancel="onDragAreaTouchCancel" @contextmenu.prevent="onContextMenu" @click="onStripClick">
    <!-- Color indicator bar on left -->
    <div class="strip-indicator"></div>

    <!-- NOTE STRIP: Editable text layout -->
    <template v-if="isNote">
      <div class="note-content" @click.stop="onNoteClick" @touchend="onNoteTouch">
        <input
          v-if="noteEditing"
          ref="noteInput"
          v-model="noteText"
          class="note-input"
          placeholder="Type a note..."
          @input="onNoteInput"
          @blur="onNoteBlur"
          @keydown.enter="onNoteBlur"
          @keydown.escape="onNoteBlur"
        />
        <span v-else class="note-display" :class="{ 'note-empty': !strip.noteText }">
          {{ strip.noteText || 'Click to add note...' }}
        </span>
      </div>
    </template>

    <!-- NORMAL STRIP LAYOUT -->
    <template v-else>
    <!-- Left section: Callsign block (always visible) -->
    <div class="strip-left">
      <div class="callsign" :class="{ 'callsign-no-match': strip.hasMatchingFlight === false }" :title="strip.rtfCallsign || undefined" @click.stop="onCallsignClick" @touchend.stop.prevent="onCallsignTouch">{{ strip.callsign }}</div>
      <div class="callsign-sub">
        <span class="flight-rules">{{ strip.flightRules }}</span>
        <span class="aircraft-type">{{ strip.aircraftType }} {{ strip.wakeTurbulence }}</span>
        <span
          v-if="showOwnerSi"
          class="owner-si"
          :class="ownerSiClass"
          :title="ownerSiTitle"
        >{{ ownerSiText }}</span>
      </div>
      <div class="squawk-stand-row">
        <span class="squawk" v-if="strip.squawk">{{ strip.squawk }}</span>
        <span class="squawk" :class="{ 'squawk-empty': strip.canResetSquawk }" v-else
          @click.stop="strip.canResetSquawk && onResetSquawk()">----</span>
        <span class="stand" v-if="strip.stand">{{ strip.stand }}</span>
      </div>
    </div>

    <!-- Middle section (truncatable) -->
    <div class="strip-middle">
      <!-- Remarks row (above other fields, spans full width) -->
      <div v-if="remarksEditing || strip.remarks" class="remarks-row" @click.stop>
        <input
          v-if="remarksEditing"
          ref="remarksInput"
          v-model="remarksText"
          class="remarks-input"
          placeholder="Remarks..."
          @input="onRemarksInput"
          @blur="onRemarksBlur"
          @keydown.enter="onRemarksBlur"
          @keydown.escape="onRemarksCancel"
        />
        <span v-else class="remarks-display" @click.stop="store.isController && onRemarksClick()">{{ strip.remarks }}</span>
      </div>
      <div class="strip-middle-content">
        <!-- Time section / clearance triangle -->
        <div class="strip-section strip-time" :class="{ 'has-ctot': showCtot, 'has-cdm': showCdm, 'is-fls': isFls }">
          <template v-if="strip.clearedForTakeoff || strip.clearedToLand">
            <svg v-if="strip.clearedForTakeoff" viewBox="0 0 24 24" class="clearance-triangle takeoff">
              <polygon points="12,4 22,20 2,20" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="clearance-triangle landing">
              <polygon points="12,20 22,4 2,4" />
            </svg>
          </template>
          <template v-else-if="timeEditing">
            <div
              class="time-edit-panel"
              :class="{ 'time-edit-tobt': timeEditMode === 'tobt' }"
            >
              <div class="time-edit-half time-edit-top">
                <input
                  ref="timeEditInput"
                  v-model="timeEditText"
                  class="eobt-edit-input"
                  :class="{ 'eobt-edit-fls': timeEditMode === 'eobt' && isFls }"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  enterkeyhint="done"
                  autocomplete="off"
                  maxlength="4"
                  @click.stop
                  @blur="onTimeEditBlur"
                  @keydown.enter="onTimeEditBlur"
                  @keydown.escape="onTimeEditCancel"
                />
              </div>
              <div v-if="timeEditMode === 'tobt'" class="time-edit-half time-edit-bottom">
                <button
                  type="button"
                  class="ready-tobt-btn"
                  title="Ready TOBT"
                  @mousedown.prevent
                  @click.stop="onReadyTobtClick"
                >READY TOBT</button>
              </div>
              <div v-else class="time-edit-half time-edit-bottom">
                <div class="time-label">EOBT</div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="time-pair">
              <div
                v-if="showPrimaryTime"
                class="time-col"
                :class="{
                  'eobt-fls': isFls,
                  'eobt-clickable': canEditPrimaryTime,
                }"
                :title="isFls ? primaryTimeLabelTitle : undefined"
                @click.stop="onPrimaryTimeClick"
              >
                <div
                  v-if="networkStatusBadge && !showCtot"
                  class="time-sts-label"
                  :class="[networkStatusClass, { 'sts-clickable': canClearRea }]"
                  :title="canClearRea ? 'Remove REA' : undefined"
                  @click.stop="onReaBadgeClick"
                >{{ networkStatusBadge }}</div>
                <div
                  class="time-value"
                  :class="{ 'time-fls': isFls, 'time-changed': tobtChanged }"
                >
                  {{ primaryTimeValue }}
                </div>
                <div class="time-label" :class="{ 'label-fls': isFls }" :title="primaryTimeLabelTitle">
                  {{ primaryTimeLabel }}<span v-if="showTobtSetBy" class="tobt-setby"> ({{ strip.tobtSetBy }})</span>
                </div>
              </div>
              <div
                v-if="showCdm"
                class="time-col tsat-col"
                title="TSAT"
              >
                <div
                  class="time-value"
                  :class="[tsatColorClass, { 'time-changed': tsatChanged }]"
                >{{ displayTsat }}</div>
                <div class="time-label">TSAT</div>
              </div>
              <div
                v-if="showCtot"
                class="time-col ctot-col"
                :class="{ 'ctot-clickable': store.isController }"
                :title="strip.ctotReason || 'CTOT'"
                @click.stop="onCtotClick"
              >
                <div
                  v-if="networkStatusBadge"
                  class="time-sts-label"
                  :class="[networkStatusClass, { 'sts-clickable': canClearRea }]"
                  :title="canClearRea ? 'Remove REA' : undefined"
                  @click.stop="onReaBadgeClick"
                >{{ networkStatusBadge }}</div>
                <div class="time-value time-ctot" :class="{ 'time-changed': ctotChanged }">{{ strip.ctot }}</div>
                <div class="time-label time-label-ctot">CTOT</div>
              </div>
            </div>
          </template>
        </div>
        <div class="strip-divider"></div>

        <!-- SID section -->
        <template  v-if="strip.stripType === 'departure'">
          <div class="strip-section strip-sid">
              <div class="sid-value">{{ strip.sid || '' }}</div>
              <div class="cleared-data" v-if="strip.clearedAltitude || strip.assignedHeading">
                <span v-if="strip.clearedAltitude" class="alt">{{ strip.clearedAltitude }}</span>
                <span v-if="strip.assignedHeading" class="hdg">H{{ strip.assignedHeading }}</span>
              </div>
          </div>
          <div class="strip-divider"></div>
        </template>

        <!-- Airports section -->
        <div class="strip-section strip-airports">
          <template v-if="store.myAirports.length > 1">
            <div class="airport adep" :class="{ highlight: strip.stripType === 'departure' || strip.stripType === 'local' }">
              <span class="icao">{{ strip.adep }}</span>
            </div>
            <div class="airport ades" :class="{ highlight: strip.stripType === 'arrival' || strip.stripType === 'local' }">
              <span class="icao">{{ strip.ades }}</span>
            </div>
          </template>
          <template v-else>
            <div class="airport highlight single-airport">
              <span class="icao">{{ (strip.stripType === 'arrival' || strip.stripType === 'local') ? strip.adep : strip.ades }}</span>
            </div>
          </template>
        </div>

      </div>
    </div>

    <!-- Runway section (always visible, right-aligned) -->
    <div class="strip-runway-fixed" v-if="strip.runway">
      <div class="runway-value" v-if="strip.runway">{{ strip.runway }}</div>
    </div>

    <!-- Right section: Action button(s) (hidden in observer mode) -->
    <template v-if="store.isController">
      <div v-if="strip.actions && strip.actions.length > 0" class="strip-right"
        :class="{ 'multi-action': effectiveActionCount > 1 }">
        <button v-for="action in strip.actions" :key="action" class="action-button"
          :class="actionButtonClass(action)"
          @click.stop="() => onActionClick(action)" @touchend.stop="(e) => onActionTouch(e, action)">
          <span class="action-text">{{ action === 'GOA' ? 'G/A' : action }}</span>
          <span v-if="(action === 'XFER' || action === 'READY') && strip.xferFrequency" class="action-freq">{{ strip.xferFrequency }}</span>
        </button>
      </div>
      <div v-else class="strip-right strip-right-empty"></div>
    </template>
    </template><!-- end v-else (normal strip layout) -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUpdated, onUnmounted, watch } from 'vue'
import type { FlightStrip } from '@/types/efs'
import { useEfsStore } from '@/store/efs'
import { getTouchDragInstance } from '@/composables/useTouchDrag'
import ClearanceDialog from './ClearanceDialog.vue'
import FlightplanDialog from './FlightplanDialog.vue'

const props = defineProps<{
  strip: FlightStrip
  sectionId: string
  bayId: string
}>()

const store = useEfsStore()
const stripElement = ref<HTMLElement | null>(null)
const isDragging = ref(false)

// Fly-across animation for auto-moved strips
const AUTO_MOVE_DURATION = 500 // ms

// Check synchronously during setup so the strip renders hidden from the first frame (no flash)
const isAutoMoving = ref(store.autoMoveData.has(props.strip.id))

function tryAutoMoveAnimation() {
  const data = store.autoMoveData.get(props.strip.id)
  if (!data) return
  store.autoMoveData.delete(props.strip.id)

  const el = stripElement.value
  if (!el) return

  const { rect: oldRect, clone } = data

  // Position clone at old location as a fixed overlay
  clone.style.position = 'fixed'
  clone.style.left = `${oldRect.left}px`
  clone.style.top = `${oldRect.top}px`
  clone.style.width = `${oldRect.width}px`
  clone.style.height = `${oldRect.height}px`
  clone.style.zIndex = '9999'
  clone.style.pointerEvents = 'none'
  clone.style.margin = '0'
  clone.style.transition = 'none'
  document.body.appendChild(clone)

  // Defer measurement so shifted strips settle first (they arrive as separate WS messages)
  requestAnimationFrame(() => {
    const newRect = el.getBoundingClientRect()

    // Skip if no visible movement
    if (Math.abs(oldRect.left - newRect.left) < 1 && Math.abs(oldRect.top - newRect.top) < 1) {
      clone.remove()
      isAutoMoving.value = false
      return
    }

    const anim = clone.animate([
      { left: `${oldRect.left}px`, top: `${oldRect.top}px` },
      { left: `${newRect.left}px`, top: `${newRect.top}px` }
    ], {
      duration: AUTO_MOVE_DURATION,
      easing: 'ease-in-out',
      fill: 'forwards'
    })

    anim.onfinish = () => {
      clone.remove()
      isAutoMoving.value = false
    }
  })
}

// Strip may be remounted (new parent section) or updated in place
onMounted(tryAutoMoveAnimation)
onUpdated(tryAutoMoveAnimation)

// Context menu state
const menuOpen = ref(false)
const menuPosition = ref<[number, number]>([0, 0])
const transferMenuOpen = ref(false)
const groundStateMenuOpen = ref(false)
const ctotMenuOpen = ref(false)
const reaMenuOpen = ref(false)

// Ground state options: code (shown in menu), label, action (sent to backend), groundstate (for highlighting current)
const groundStateOptions = [
  { code: 'FRQ', label: 'On Freq', action: 'FRQ', groundstate: 'ONFREQ' },
  { code: 'S/U', label: 'Startup', action: 'STUP', groundstate: 'STUP' },
  { code: 'RDY', label: 'De-ice', action: 'DEICE', groundstate: 'DE-ICE' },
  { code: 'S/P', label: 'Push', action: 'PUSH', groundstate: 'PUSH' },
  { code: 'TXO', label: 'Taxi Out', action: 'TXO', groundstate: 'TAXI' },
  { code: 'L/U', label: 'Lineup', action: 'LU', groundstate: 'LINEUP' },
  { code: 'CTO', label: 'Takeoff', action: 'CTO', groundstate: 'DEPA' },
  { code: 'ARR', label: 'Arrived', action: 'ARR', groundstate: 'ARR' },
  { code: 'CTL', label: 'Cleared to Land', action: 'CTL_GS', groundstate: 'ARR', extra: true },
  { code: 'TXI', label: 'Taxi In', action: 'TXI', groundstate: 'TXIN' },
  { code: 'PRK', label: 'Parked', action: 'PARK', groundstate: 'PARK' },
  { code: '---', label: 'No State', action: 'NOGS', groundstate: '' },
]

const groundStateLabel = computed(() => {
  const gs = props.strip.groundstate ?? ''
  const match = groundStateOptions.find(o => o.groundstate === gs && !o.extra)
  return match ? match.code : gs || '---'
})

// Dialog state
const clncDialogOpen = ref(false)
const fplDialogOpen = ref(false)
const deleteDialogOpen = ref(false)

// Note strip state
const isNote = computed(() => props.strip.stripType === 'note')
const showOwnerSi = computed(() => {
  if (!store.showStripOwnership || isNote.value) return false
  if (props.strip.transferPending) return !!props.strip.transferSi
  return !!props.strip.ownerSi
})
const isTransferIn = computed(() => !isNote.value && props.strip.transferPending === 'in')
const isTransferOut = computed(() => !isNote.value && props.strip.transferPending === 'out')
/** Dim other-owned strips only when ownership display (and dimming) are enabled */
const shouldDimOwnership = computed(() =>
  store.showStripOwnership &&
  store.dimOtherOwnedStrips &&
  !!props.strip.ownedByOther &&
  !isTransferIn.value &&
  !isNote.value
)
/** Pending transfer: destination SI only (arrow via CSS); otherwise current owner SI */
const ownerSiText = computed(() => {
  if (props.strip.transferPending && props.strip.transferSi) {
    return props.strip.transferSi
  }
  return props.strip.ownerSi || ''
})
const ownerSiClass = computed(() => ({
  'si-transfer-in': isTransferIn.value,
  'si-transfer-out': isTransferOut.value,
}))
const ownerSiTitle = computed(() => {
  const withFreq = (callsign: string | undefined, freq: string | undefined, fallbackSi: string | undefined) => {
    const who = callsign || fallbackSi
    if (!who) return undefined
    return freq ? `${who} ${freq}` : who
  }
  if (props.strip.transferPending) {
    const target = withFreq(props.strip.transferCallsign, props.strip.transferFrequency, props.strip.transferSi)
    return target ? `Transfer to ${target}` : 'Pending transfer'
  }
  const owner = withFreq(props.strip.ownerCallsign, props.strip.ownerFrequency, props.strip.ownerSi)
  return owner ? `Tracked by ${owner}` : undefined
})
const isDeparture = computed(() => props.strip.stripType === 'departure' || props.strip.stripType === 'local')
const effectiveActionCount = computed(() => props.strip.actions?.length ?? 0)
const noteEditing = ref(false)
const noteText = ref('')
const noteInitialText = ref('')
const noteDirty = ref(false)
const noteInput = ref<HTMLInputElement | null>(null)

// Remarks state
const remarksEditing = ref(false)
const remarksText = ref('')
const remarksInitialText = ref('')
const remarksDirty = ref(false)
const remarksInput = ref<HTMLInputElement | null>(null)

function onNoteClick() {
  // Keep in-progress text if already editing; avoid resetting from stale strip.noteText.
  // Still re-focus the input (important for touch interactions).
  if (noteEditing.value) {
    nextTick(() => {
      noteInput.value?.focus()
    })
    return
  }
  noteText.value = props.strip.noteText ?? ''
  noteInitialText.value = noteText.value
  noteDirty.value = false
  noteEditing.value = true
  nextTick(() => {
    noteInput.value?.focus()
  })
}

function onNoteInput() {
  noteDirty.value = true
}

function onNoteTouch(event: TouchEvent) {
  if (isDragging.value) return // Let the strip's touchend handler clean up the drag
  // Cancel any pending drag timer that touchstart may have started
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  touchStarted = false
  event.stopPropagation()
  event.preventDefault()
  onNoteClick()
}

function onNoteBlur() {
  noteEditing.value = false
  if (!noteDirty.value) return
  const text = noteText.value.trim()
  if (text !== noteInitialText.value) {
    store.updateNote(props.strip.id, text)
  }
}

// Auto-focus note strips that are newly created (empty text)
onMounted(() => {
  if (isNote.value && !props.strip.noteText) {
    onNoteClick()
  }
})

// Remarks handlers
function startRemarksEditing() {
  remarksText.value = props.strip.remarks ?? ''
  remarksInitialText.value = remarksText.value
  remarksDirty.value = false
  remarksEditing.value = true
  nextTick(() => {
    remarksInput.value?.focus()
  })
}

function onRemarksClick() {
  if (remarksEditing.value) {
    nextTick(() => remarksInput.value?.focus())
    return
  }
  startRemarksEditing()
}

function onRemarksMenuClick() {
  menuOpen.value = false
  startRemarksEditing()
}

function onRemarksInput() {
  remarksText.value = remarksText.value.toUpperCase()
  remarksDirty.value = true
}

function onRemarksBlur() {
  remarksEditing.value = false
  if (!remarksDirty.value) return
  const text = remarksText.value.trim()
  if (text !== remarksInitialText.value) {
    store.updateRemarks(props.strip.id, text)
  }
}

function onRemarksCancel() {
  remarksDirty.value = false
  remarksEditing.value = false
}

// Touch drag state
let touchStarted = false
let longPressTimer: number | null = null
const LONG_PRESS_DELAY = 150 // ms before drag starts

const touchDrag = getTouchDragInstance()

const stripTypeClass = computed(() => `strip-${props.strip.stripType}`)

const stripStyle = computed(() => {
  const style: Record<string, string> = {}
  if (!store.isController) {
    style['grid-template-columns'] = '10px auto minmax(0, 1fr) auto'
  }
  return style
})

/** CDM (TOBT/TSAT) is only available at ESSA */
const CDM_AIRPORTS = new Set(['ESSA'])
/** Single-airport CDM ground sections */
const CDM_SECTIONS_EXACT = new Set(['pending_dep', 'cleared', 'push_start'])
/** Taxi and later — hide EOBT when a CTOT is present */
const TAXI_ONWARD_SECTIONS = new Set(['taxi', 'runway', 'dep_runway', 'arr_runway', 'ctr_dep', 'rwy'])

/** Ground clearance sections where TOBT/TSAT apply (not CTR DEP). */
function isCdmGroundSection(sectionId: string): boolean {
  if (CDM_SECTIONS_EXACT.has(sectionId)) return true
  // RTC columns: bay1_dep / bay1_twy / idle_dep — never ctr_dep
  return /^(bay\d+|idle)_(dep|twy)$/.test(sectionId)
}

function sectionIdMatches(sectionId: string, allowed: Set<string>): boolean {
  if (allowed.has(sectionId)) return true
  const logical = sectionId.includes('_') ? sectionId.slice(sectionId.lastIndexOf('_') + 1) : sectionId
  return allowed.has(logical)
}

const isDepartingIfr = computed(() =>
  props.strip.stripType === 'departure' &&
  (props.strip.flightRules === 'I' || props.strip.flightRules === 'Y')
)

const showCdm = computed(() =>
  isDepartingIfr.value &&
  CDM_AIRPORTS.has(props.strip.adep) &&
  isCdmGroundSection(props.strip.sectionId) &&
  !props.strip.clearedForTakeoff
)

/** CTOT shown for any bay/section while still a ground IFR departure */
const showCtot = computed(() =>
  isDepartingIfr.value && !!props.strip.ctot && !props.strip.clearedForTakeoff
)

/** Hide EOBT on taxi+ when CTOT is shown (CDM primary times already gated by showCdm) */
const showPrimaryTime = computed(() =>
  !(showCtot.value && sectionIdMatches(props.strip.sectionId, TAXI_ONWARD_SECTIONS))
)

/**
 * Parse vIFF/CDM network status for strip UI.
 * Shown: REA (badge), FLS variants (time label + tooltip).
 * Not shown: COMPLY, AIRB, ATC_ACTIV, DES, SAM, SRM, SLC, etc.
 */
function parseCdmSts(sts: string | undefined): {
  kind: 'rea' | 'fls'
  raw: string
  flsType?: string
  badge: string
} | null {
  if (!sts) return null
  const raw = sts.trim().toUpperCase()
  if (!raw) return null
  if (raw === 'REA') return { kind: 'rea', raw, badge: 'REA' }

  if (raw === 'SUSP' || raw === 'FLS') {
    return { kind: 'fls', raw, badge: 'FLS' }
  }
  const flsPrefix = raw.match(/^FLS[-_/](.+)$/)
  const flsSuffix = raw.match(/^(.+)[-_/]FLS$/)
  if (flsPrefix || flsSuffix || raw.includes('FLS')) {
    const type = (flsPrefix?.[1] || flsSuffix?.[1] || '').replace(/^[-_/]+|[-_/]+$/g, '')
    return {
      kind: 'fls',
      raw,
      flsType: type && type !== 'FLS' ? type : undefined,
      badge: 'FLS',
    }
  }

  return null
}

/** Tooltip text for FLS / FLS-subtype */
function flsTooltip(raw: string, flsType?: string): string {
  const subtypeHelp: Record<string, string> = {
    CDM: 'CDM (TOBT/TSAT related suspension)',
    NRA: 'No Regulation Available / not ready',
    MR: 'Mandatory Route non-compliance',
    GS: 'Ground Stop',
  }
  if (flsType) {
    const help = subtypeHelp[flsType] || flsType
    return `FLS — ${help} (${raw})`
  }
  if (raw === 'SUSP') return 'FLS — Suspended (SUSP)'
  return 'FLS — Flight Suspended'
}

const cdmStatus = computed(() =>
  isDepartingIfr.value ? parseCdmSts(props.strip.cdmSts) : null
)

const isFls = computed(() => cdmStatus.value?.kind === 'fls')
const isRea = computed(() => cdmStatus.value?.kind === 'rea')

/** Badge above CTOT (or primary time if no CTOT). FLS uses primary label instead. */
const networkStatusBadge = computed(() => {
  const sts = cdmStatus.value
  if (!sts || sts.kind === 'fls') return null
  return sts.badge
})

const networkStatusClass = computed(() => {
  const sts = cdmStatus.value
  if (!sts || sts.kind !== 'rea') return {}
  return { 'sts-rea': true }
})

const canSendRea = computed(() =>
  store.isController && showCtot.value && !isRea.value
)

/** REA can appear above TOBT (no CTOT) or CTOT — allow clear in both cases */
const canClearRea = computed(() =>
  store.isController && isRea.value
)

/** UTC clock tick for TSAT window / FLS label blink */
const nowUtcMs = ref(Date.now())
let tsatWindowTimer: ReturnType<typeof setInterval> | undefined

const primaryTimeValue = computed(() => {
  if (showCdm.value) {
    return props.strip.tobt || props.strip.eobt || ''
  }
  if (props.strip.stripType === 'departure' || props.strip.stripType === 'local') {
    return props.strip.eobt || ''
  }
  return props.strip.eta || ''
})

/** CDM plugin: alternate FLS ↔ subtype (CDM/NRA/MR/GS) every 2s */
const primaryTimeLabel = computed(() => {
  if (isFls.value) {
    const type = cdmStatus.value?.flsType
    if (type) {
      const phase = Math.floor(nowUtcMs.value / 2000) % 2
      return phase === 0 ? 'FLS' : type
    }
    return 'FLS'
  }
  if (showCdm.value) return 'TOBT'
  if (props.strip.stripType === 'departure' || props.strip.stripType === 'local') return 'EOBT'
  return 'ETA'
})

const canEditPrimaryTime = computed(() =>
  store.isController && (isFls.value || showCdm.value)
)

const showTobtSetBy = computed(() =>
  showCdm.value && !isFls.value && (props.strip.tobtSetBy === 'P' || props.strip.tobtSetBy === 'A')
)

const tobtSetByTitle = computed(() => {
  if (!showTobtSetBy.value) return undefined
  return props.strip.tobtSetBy === 'P' ? 'TOBT set by Pilot' : 'TOBT set by ATC'
})

const primaryTimeLabelTitle = computed(() => {
  if (isFls.value) {
    return flsTooltip(cdmStatus.value?.raw || 'FLS', cdmStatus.value?.flsType)
  }
  return tobtSetByTitle.value
})

/** Brief flash when TOBT/TSAT/CTOT values change (incl. pilot TOBT updates) */
const TIME_CHANGED_FLASH_MS = 5000
const tobtChanged = ref(false)
const tsatChanged = ref(false)
const ctotChanged = ref(false)
let tobtChangedTimer: ReturnType<typeof setTimeout> | undefined
let tsatChangedTimer: ReturnType<typeof setTimeout> | undefined
let ctotChangedTimer: ReturnType<typeof setTimeout> | undefined

function triggerTimeChangedFlash(which: 'tobt' | 'tsat' | 'ctot') {
  if (!store.flashChangedTimes) return
  if (which === 'tobt') {
    tobtChanged.value = true
    if (tobtChangedTimer) clearTimeout(tobtChangedTimer)
    tobtChangedTimer = setTimeout(() => {
      tobtChanged.value = false
      tobtChangedTimer = undefined
    }, TIME_CHANGED_FLASH_MS)
  } else if (which === 'tsat') {
    tsatChanged.value = true
    if (tsatChangedTimer) clearTimeout(tsatChangedTimer)
    tsatChangedTimer = setTimeout(() => {
      tsatChanged.value = false
      tsatChangedTimer = undefined
    }, TIME_CHANGED_FLASH_MS)
  } else {
    ctotChanged.value = true
    if (ctotChangedTimer) clearTimeout(ctotChangedTimer)
    ctotChangedTimer = setTimeout(() => {
      ctotChanged.value = false
      ctotChangedTimer = undefined
    }, TIME_CHANGED_FLASH_MS)
  }
}

onMounted(() => {
  tsatWindowTimer = setInterval(() => {
    nowUtcMs.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (tsatWindowTimer) clearInterval(tsatWindowTimer)
  if (tobtChangedTimer) clearTimeout(tobtChangedTimer)
  if (tsatChangedTimer) clearTimeout(tsatChangedTimer)
  if (ctotChangedTimer) clearTimeout(ctotChangedTimer)
})

/** Normalize CDM times (HHMM or HHMMSS) to minutes since midnight */
function hhmmToMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return null
  const normalized = digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  const h = Number(normalized.slice(0, 2))
  const m = Number(normalized.slice(2, 4))
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

function normalizeHhmmDisplay(hhmm: string | undefined): string {
  if (!hhmm) return ''
  const digits = hhmm.replace(/\D/g, '')
  if (digits.length < 3) return ''
  return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
}

const displayTsat = computed(() => normalizeHhmmDisplay(props.strip.tsat))

// Non-immediate: flash only on real HHMM→HHMM changes.
// Ignore appear/clear during strip refresh (e.g. REA remove + vIFF poll).
// ATC-set TOBT (setBy A) — no highlight; still flash for pilot (P).
watch(
  () => normalizeHhmmDisplay(props.strip.tobt),
  (next, prev) => {
    if (!next || !prev || next === prev) return
    if (props.strip.tobtSetBy === 'A') return
    triggerTimeChangedFlash('tobt')
  },
)

watch(
  () => displayTsat.value,
  (next, prev) => {
    if (!next || !prev || next === prev) return
    triggerTimeChangedFlash('tsat')
  },
)

watch(
  () => {
    const c = props.strip.ctot || ''
    const digits = c.replace(/\D/g, '')
    if (digits.length < 3) return ''
    return digits.length === 3 ? digits.padStart(4, '0') : digits.slice(0, 4)
  },
  (next, prev) => {
    if (!next || !prev || next === prev) return
    triggerTimeChangedFlash('ctot')
  },
)

/**
 * GNG-style TSAT colours (UTC / Zulu), minute-inclusive:
 * - green: TSAT−5:00 … TSAT+5:00  (startup window)
 * - flash green↔yellow: last clock minute (TSAT+5:00 … TSAT+6:00)
 * - yellow + strikethrough: after window (TSAT+6:00 …)
 * - no colour before TSAT−5
 */
const tsatColorClass = computed(() => {
  if (!showCdm.value || !props.strip.tsat) return {}
  const tsatMin = hhmmToMinutes(props.strip.tsat)
  if (tsatMin == null) return {}

  const now = new Date(nowUtcMs.value)
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  const nowSec = nowMin * 60 + now.getUTCSeconds()
  const tsatSec = tsatMin * 60
  let deltaSec = nowSec - tsatSec
  if (deltaSec > 12 * 3600) deltaSec -= 24 * 3600
  if (deltaSec < -12 * 3600) deltaSec += 24 * 3600

  // Past window: expired TSAT
  if (deltaSec >= 6 * 60) return { 'tsat-expired': true }
  // Last clock minute of ±5 window (e.g. TSAT 1052 → flash all of 1057z)
  if (deltaSec >= 5 * 60 && deltaSec < 6 * 60) {
    return store.flashTsatWindow ? { 'tsat-flash': true } : { 'tsat-window': true }
  }
  // Inside TSAT±5 (before last minute): green
  if (deltaSec >= -5 * 60 && deltaSec < 5 * 60) return { 'tsat-window': true }

  return {}
})

const timeEditing = ref(false)
const timeEditMode = ref<'eobt' | 'tobt'>('eobt')
const timeEditText = ref('')
const timeEditInput = ref<HTMLInputElement | null>(null)

function onPrimaryTimeClick() {
  if (!canEditPrimaryTime.value) return
  if (isFls.value) {
    timeEditMode.value = 'eobt'
    timeEditText.value = props.strip.eobt || ''
  } else if (showCdm.value) {
    timeEditMode.value = 'tobt'
    timeEditText.value = props.strip.tobt || props.strip.eobt || ''
  } else {
    return
  }
  timeEditing.value = true
  nextTick(() => timeEditInput.value?.focus())
}

function onReadyTobtClick() {
  if (!store.isController || !showCdm.value || isFls.value) return
  timeEditing.value = false
  // Server sets TOBT=now then REA sequentially (avoids REA-only races)
  store.viffReadyTobt(props.strip.id)
}

function onTimeEditCancel() {
  timeEditing.value = false
}

function onTimeEditBlur() {
  if (!timeEditing.value) return
  const value = timeEditText.value.trim()
  const mode = timeEditMode.value
  timeEditing.value = false
  if (!/^\d{4}$/.test(value)) return
  if (mode === 'tobt') {
    if (value !== (props.strip.tobt || props.strip.eobt || '')) {
      store.viffUpdateTobt(props.strip.id, value)
    }
  } else if (value !== props.strip.eobt) {
    store.viffUpdateEobt(props.strip.id, value)
  }
}

function onCtotClick(event: MouseEvent) {
  if (!store.isController || !showCtot.value) return
  menuPosition.value = [event.clientX, event.clientY]
  menuOpen.value = false
  transferMenuOpen.value = false
  groundStateMenuOpen.value = false
  reaMenuOpen.value = false
  ctotMenuOpen.value = true
}

function onSendReaClick() {
  ctotMenuOpen.value = false
  reaMenuOpen.value = false
  menuOpen.value = false
  if (!canSendRea.value) return
  store.viffRea(props.strip.id, true)
}

function onClearReaClick() {
  ctotMenuOpen.value = false
  reaMenuOpen.value = false
  menuOpen.value = false
  if (!canClearRea.value) return
  store.viffRea(props.strip.id, false)
}

function onReaBadgeClick(event: MouseEvent) {
  if (!canClearRea.value) return
  menuPosition.value = [event.clientX, event.clientY]
  menuOpen.value = false
  transferMenuOpen.value = false
  groundStateMenuOpen.value = false
  // With CTOT, reuse the CTOT menu (reason + Remove REA); otherwise REA-only menu
  if (showCtot.value) {
    reaMenuOpen.value = false
    ctotMenuOpen.value = true
  } else {
    ctotMenuOpen.value = false
    reaMenuOpen.value = true
  }
}

// DCL button coloring + action highlight
function actionButtonClass(action: string): Record<string, boolean> {
  const classes: Record<string, boolean> = {}

  // Highlight actions (TXI, PARK, XFER)
  if (props.strip.highlightActions?.includes(action)) {
    classes['action-highlight'] = true
  }

  // ASSUME needs condensed text
  if (action === 'ASSUME') {
    classes['action-assume'] = true
  }

  // GOA gets its own colour
  if (action === 'GOA') {
    classes['action-goa'] = true
  }

  // DCL status coloring for CLNC button
  if (action === 'CLNC') {
    const status = props.strip.dclStatus
    classes['action-dcl-request'] = status === 'REQUEST'
    classes['action-dcl-error'] = status === 'INVALID' || status === 'UNABLE' || status === 'REJECTED'
    classes['action-dcl-sent'] = status === 'SENT'
  }

  return classes
}

// Mouse/pointer drag handlers (desktop)
function onDragStart(event: DragEvent) {
  isDragging.value = true
  if (event.dataTransfer && stripElement.value) {
    const rect = stripElement.value.getBoundingClientRect()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/json', JSON.stringify({
      stripId: props.strip.id,
      bayId: props.bayId,
      sectionId: props.sectionId,
      isBottom: props.strip.bottom,
      originalTop: rect.top,
      originalBottom: rect.bottom,
      stripHeight: rect.height,
      dragOffsetY: event.clientY - rect.top // Offset from cursor to strip top
    }))
  }
}

function onDragEnd() {
  isDragging.value = false
}

// Touch drag handlers for drag areas (strip-left)
function onDragAreaTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1) return

  // Don't start drag when touching interactive elements
  const target = event.target as HTMLElement
  if (target.closest('.action-button') || target.closest('.squawk-empty') || target.closest('.callsign') || target.closest('.note-input')) return

  touchStarted = true

  const touch = event.touches[0]

  // Start drag after a short delay to distinguish from scroll
  longPressTimer = window.setTimeout(() => {
    if (touchStarted && stripElement.value && touch) {
      // Prevent context menu by stopping the event chain early
      event.preventDefault()
      isDragging.value = true
      const rect = stripElement.value.getBoundingClientRect()
      touchDrag.startDrag(stripElement.value, {
        stripId: props.strip.id,
        bayId: props.bayId,
        sectionId: props.sectionId,
        isBottom: props.strip.bottom,
        originalTop: rect.top,
        originalBottom: rect.bottom,
        stripHeight: rect.height,
        dragOffsetY: touch.clientY - rect.top
      }, touch)
    }
  }, LONG_PRESS_DELAY)
}

function onDragAreaTouchMove(event: TouchEvent) {
  if (!touchStarted) return

  if (isDragging.value && event.touches.length === 1 && event.touches[0]) {
    touchDrag.moveDrag(event.touches[0])
  }
}

function onDragAreaTouchEnd(event: TouchEvent) {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    const result = touchDrag.endDrag()

    if (result.dropTarget && result.data) {
      // Find the section info from the drop target
      const sectionEl = result.dropTarget.closest('.efs-section')
      const bayEl = sectionEl?.closest('.efs-bay')

      if (sectionEl && bayEl) {
        const targetSectionId = sectionEl.getAttribute('data-section-id')
        const targetBayId = bayEl.getAttribute('data-bay-id')

        if (targetSectionId && targetBayId) {
          if (result.isBottomDrop) {
            // Move to bottom strips - no gap logic for bottom strips
            store.moveStripToBottom(
              result.data.stripId,
              targetBayId,
              targetSectionId,
              result.dropPosition
            )
          } else {
            // Apply gap logic (same as desktop onTopDrop)
            handleTouchDropWithGaps(
              result.data,
              targetBayId,
              targetSectionId,
              result.dropTarget,
              result.draggedStripTop,
              result.touchY
            )
          }
        }
      }
    }

    isDragging.value = false
  }

  touchStarted = false
}

// Handle touch drop with full gap logic (mirrors EfsSection.vue onTopDrop)
function handleTouchDropWithGaps(
  data: { stripId: string; bayId: string; sectionId: string; isBottom?: boolean; originalTop?: number; originalBottom?: number; stripHeight?: number; dragOffsetY?: number },
  targetBayId: string,
  targetSectionId: string,
  dropTarget: HTMLElement,
  draggedStripTop: number,
  touchY: number
) {
  const { stripId, bayId: sourceBayId, sectionId: sourceSectionId, originalTop, originalBottom, stripHeight, dragOffsetY } = data

  // Find the top-strips-container within the drop target
  const container = dropTarget.querySelector('.top-strips-container') || dropTarget
  if (!container) {
    store.moveStripToSection(stripId, targetBayId, targetSectionId, 0)
    return
  }

  // If section is auto time-sorted, align store positions to what the user sees
  store.syncTimeSortSectionFromDom(targetBayId, targetSectionId, container)

  // Only consider "same section" if strip is in top zone of same section
  // Strips from bottom zone don't leave a space in top zone, so treat as cross-section move
  const isSameSection = sourceBayId === targetBayId && sourceSectionId === targetSectionId && !data.isBottom
  const allStripElements = Array.from(container.querySelectorAll('.flight-strip'))
  const allGapElements = Array.from(container.querySelectorAll('.strip-gap'))

  const draggedStripHeight = stripHeight || 50

  // Find the dragged strip's current index
  let draggedIndex = -1
  for (let i = 0; i < allStripElements.length; i++) {
    const el = allStripElements[i]
    if (el && el.getAttribute('data-strip-id') === stripId) {
      draggedIndex = i
      break
    }
  }

  // Check if drop happened on a gap
  let droppedOnGap = false
  let gapIndex = -1
  let gapRect: DOMRect | null = null
  let dropOnTopHalf = false

  for (const gapEl of allGapElements) {
    const rect = gapEl.getBoundingClientRect()
    if (touchY >= rect.top && touchY <= rect.bottom) {
      droppedOnGap = true
      gapIndex = parseInt(gapEl.getAttribute('data-gap-index') || '-1')
      gapRect = rect
      dropOnTopHalf = touchY < rect.top + rect.height / 2
      break
    }
  }

  // Handle drop on gap
  if (droppedOnGap && gapIndex !== -1 && gapRect) {
    const currentGapSize = store.getGapAtIndex(targetBayId, targetSectionId, gapIndex)

    // Check if the dragged strip was adjacent to this gap
    const wasAboveGap = isSameSection && draggedIndex === gapIndex - 1
    const wasBelowGap = isSameSection && draggedIndex === gapIndex

    // Calculate new gap size
    let newGapSize: number
    if (wasBelowGap && originalTop !== undefined) {
      // Strip below gap dragged upward - reduce gap by the distance dragged up
      const draggedUpDistance = originalTop - draggedStripTop
      newGapSize = draggedUpDistance > 0 ? Math.max(0, currentGapSize - draggedUpDistance) : currentGapSize
    } else if (wasAboveGap) {
      // Strip above gap dropped on gap - keep gap unchanged
      newGapSize = currentGapSize
    } else {
      // Strip from elsewhere - reduce gap by strip height
      newGapSize = currentGapSize - draggedStripHeight
    }

    // Remove the gap before moving (so adjustGapsForMove doesn't affect it)
    store.removeGapAtIndex(targetBayId, targetSectionId, gapIndex)

    // Determine insert position based on which half of the gap was hit
    let insertPosition: number

    if (dropOnTopHalf) {
      if (isSameSection && draggedIndex < gapIndex) {
        insertPosition = gapIndex - 1
      } else {
        insertPosition = gapIndex
      }
    } else {
      if (isSameSection && draggedIndex < gapIndex) {
        insertPosition = gapIndex - 1
      } else {
        insertPosition = gapIndex
      }
    }

    // Move the strip
    store.moveStripToSection(stripId, targetBayId, targetSectionId, insertPosition)

    // Re-add the gap at the correct position with the new size
    if (newGapSize >= store.GAP_BUFFER) {
      if (dropOnTopHalf) {
        store.setGapAtIndex(targetBayId, targetSectionId, insertPosition + 1, newGapSize)
      } else {
        store.setGapAtIndex(targetBayId, targetSectionId, insertPosition, newGapSize)
      }
    }

    return
  }

  // Calculate position, skipping the dragged strip for same-section moves
  const stripElements = isSameSection
    ? allStripElements.filter(el => el.getAttribute('data-strip-id') !== stripId)
    : allStripElements

  // Find drop position and check if dropping below last strip
  let position = stripElements.length
  let droppedBelowLastStrip = false
  let distanceBelowLastStrip = 0
  let droppedIntoEmptySection = false
  let distanceFromTop = 0

  if (stripElements.length > 0) {
    const lastStrip = stripElements[stripElements.length - 1]
    if (lastStrip) {
      const lastRect = lastStrip.getBoundingClientRect()
      if (draggedStripTop > lastRect.bottom) {
        droppedBelowLastStrip = true
        distanceBelowLastStrip = draggedStripTop - lastRect.bottom
      }
    }
  } else {
    // Empty section - check distance from container top
    const containerRect = container.getBoundingClientRect()
    distanceFromTop = draggedStripTop - containerRect.top
    if (distanceFromTop >= store.GAP_BUFFER) {
      droppedIntoEmptySection = true
    }
  }

  // Find position based on midpoints (using touchY for consistency with desktop using clientY)
  for (let i = 0; i < stripElements.length; i++) {
    const element = stripElements[i]
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2

    if (touchY < midpoint) {
      position = i
      droppedBelowLastStrip = false
      break
    }
  }

  // Handle same-section gap adjustments
  if (isSameSection && draggedIndex !== -1) {
    const currentGap = store.getGapAtIndex(targetBayId, targetSectionId, draggedIndex)

    // Check if position is effectively unchanged
    if (position === draggedIndex || (position === draggedIndex + 1 && draggedIndex === stripElements.length)) {
      if (originalTop !== undefined && originalBottom !== undefined) {
        const stripTopY = draggedStripTop

        // Get the position of the strip above
        const prevStripEl = draggedIndex > 0 ? allStripElements[draggedIndex - 1] : null
        const measureFromY = prevStripEl
          ? prevStripEl.getBoundingClientRect().bottom
          : container.getBoundingClientRect().top

        // Dragging down = increase gap (only for last strip)
        if (stripTopY > measureFromY + store.GAP_BUFFER && draggedIndex == stripElements.length) {
          const newGap = stripTopY - measureFromY
          store.setGapAtIndex(targetBayId, targetSectionId, draggedIndex, newGap)
          return
        }

        // Dragging up = decrease gap
        if (stripTopY < originalTop && currentGap > 0) {
          const delta = originalTop - stripTopY
          store.setGapAtIndex(targetBayId, targetSectionId, draggedIndex, Math.max(0, currentGap - delta))
          return
        }
      }

      // Dropped within original bounds - no change
      return
    }
  }

  // Move the strip
  store.moveStripToSection(stripId, targetBayId, targetSectionId, position)

  // Create gap if dropped below last strip with enough distance
  if (droppedBelowLastStrip && distanceBelowLastStrip >= store.GAP_BUFFER) {
    const gapSize = isSameSection
      ? distanceBelowLastStrip + draggedStripHeight
      : distanceBelowLastStrip
    store.setGapAtIndex(targetBayId, targetSectionId, position, gapSize)
  }

  // Create gap if dropped into empty section below the buffer distance
  if (droppedIntoEmptySection) {
    store.setGapAtIndex(targetBayId, targetSectionId, 0, distanceFromTop)
  }
}

function onDragAreaTouchCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    touchDrag.cancelDrag()
    isDragging.value = false
  }

  touchStarted = false
}

// Action button handlers
function onActionClick(action: string) {
  if (action === 'CLNC') {
    clncDialogOpen.value = true
    return
  }
  store.sendStripAction(props.strip.id, action)
}

function onActionTouch(event: TouchEvent, action: string) {
  event.preventDefault()
  if (action === 'CLNC') {
    clncDialogOpen.value = true
    return
  }
  store.sendStripAction(props.strip.id, action)
}


function onResetSquawk() {
  store.sendStripAction(props.strip.id, 'resetSquawk')
}

function onStripClick() {
  // Future: open strip detail/edit modal
}

function onContextMenu(event: MouseEvent) {
  menuPosition.value = [event.clientX, event.clientY]
  ctotMenuOpen.value = false
  reaMenuOpen.value = false
  menuOpen.value = true
}

function onCallsignClick(event: MouseEvent) {
  menuPosition.value = [event.clientX, event.clientY]
  ctotMenuOpen.value = false
  reaMenuOpen.value = false
  menuOpen.value = true
}

function onCallsignTouch(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (touch) {
    menuPosition.value = [touch.clientX, touch.clientY]
    ctotMenuOpen.value = false
    reaMenuOpen.value = false
    menuOpen.value = true
  }
}

function onFplClick() {
  fplDialogOpen.value = true
  menuOpen.value = false
}

function onClncMenuClick() {
  clncDialogOpen.value = true
  menuOpen.value = false
}

function onDeleteClick() {
  menuOpen.value = false
  if (isNote.value) {
    store.deleteStrip(props.strip.id)
    return
  }
  deleteDialogOpen.value = true
}

function onDeleteConfirm() {
  store.deleteStrip(props.strip.id)
  deleteDialogOpen.value = false
}

function onReleaseClick() {
  menuOpen.value = false
  store.releaseStrip(props.strip.id)
}

/** Cancel pending outbound handoff by re-assuming */
function onAssumeClick() {
  menuOpen.value = false
  store.sendStripAction(props.strip.id, 'ASSUME')
}

function onTransferClick(targetCallsign: string) {
  menuOpen.value = false
  transferMenuOpen.value = false
  store.manualTransfer(props.strip.id, targetCallsign)
}

function onGroundStateClick(action: string) {
  menuOpen.value = false
  groundStateMenuOpen.value = false
  store.sendStripAction(props.strip.id, action)
}
</script>

<style scoped>
.flight-strip {
  display: grid;
  grid-template-columns: 10px auto minmax(0, 1fr) auto auto;
  background: #f0ebe0;
  border: 1px solid #888;
  margin: 2px 4px;
  min-height: 44px;
  cursor: move;
  transition: all 0.12s ease;
  font-size: 11px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.flight-strip:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
  z-index: 10;
}

.flight-strip.dragging {
  opacity: 0.4;
  transform: scale(0.98);
}

.flight-strip.auto-move-hidden {
  opacity: 0;
}

/* Strip type color indicators */
.strip-indicator {
  transition: filter 0.15s ease;
}

/* Departure - Blue */
.strip-departure .strip-indicator {
  background: #3b7dd8;
}

/* Arrival - Yellow/Amber */
.strip-arrival .strip-indicator {
  background: #daa520;
}

/* Local - Red */
.strip-local .strip-indicator {
  background: #cc4444;
}

/* VFR - Green */
.strip-vfr .strip-indicator {
  background: #3d9e3d;
}

/* Cross - Purple */
.strip-cross .strip-indicator {
  background: #9b59b6;
}

/* Note - Grey */
.strip-note .strip-indicator {
  background: #888;
}

/* Left section - Callsign block (always visible) */
.strip-left {
  width: 75px;
  min-width: 75px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 4px;
  background: #fff;
  border-right: 1px solid #999;
  touch-action: none;
  cursor: move;
}

.callsign {
  font-weight: bold;
  font-size: 13px;
  color: #000;
  letter-spacing: 0.3px;
  line-height: 1.2;
  cursor: pointer;
  touch-action: manipulation;
}

.callsign-sub {
  display: flex;
  gap: 4px;
  font-size: 9px;
  color: #555;
  margin-top: 1px;
  align-items: baseline;
  position: relative;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  padding-right: 1.5em; /* reserved for SI (arrow overlays, does not expand) */
}

.owner-si {
  position: absolute;
  right: 0;
  top: 0;
  font-weight: 700;
  font-size: 10px;
  color: #003399;
  letter-spacing: 0.2px;
  line-height: 1.2;
  flex-shrink: 0;
}

.owner-si.si-transfer-in::before,
.owner-si.si-transfer-out::before {
  content: '→';
  position: absolute;
  right: 100%;
  top: 0;
}

.owner-si.si-transfer-in {
  color: #0a7a28;
}

.owner-si.si-transfer-out {
  color: #b05a00;
}

.flight-strip.owned-by-other {
  opacity: 0.55;
}

.flight-strip.owned-by-other:hover {
  opacity: 0.75;
}

.flight-strip.transfer-pending-in {
  opacity: 1;
  box-shadow: inset 0 0 0 2px #2e8b57;
}

.flight-strip.transfer-pending-out {
  box-shadow: inset 0 0 0 2px #c47a00;
}

.flight-rules {
  font-weight: 600;
  color: #333;
}

.aircraft-type {
  color: #666;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.squawk-stand-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1px;
}

.squawk-stand-row .squawk {
  font-size: 10px;
  color: #444;
  font-weight: 500;
}

.squawk-stand-row .squawk-empty {
  cursor: pointer;
  color: #444;
}

.squawk-stand-row .squawk-empty:hover {
  color: #0055aa;
}

.squawk-stand-row .stand {
  font-size: 10px;
  color: #333;
  font-weight: bold;
}

/* Middle section - truncatable */
.strip-middle {
  overflow: hidden;
  background: #f5f2ea;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* Allow shrinking below content size */
}

/* Remarks row - sits above the strip content fields */
.remarks-row {
  display: flex;
  align-items: center;
  padding: 0 4px;
  min-height: 14px;
  border-bottom: 1px solid #ddd;
}

.remarks-display {
  font-style: italic;
  font-size: 10px;
  color: #2244aa;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  padding: 0 2px;
  line-height: 14px;
}

.remarks-input {
  width: 100%;
  background: transparent;
  border: none;
  font-style: italic;
  font-size: 10px;
  color: #2244aa;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  outline: none;
  padding: 0 2px;
  line-height: 14px;
}

.remarks-input::placeholder {
  color: #999;
  font-style: italic;
  text-transform: none;
}

.strip-middle-content {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

/* Vertical dividers */
.strip-divider {
  width: 1px;
  background: #ddd;
  margin: 2px 0;
  flex-shrink: 0;
}

.strip-section {
  flex-shrink: 0;
}

/* Time section - fixed width, important info */
.strip-time {
  width: 32px;
  min-width: 32px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2px;
}

.strip-time.has-ctot {
  width: 58px;
  min-width: 58px;
}

.strip-time.has-cdm {
  width: 58px;
  min-width: 58px;
}

.strip-time.has-cdm.has-ctot {
  width: 88px;
  min-width: 88px;
}

.time-pair {
  display: flex;
  flex-direction: row;
  gap: 4px;
  align-items: flex-end;
  justify-content: center;
}

.time-col {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.time-value {
  font-weight: 600;
  font-size: 11px;
  color: #222;
}

.time-label {
  font-size: 7px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.tobt-setby {
  font-size: 6px;
  letter-spacing: 0;
}

.time-ctot {
  color: #d97706;
}

.time-label-ctot {
  color: #d97706;
}

.time-sts-label {
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1;
  margin-bottom: 1px;
}

.time-sts-label.sts-rea {
  color: #d97706;
}

.time-sts-label.sts-clickable {
  cursor: pointer;
  text-decoration: none;
}

.time-fls,
.label-fls {
  color: #c00000;
}

/* GNG-style TSAT colours — time value only */
.time-value.tsat-window {
  color: #00a000; /* TSAT±5 startup window — bright green vs black */
}

.time-value.tsat-flash {
  animation: tsat-flash 0.8s step-end infinite;
}

@keyframes tsat-flash {
  0%, 49% { color: #00a000; } /* green — same as TSAT±5 window */
  50%, 100% { color: #d4a017; } /* yellow */
}

.time-value.tsat-expired {
  color: #d4a017;
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

/* Brief highlight when TSAT/CTOT value changes */
.time-value.time-changed {
  color: #b45309 !important;
  animation: time-changed-flash 0.8s ease-in-out infinite;
}

@keyframes time-changed-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.eobt-clickable {
  cursor: pointer;
}

.eobt-clickable:hover:not(:has(.time-sts-label:hover)) .time-value {
  text-decoration: underline;
}

.ctot-clickable {
  cursor: pointer;
}

.ctot-clickable:hover:not(:has(.time-sts-label:hover)) .time-ctot {
  text-decoration: underline;
}

.time-edit-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 40px;
  align-self: stretch;
}

.time-edit-half {
  flex: 1 1 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.time-edit-tobt .time-edit-top {
  border-bottom: 1px solid #bbb;
}

.time-edit-tobt .time-edit-bottom {
  background: #e8e4dc;
}

.eobt-edit-input {
  width: 100%;
  max-width: 48px;
  height: 100%;
  min-height: 18px;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  border: 1px solid #666;
  background: #fff;
  color: #222;
  padding: 0;
  outline: none;
  box-sizing: border-box;
}

.eobt-edit-input.eobt-edit-fls {
  border-color: #c00000;
  color: #c00000;
}

.ready-tobt-btn {
  width: 100%;
  max-width: 48px;
  height: 100%;
  min-height: 18px;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.1px;
  line-height: 1.05;
  padding: 0 1px;
  border: none;
  background: transparent;
  color: #222;
  cursor: pointer;
  white-space: normal;
}

.ready-tobt-btn:hover {
  background: #ddd8ce;
}

.strip-time:has(.time-edit-panel) {
  padding: 0;
  justify-content: stretch;
}

/* SID/Clearance section */
.strip-sid {
  width: 70px;
  min-width: 55px;
  flex-shrink: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 2px;
  overflow: hidden;
}

.sid-value {
  font-weight: 600;
  font-size: 10px;
  color: #0055aa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cleared-data {
  display: flex;
  gap: 4px;
  font-size: 9px;
  margin-top: 2px;
}

.alt {
  color: #0066cc;
  font-weight: 500;
}

.hdg {
  color: #666;
}

/* Airports section - important, try to keep visible */
.strip-airports {
  width: 80px;
  min-width: 35px;
  flex-shrink: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2px 2px;
}

.airport {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  line-height: 1.3;
}

.airport.highlight .icao {
  font-weight: bold;
  color: #000;
}

.icao {
  font-weight: 500;
  color: #444;
  letter-spacing: 0.3px;
}

/* Runway section - fixed on right, always visible */
.strip-runway-fixed {
  min-width: 32px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  background: #e8e4d8;
  border-left: 1px solid #aaa;
}

.strip-runway-fixed .runway-value {
  font-weight: bold;
  font-size: 12px;
  color: #333;
}

/* Clearance triangles (takeoff/landing) - shown in time section */
.clearance-triangle {
  width: 24px;
  height: 24px;
}

.clearance-triangle.takeoff polygon {
  fill: #31bb31;
  stroke: #2e8b2e;
  stroke-width: 1;
}

.clearance-triangle.landing polygon {
  fill: #31bb31;
  stroke: #2e8b2e;
  stroke-width: 1;
}

.single-airport {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* Right section - Action button(s) */
.strip-right {
  width: 40px;
  display: flex;
  align-items: stretch;
  border-left: 1px solid #999;
}

.strip-right-empty {
  background: #e8e4d8;
}

/* Multiple actions: stack vertically */
.strip-right.multi-action {
  flex-direction: column;
}

.strip-right.multi-action .action-button {
  flex: 1;
  border-bottom: 1px solid #999;
}

.strip-right.multi-action .action-button:last-child {
  border-bottom: none;
}

.action-button {
  min-width: 36px;
  width: auto;
  padding: 0 4px;
  border: none;
  background: linear-gradient(to bottom, #e8e8e8, #c8c8c8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
  touch-action: manipulation;
}

.action-button:hover {
  background: linear-gradient(to bottom, #f0f0f0, #d8d8d8);
}

.action-button:active {
  background: linear-gradient(to bottom, #c0c0c0, #a8a8a8);
}

.action-text {
  font-size: 10px;
  font-weight: bold;
  color: #333;
  letter-spacing: 0.3px;
}

.action-assume .action-text {
  font-size: 10px;
  letter-spacing: -0.8px;
  font-stretch: condensed;
}

.action-freq {
  font-size: 10px;
  font-weight: 600;
  color: #555;
  line-height: 1;
  font-stretch: condensed;
}

.action-button:has(.action-freq) {
  flex-direction: column;
  gap: 0px;
  padding: 1px 2px;
}

/* Highlight action buttons (TXI, PARK, XFER) */
.action-highlight {
  background: linear-gradient(to bottom, #fdd835, #f9a825) !important;
}

.action-highlight:hover {
  background: linear-gradient(to bottom, #ffee58, #fbc02d) !important;
}

/* DCL status coloring for CLNC button */
.action-dcl-request {
  background: linear-gradient(to bottom, #fdd835, #f9a825) !important;
  animation: dcl-flash 0.8s ease-in-out infinite;
}

.action-dcl-request:hover {
  background: linear-gradient(to bottom, #ffee58, #fbc02d) !important;
  animation: none;
}

@keyframes dcl-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.action-dcl-error {
  background: linear-gradient(to bottom, #ef5350, #c62828) !important;
}

.action-dcl-error:hover {
  background: linear-gradient(to bottom, #e57373, #d32f2f) !important;
}

.action-dcl-error .action-text {
  color: #fff;
}

.action-dcl-sent {
  background: linear-gradient(to bottom, #66bb6a, #2e7d32) !important;
}

.action-dcl-sent:hover {
  background: linear-gradient(to bottom, #81c784, #388e3c) !important;
}

.action-dcl-sent .action-text {
  color: #fff;
}

/* Greyed-out callsign (no matching flight) */
.callsign-no-match {
  color: #999 !important;
  font-style: italic;
}

/* Note strip layout */
.strip-note-layout {
  grid-template-columns: 10px 1fr !important;
}

.note-content {
  display: flex;
  align-items: center;
  padding: 2px 8px;
  min-height: 40px;
  cursor: text;
}

.note-input {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid #aaa;
  color: #333;
  font-size: 12px;
  font-weight: 500;
  outline: none;
  padding: 2px 0;
  font-family: 'Segoe UI', 'Arial', sans-serif;
}

.note-display {
  font-size: 12px;
  font-weight: 500;
  color: #333;
  word-break: break-word;
}

.note-empty {
  color: #999;
  font-style: italic;
}

/* Context menu styling */
.strip-context-menu {
  min-width: 100px;
  font-size: 12px;
}

.strip-context-menu .v-list-item {
  min-height: 32px;
}

.ctot-menu {
  min-width: 160px;
  max-width: 280px;
}

.ctot-reason-item {
  opacity: 1 !important;
}

.ctot-reason-title {
  font-size: 11px;
  font-weight: 600;
  color: #d97706;
  white-space: normal;
  line-height: 1.3;
}

.transfer-submenu {
  min-width: 150px;
  max-height: 300px;
  overflow-y: auto;
}

.transfer-freq {
  color: #666;
  font-size: 11px;
  margin-left: 8px;
}

.groundstate-submenu {
  min-width: 160px;
  max-height: 400px;
  overflow-y: auto;
}

.gs-code {
  display: inline-block;
  width: 28px;
  font-weight: bold;
  font-size: 11px;
}


</style>

<style>
/* Delete confirmation dialog - unscoped because v-dialog teleports */
.delete-dialog-wrapper {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
}

.delete-dialog {
  background: #2a2a2e;
  border: 2px solid #555;
  padding: 0;
}

.delete-dialog-text {
  padding: 16px;
  color: #e0e0e0;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.delete-dialog-actions {
  display: flex;
  border-top: 1px solid #555;
}

.delete-dialog-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  letter-spacing: 0.5px;
}

.delete-dialog-cancel {
  background: #555;
  color: #ccc;
  border-right: 1px solid #666;
}

.delete-dialog-cancel:hover {
  background: #666;
}

.delete-dialog-confirm {
  background: #c62828;
  color: #fff;
}

.delete-dialog-confirm:hover {
  background: #e53935;
}
</style>
