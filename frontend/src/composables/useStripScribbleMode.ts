import { ref } from 'vue'

export type StripScribbleMode = 'always' | 'toggle'

const STORAGE_KEY = 'efs/stripScribbleMode'

function loadMode(): StripScribbleMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'toggle' || raw === 'always') return raw
  } catch {
    /* ignore */
  }
  return 'always'
}

const scribbleMode = ref<StripScribbleMode>(loadMode())

export function useStripScribbleMode() {
  return scribbleMode
}

export function setStripScribbleMode(mode: StripScribbleMode) {
  scribbleMode.value = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}
