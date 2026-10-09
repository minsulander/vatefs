<template>
  <div
    ref="rootEl"
    class="info-strip"
    :class="{ dragging: isDragging }"
    :data-info-strip-id="stripId"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @touchstart="onTouchStart"
    @touchmove.prevent="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <div class="info-strip-body">
      <slot />
    </div>
    <div class="info-strip-actions">
      <StripCloseButton @click="emit('close')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { getTouchDragInstance } from '@/composables/useTouchDrag'
import { setInfoStripPlacement } from '@/composables/useInfoStrips'
import StripCloseButton from './StripCloseButton.vue'

/** Same design width as FlightStrip → body 50px at scale 1 */
const STRIP_REF_WIDTH_PX = 400
const LONG_PRESS_DELAY = 150

const props = defineProps<{
  stripId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const rootEl = ref<HTMLElement | null>(null)
const isDragging = ref(false)
let resizeObs: ResizeObserver | null = null

let touchStarted = false
let longPressTimer: number | null = null
const touchDrag = getTouchDragInstance()

function updateScale() {
  const el = rootEl.value
  if (!el) return
  const w = el.clientWidth
  if (w <= 0) return
  const s = Math.min(2.2, Math.max(0.45, w / STRIP_REF_WIDTH_PX))
  el.style.setProperty('--strip-scale', String(s))
}

function onDragStart(event: DragEvent) {
  const t = event.target as HTMLElement | null
  if (t?.closest('.strip-close-btn') || t?.closest('.info-strip-actions')) {
    event.preventDefault()
    return
  }
  if (!event.dataTransfer) return
  isDragging.value = true
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(
    'application/json',
    JSON.stringify({ type: 'infoStrip', infoStripId: props.stripId }),
  )
  event.dataTransfer.setData('application/efs-info-strip', props.stripId)
  if (rootEl.value) {
    event.dataTransfer.setDragImage(rootEl.value, 40, 20)
  }
}

function onDragEnd() {
  isDragging.value = false
}

function onTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1) return
  const t = event.target as HTMLElement | null
  if (t?.closest('.strip-close-btn') || t?.closest('.info-strip-actions')) return

  touchStarted = true
  const touch = event.touches[0]

  longPressTimer = window.setTimeout(() => {
    if (touchStarted && rootEl.value && touch) {
      event.preventDefault()
      isDragging.value = true
      const rect = rootEl.value.getBoundingClientRect()
      touchDrag.startDrag(
        rootEl.value,
        {
          stripId: props.stripId,
          bayId: '',
          sectionId: '',
          stripHeight: rect.height,
          dragOffsetY: touch.clientY - rect.top,
        },
        touch,
      )
    }
  }, LONG_PRESS_DELAY)
}

function onTouchMove(event: TouchEvent) {
  if (!touchStarted) return
  if (isDragging.value && event.touches.length === 1 && event.touches[0]) {
    touchDrag.moveDrag(event.touches[0])
  }
}

function onTouchEnd() {
  if (longPressTimer != null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }

  if (isDragging.value) {
    const result = touchDrag.endDrag()

    if (result.isTrashDrop) {
      emit('close')
      isDragging.value = false
      touchStarted = false
      return
    }

    if (result.dropTarget) {
      const sectionEl = result.dropTarget.closest('.efs-section')
      const bayEl = sectionEl?.closest('.efs-bay')
      const targetSectionId = sectionEl?.getAttribute('data-section-id')
      const targetBayId = bayEl?.getAttribute('data-bay-id')
      if (targetSectionId && targetBayId) {
        setInfoStripPlacement(props.stripId, {
          bayId: targetBayId,
          sectionId: targetSectionId,
          bottom: result.isBottomDrop,
          index: result.dropPosition,
        })
      }
    }

    isDragging.value = false
  }

  touchStarted = false
}

function onTouchCancel() {
  if (longPressTimer != null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (isDragging.value) {
    touchDrag.cancelDrag()
    isDragging.value = false
  }
  touchStarted = false
}

onMounted(() => {
  updateScale()
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => updateScale())
    resizeObs.observe(rootEl.value)
  }
})

onUnmounted(() => {
  if (longPressTimer != null) clearTimeout(longPressTimer)
  resizeObs?.disconnect()
  resizeObs = null
})
</script>

<style scoped>
.info-strip {
  --strip-scale: 1;
  --strip-body-h: calc(50px * var(--strip-scale));
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  box-sizing: border-box;
  height: var(--strip-body-h);
  min-height: var(--strip-body-h);
  max-height: var(--strip-body-h);
  margin: 1px 4px;
  background: #ebebeb;
  /* No type-coloured frame — thin neutral edge only */
  border: 1px solid #9a9a9a;
  font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
  touch-action: none;
}

.info-strip.dragging {
  opacity: 0.45;
  cursor: grabbing;
}

.info-strip-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

/* MAP ideal: tight column, button top-right, flush beside content */
.info-strip-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: calc(1px * var(--strip-scale)) calc(1px * var(--strip-scale)) calc(1px * var(--strip-scale)) 0;
  border-left: none;
  cursor: default;
  touch-action: manipulation;
}
</style>
