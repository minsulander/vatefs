/**
 * Soft update check against GitHub releases. Never blocks older versions.
 * Self-update of the EuroScope DLL requires the user to unload the plugin first —
 * we only surface a link + optional native updater when available later.
 */

import { onMounted, ref } from 'vue'
import { constants } from '@vatefs/common'

const RELEASES_API = 'https://api.github.com/repos/minsulander/vatefs/releases/latest'
const DISMISS_KEY = 'efs/updateBannerDismissedVersion'

export type UpdateInfo = {
  latestTag: string
  latestVersion: string
  htmlUrl: string
  currentVersion: string
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

/** Semver-ish compare: 1 if a>b, -1 if a<b, 0 if equal / incomparable. */
function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = normalizeVersion(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

const updateInfo = ref<UpdateInfo | null>(null)
const bannerVisible = ref(false)

export function useAppUpdateCheck() {
  onMounted(async () => {
    const current = normalizeVersion(constants.version)
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) return
      const json = (await res.json()) as { tag_name?: string; html_url?: string }
      const tag = (json.tag_name || '').trim()
      const latest = normalizeVersion(tag)
      if (!latest || !json.html_url) return
      if (compareVersions(latest, current) <= 0) return
      const dismissed = localStorage.getItem(DISMISS_KEY)
      if (dismissed && normalizeVersion(dismissed) === latest) return
      updateInfo.value = {
        latestTag: tag,
        latestVersion: latest,
        htmlUrl: json.html_url,
        currentVersion: current,
      }
      bannerVisible.value = true
    } catch {
      // Offline / rate limit — stay quiet
    }
  })

  function dismissBanner() {
    if (updateInfo.value) {
      localStorage.setItem(DISMISS_KEY, updateInfo.value.latestVersion)
    }
    bannerVisible.value = false
  }

  return { updateInfo, bannerVisible, dismissBanner }
}
