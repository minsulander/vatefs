import { ref } from 'vue'

/**
 * Single-owner lock for HTML5 drag drop markers.
 * dragleave is flaky across sections — without this, every bay that was
 * briefly hovered keeps its cyan insert / tray highlight.
 */
const activeOwnerKey = ref<string | null>(null)

export function dropHighlightOwnerKey(bayId: string, sectionId: string): string {
  return `${bayId}::${sectionId}`
}

export function useDropHighlightOwner() {
  return activeOwnerKey
}

export function claimDropHighlight(ownerKey: string): void {
  activeOwnerKey.value = ownerKey
}

export function releaseDropHighlight(ownerKey: string): void {
  if (activeOwnerKey.value === ownerKey) {
    activeOwnerKey.value = null
  }
}
