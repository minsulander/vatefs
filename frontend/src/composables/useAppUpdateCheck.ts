/**
 * Soft update check against GitHub releases. Never blocks older versions.
 * Compares both the app (@vatefs/common) version and the loaded EuroScope
 * plugin version (myselfUpdate). Self-update of the DLL requires the user
 * to unload the plugin first — we only surface a link.
 */

import { onMounted, ref, watch } from 'vue'
import { constants } from '@vatefs/common'
import { useEfsStore } from '@/store/efs'

const RELEASES_API = 'https://api.github.com/repos/minsulander/vatefs/releases/latest'
const DISMISS_KEY = 'efs/updateBannerDismissedVersion'

export type UpdateInfo = {
  latestTag: string
  latestVersion: string
  htmlUrl: string
  currentAppVersion: string
  currentPluginVersion?: string
  appOutdated: boolean
  pluginOutdated: boolean
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

/** Semver-ish compare: 1 if a>b, -1 if a<b, 0 if equal / incomparable. */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = normalizeVersion(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** True when a reported plugin version is comparable (not mock / empty). */
export function isComparablePluginVersion(raw: string | undefined | null): boolean {
  if (!raw) return false
  const v = normalizeVersion(raw)
  if (!v) return false
  if (/^mock$/i.test(v)) return false
  return /^\d/.test(v)
}

const updateInfo = ref<UpdateInfo | null>(null)
const bannerVisible = ref(false)

let latestRelease: { tag: string; latest: string; htmlUrl: string } | null = null

function applyUpdateState(pluginRaw: string | undefined) {
  if (!latestRelease) return
  const { tag, latest, htmlUrl } = latestRelease
  const currentApp = normalizeVersion(constants.version)
  const pluginComparable = isComparablePluginVersion(pluginRaw)
  const currentPlugin = pluginComparable ? normalizeVersion(pluginRaw!) : undefined
  const appOutdated = compareVersions(latest, currentApp) > 0
  const pluginOutdated = currentPlugin != null && compareVersions(latest, currentPlugin) > 0
  if (!appOutdated && !pluginOutdated) {
    updateInfo.value = null
    bannerVisible.value = false
    return
  }
  const dismissed = localStorage.getItem(DISMISS_KEY)
  if (dismissed && normalizeVersion(dismissed) === latest) {
    updateInfo.value = null
    bannerVisible.value = false
    return
  }
  updateInfo.value = {
    latestTag: tag,
    latestVersion: latest,
    htmlUrl,
    currentAppVersion: currentApp,
    currentPluginVersion: currentPlugin,
    appOutdated,
    pluginOutdated,
  }
  bannerVisible.value = true
}

function applyDemoBanner(mode: string | null) {
  const pluginOnly = mode === 'plugin'
  updateInfo.value = {
    latestTag: 'v1.0.0',
    latestVersion: '1.0.0',
    htmlUrl: 'https://github.com/minsulander/vatefs/releases/latest',
    currentAppVersion: pluginOnly ? '1.0.0' : '0.9',
    currentPluginVersion: '0.8',
    appOutdated: !pluginOnly,
    pluginOutdated: true,
  }
  bannerVisible.value = true
}

function demoUpdateMode(): string | null {
  if (typeof location === 'undefined') return null
  const params = new URLSearchParams(location.search)
  if (!params.has('demoUpdate')) return null
  return params.get('demoUpdate')
}

export function useAppUpdateCheck() {
  const efs = useEfsStore()

  onMounted(async () => {
    const demo = demoUpdateMode()
    if (demo != null) {
      applyDemoBanner(demo)
      return
    }
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) return
      const json = (await res.json()) as { tag_name?: string; html_url?: string }
      const tag = (json.tag_name || '').trim()
      const latest = normalizeVersion(tag)
      if (!latest || !json.html_url) return
      latestRelease = { tag, latest, htmlUrl: json.html_url }
      applyUpdateState(efs.pluginVersion)
    } catch {
      // Offline / rate limit — stay quiet
    }
  })

  watch(
    () => efs.pluginVersion,
    (v) => {
      if (demoUpdateMode() != null) return
      applyUpdateState(v)
    },
  )

  function dismissBanner() {
    if (updateInfo.value) {
      localStorage.setItem(DISMISS_KEY, updateInfo.value.latestVersion)
    }
    bannerVisible.value = false
  }

  return { updateInfo, bannerVisible, dismissBanner }
}
