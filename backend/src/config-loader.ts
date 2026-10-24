/**
 * Configuration loader - loads EFS configuration from YAML files.
 * Supports `include:` to compose configs from shared rule fragments.
 * Supports `layoutMode: multiAirport` with `bayTemplate` for IRIS-style columns.
 * Supports `layoutMode: saabLayouts` with named `layouts:` bay profiles.
 */

import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import type { EfsStaticConfig, SectionRule, ActionRule, DeleteRule, MoveRule } from "./config-types.js"
import type { EfsLayout, Bay, Section } from "@vatefs/common"
import {
    buildMultiAirportLayout,
    DEFAULT_COLUMN_COUNT,
    MIN_COLUMN_COUNT,
    MAX_COLUMN_COUNT,
    LOGICAL_SECTIONS,
    normalizeColumnAirports,
    type BayTemplate
} from "./multi-airport.js"
import type { EssaFamily } from "./essa-roles.js"

/**
 * Metadata for a discovered config file
 */
export interface ConfigFileInfo {
    /** File basename (e.g. "saab.yml") */
    file: string
    /** Display name from the "name" field in YAML */
    name: string
    /** Full path to the config file */
    fullPath: string
}

/** Built-in OTHER bay profile metadata (from YAML `layouts`). */
export interface SaabLayoutInfo {
    id: string
    name: string
    bayCount: number
}

/** Legacy filenames → OTHER profile id (migration / CLI aliases). */
export const LEGACY_CONFIG_TO_SAAB_LAYOUT: Readonly<Record<string, string>> = {
    'singlerwy3bays.yml': '1rwy3',
    'singlerwy4bays.yml': '1rwy4',
    'dualrwy4bays.yml': '2rwy4',
}

export const SAAB_CONFIG_FILE = 'saab.yml'
export const DEFAULT_SAAB_LAYOUT_ID = '1rwy4'

export function isSaabLayoutsConfig(config: { layoutMode?: string }): boolean {
    return config.layoutMode === 'saabLayouts'
}

/**
 * Raw YAML config structure (before transformation).
 * `layout` is optional so include-only fragments are valid YAML.
 */
interface YamlLayoutBlock {
    bays: Record<string, {
        sections: Record<string, {
            title: string
            addFromTop?: boolean
            height?: number
            hideHeader?: boolean
            visibleFor?: EssaFamily[]
        }>
    }>
}

interface YamlConfig {
    name?: string
    include?: string[]
    radarRange?: number
    arrivalRange?: number
    arrivalEtaMinutes?: number
    groundRange?: number
    layoutMode?: 'standard' | 'multiAirport' | 'essaRoles' | 'saabLayouts'
    look?: 'saab' | 'paper'
    columnCount?: number
    bayTemplate?: BayTemplate
    defaultLayout?: string
    layouts?: Record<string, {
        name?: string
        layout: YamlLayoutBlock
    }>
    layout?: YamlLayoutBlock
    sectionRules?: Record<string, Omit<SectionRule, 'id'>>
    actionRules?: Record<string, Omit<ActionRule, 'id'>>
    deleteRules?: Record<string, Omit<DeleteRule, 'id'>>
    moveRules?: Record<string, Omit<MoveRule, 'id'>>
}

export interface LoadConfigOptions {
    /** Active OTHER profile id when layoutMode is saabLayouts */
    saabLayoutId?: string
}

/**
 * Transform YAML layout (key-based) to internal format (id-based).
 * Also builds sectionToBay lookup map.
 */
function transformLayout(yamlLayout: YamlLayoutBlock): {
    layout: EfsLayout
    sectionToBay: Map<string, string>
    sectionVisibleFor: Map<string, EssaFamily[]>
} {
    const bays: Bay[] = []
    const sectionToBay = new Map<string, string>()
    const sectionVisibleFor = new Map<string, EssaFamily[]>()

    for (const [bayId, bayData] of Object.entries(yamlLayout.bays)) {
        const sections: Section[] = []

        for (const [sectionId, sectionData] of Object.entries(bayData.sections)) {
            if (sectionToBay.has(sectionId)) {
                throw new Error(`Duplicate section ID "${sectionId}" found in bay "${bayId}" (already exists in bay "${sectionToBay.get(sectionId)}")`)
            }
            sectionToBay.set(sectionId, bayId)

            if (sectionData.visibleFor && sectionData.visibleFor.length > 0) {
                sectionVisibleFor.set(sectionId, sectionData.visibleFor)
            }

            sections.push({
                id: sectionId,
                title: sectionData.title,
                addFromTop: sectionData.addFromTop,
                height: sectionData.height,
                hideHeader: sectionData.hideHeader,
            })
        }

        bays.push({
            id: bayId,
            sections
        })
    }

    return { layout: { bays }, sectionToBay, sectionVisibleFor }
}

function transformRules<T extends { id: string }>(
    yamlRules: Record<string, Omit<T, 'id'>>
): T[] {
    const rules: T[] = []

    for (const [id, ruleData] of Object.entries(yamlRules)) {
        rules.push({
            id,
            ...ruleData
        } as T)
    }

    return rules
}

function loadYamlWithIncludes(configPath: string, visited = new Set<string>()): YamlConfig {
    const resolved = path.resolve(configPath)

    if (visited.has(resolved)) {
        throw new Error(`Circular include detected: ${resolved}`)
    }
    visited.add(resolved)

    if (!fs.existsSync(resolved)) {
        throw new Error(`Config file not found: ${resolved}`)
    }

    const content = fs.readFileSync(resolved, 'utf8')
    const raw = yaml.load(content) as YamlConfig
    const dir = path.dirname(resolved)

    let sectionRules: Record<string, Omit<SectionRule, 'id'>> = {}
    let actionRules: Record<string, Omit<ActionRule, 'id'>> = {}
    let deleteRules: Record<string, Omit<DeleteRule, 'id'>> = {}
    let moveRules: Record<string, Omit<MoveRule, 'id'>> = {}

    for (const include of raw.include ?? []) {
        const includedPath = path.resolve(dir, include)
        const included = loadYamlWithIncludes(includedPath, new Set(visited))
        sectionRules = { ...sectionRules, ...included.sectionRules }
        actionRules  = { ...actionRules,  ...included.actionRules  }
        deleteRules  = { ...deleteRules,  ...included.deleteRules  }
        moveRules    = { ...moveRules,    ...included.moveRules    }
    }

    return {
        ...raw,
        sectionRules: { ...sectionRules, ...raw.sectionRules },
        actionRules:  { ...actionRules,  ...raw.actionRules  },
        deleteRules:  { ...deleteRules,  ...raw.deleteRules  },
        moveRules:    { ...moveRules,    ...raw.moveRules    },
    }
}

function isLogicalSectionId(id: string): boolean {
    return (LOGICAL_SECTIONS as readonly string[]).includes(id)
}

/** Drop rules that reference sections not present in the active layout. */
function filterRulesForSectionMap<T extends {
    sectionId?: string
    fromSectionId?: string
    toSectionId?: string
    fromSectionIdContains?: string
    toSectionIdContains?: string
}>(rules: T[], sectionToBay: Map<string, string>): T[] {
    return rules.filter((rule) => {
        if (rule.sectionId && !sectionToBay.has(rule.sectionId)) return false
        if (rule.fromSectionId && !sectionToBay.has(rule.fromSectionId)) return false
        if (rule.toSectionId && !sectionToBay.has(rule.toSectionId) && !rule.toSectionIdContains) {
            return false
        }
        return true
    })
}

export function listSaabLayoutsFromYaml(yamlConfig: YamlConfig): SaabLayoutInfo[] {
    if (!yamlConfig.layouts) return []
    return Object.entries(yamlConfig.layouts).map(([id, entry]) => ({
        id,
        name: entry.name ?? id,
        bayCount: Object.keys(entry.layout?.bays ?? {}).length,
    }))
}

/** Peek OTHER (saab.yml) layout metadata from a config file without full load. */
export function peekSaabLayouts(configPath: string): SaabLayoutInfo[] {
    try {
        const content = fs.readFileSync(configPath, 'utf8')
        const raw = yaml.load(content) as YamlConfig
        return listSaabLayoutsFromYaml(raw)
    } catch {
        return []
    }
}

export function resolveSaabLayoutId(
    yamlConfig: YamlConfig,
    requested?: string | null,
): string {
    const layouts = yamlConfig.layouts ?? {}
    const ids = Object.keys(layouts)
    if (ids.length === 0) return DEFAULT_SAAB_LAYOUT_ID
    if (requested && layouts[requested]) return requested
    if (yamlConfig.defaultLayout && layouts[yamlConfig.defaultLayout]) {
        return yamlConfig.defaultLayout
    }
    if (layouts[DEFAULT_SAAB_LAYOUT_ID]) return DEFAULT_SAAB_LAYOUT_ID
    return ids[0]!
}

/**
 * Load configuration from a YAML file
 */
export function loadConfig(configPath: string, options?: LoadConfigOptions): EfsStaticConfig {
    const yamlConfig = loadYamlWithIncludes(configPath)
    let layoutMode = yamlConfig.layoutMode ?? 'standard'
    // Implicit saabLayouts when `layouts:` map is present
    if (yamlConfig.layouts && Object.keys(yamlConfig.layouts).length > 0) {
        layoutMode = 'saabLayouts'
    }
    const isMulti = layoutMode === 'multiAirport'
    const isSaabLayouts = layoutMode === 'saabLayouts'

    let layout: EfsLayout
    let sectionToBay: Map<string, string>
    let sectionVisibleFor: Map<string, EssaFamily[]> | undefined
    let bayTemplate: BayTemplate | undefined
    let columnCount: number | undefined
    let saabLayoutId: string | undefined
    let saabLayouts: SaabLayoutInfo[] | undefined

    if (isMulti) {
        if (!yamlConfig.bayTemplate?.sections) {
            throw new Error('multiAirport config must specify bayTemplate.sections')
        }
        bayTemplate = yamlConfig.bayTemplate
        const rawCount = yamlConfig.columnCount ?? DEFAULT_COLUMN_COUNT
        columnCount = Math.max(MIN_COLUMN_COUNT, Math.min(MAX_COLUMN_COUNT, rawCount))
        const columnAirports = normalizeColumnAirports([], columnCount)
        const built = buildMultiAirportLayout(bayTemplate, columnCount, columnAirports)
        layout = { bays: [...built.layout.bays, ...built.idleLayout.bays] }
        sectionToBay = built.sectionToBay
    } else if (isSaabLayouts) {
        if (!yamlConfig.layouts || Object.keys(yamlConfig.layouts).length === 0) {
            throw new Error('saabLayouts config must specify layouts')
        }
        saabLayouts = listSaabLayoutsFromYaml(yamlConfig)
        saabLayoutId = resolveSaabLayoutId(yamlConfig, options?.saabLayoutId)
        const profile = yamlConfig.layouts[saabLayoutId]
        if (!profile?.layout?.bays) {
            throw new Error(`OTHER layout "${saabLayoutId}" missing layout.bays`)
        }
        const transformed = transformLayout(profile.layout)
        layout = transformed.layout
        sectionToBay = transformed.sectionToBay
        if (transformed.sectionVisibleFor.size > 0) {
            sectionVisibleFor = transformed.sectionVisibleFor
        }
    } else {
        if (!yamlConfig.layout?.bays) {
            throw new Error('Configuration must specify layout.bays')
        }
        const transformed = transformLayout(yamlConfig.layout)
        layout = transformed.layout
        sectionToBay = transformed.sectionToBay
        if (transformed.sectionVisibleFor.size > 0) {
            sectionVisibleFor = transformed.sectionVisibleFor
        }
    }

    let sectionRules = yamlConfig.sectionRules
        ? transformRules<SectionRule>(yamlConfig.sectionRules)
        : []
    let actionRules = yamlConfig.actionRules
        ? transformRules<ActionRule>(yamlConfig.actionRules)
        : []
    let deleteRules = yamlConfig.deleteRules
        ? transformRules<DeleteRule>(yamlConfig.deleteRules)
        : []
    let moveRules = yamlConfig.moveRules
        ? transformRules<MoveRule>(yamlConfig.moveRules)
        : []

    if (isSaabLayouts) {
        sectionRules = filterRulesForSectionMap(sectionRules, sectionToBay)
        actionRules = filterRulesForSectionMap(actionRules, sectionToBay)
        moveRules = filterRulesForSectionMap(moveRules, sectionToBay)
    }

    if (isMulti) {
        for (const rule of sectionRules) {
            if (!isLogicalSectionId(rule.sectionId)) {
                throw new Error(`Section rule "${rule.id}" references non-logical section "${rule.sectionId}"`)
            }
        }
        for (const rule of actionRules) {
            if (rule.sectionId && !isLogicalSectionId(rule.sectionId)) {
                throw new Error(`Action rule "${rule.id}" references non-logical section "${rule.sectionId}"`)
            }
        }
        for (const rule of moveRules) {
            if (rule.fromSectionId && !isLogicalSectionId(rule.fromSectionId)) {
                throw new Error(`Move rule "${rule.id}" references non-logical fromSection "${rule.fromSectionId}"`)
            }
            if (!isLogicalSectionId(rule.toSectionId) && !rule.fromSectionIdContains) {
                if (!isLogicalSectionId(rule.toSectionId)) {
                    throw new Error(`Move rule "${rule.id}" references non-logical toSection "${rule.toSectionId}"`)
                }
            }
        }
    } else {
        for (const rule of sectionRules) {
            if (!sectionToBay.has(rule.sectionId)) {
                throw new Error(`Section rule "${rule.id}" references unknown section "${rule.sectionId}"`)
            }
        }
        for (const rule of actionRules) {
            if (rule.sectionId && !sectionToBay.has(rule.sectionId)) {
                throw new Error(`Action rule "${rule.id}" references unknown section "${rule.sectionId}"`)
            }
        }
        for (const rule of moveRules) {
            if (rule.fromSectionId && !sectionToBay.has(rule.fromSectionId)) {
                throw new Error(`Move rule "${rule.id}" references unknown fromSection "${rule.fromSectionId}"`)
            }
            if (rule.toSectionId && !sectionToBay.has(rule.toSectionId)) {
                throw new Error(`Move rule "${rule.id}" references unknown toSection "${rule.toSectionId}"`)
            }
            if (!rule.toSectionId && !rule.toSectionIdContains) {
                throw new Error(`Move rule "${rule.id}" needs toSectionId or toSectionIdContains`)
            }
        }
    }

    const config: EfsStaticConfig = {
        myAirports: [],
        radarRangeNm: yamlConfig.radarRange ?? 25,
        arrivalRangeNm: yamlConfig.arrivalRange ?? 100,
        arrivalEtaMinutes: yamlConfig.arrivalEtaMinutes ?? 20,
        groundRangeNm: yamlConfig.groundRange ?? 3,
        layout,
        sectionToBay,
        sectionRules,
        actionRules,
        deleteRules,
        moveRules,
        layoutMode,
        look: yamlConfig.look === 'paper' ? 'paper' : 'saab',
        sectionVisibleFor,
        bayTemplate,
        columnCount,
        activeAirports: isMulti ? [] : undefined,
        columnAirports: isMulti ? normalizeColumnAirports([], columnCount ?? DEFAULT_COLUMN_COUNT) : undefined,
        saabLayoutId,
        saabLayouts,
    }

    console.log(`Loaded config from ${configPath}:`)
    console.log(`  Mode: ${layoutMode}`)
    if (saabLayoutId) console.log(`  OTHER layout: ${saabLayoutId}`)
    console.log(`  Look: ${config.look}`)
    console.log(
        `  Radar range: ${config.radarRangeNm}nm, arrival: ${config.arrivalRangeNm}nm / ETA≤${config.arrivalEtaMinutes}min, ground: ${config.groundRangeNm}nm`
    )
    console.log(`  Bays: ${config.layout.bays.length}`)
    console.log(`  Sections: ${sectionToBay.size}`)
    console.log(`  Section rules: ${config.sectionRules.length}`)
    console.log(`  Action rules: ${config.actionRules.length}`)
    console.log(`  Delete rules: ${config.deleteRules.length}`)
    console.log(`  Move rules: ${config.moveRules.length}`)

    return config
}

export function getDefaultConfigPath(dataDir: string): string {
    return `${dataDir}/config/${SAAB_CONFIG_FILE}`
}

/**
 * Resolve CLI / saved config path. Legacy 1RWY/2RWY files map onto saab.yml.
 */
export function resolveConfigPath(dataDir: string, fileOrPath: string): {
    fullPath: string
    file: string
    saabLayoutId?: string
} {
    const base = path.basename(fileOrPath)
    const legacyLayout = LEGACY_CONFIG_TO_SAAB_LAYOUT[base]
    if (legacyLayout) {
        return {
            fullPath: path.join(dataDir, 'config', SAAB_CONFIG_FILE),
            file: SAAB_CONFIG_FILE,
            saabLayoutId: legacyLayout,
        }
    }
    const fullPath = path.isAbsolute(fileOrPath)
        ? fileOrPath
        : path.join(dataDir, 'config', base)
    return { fullPath, file: path.basename(fullPath) }
}

/**
 * Scan a directory for selectable YAML config files and extract their names.
 * Files without a `layout`, `layouts`, or `bayTemplate` key are include fragments and are skipped.
 */
export function scanConfigDirectory(configDir: string): ConfigFileInfo[] {
    if (!fs.existsSync(configDir)) {
        return []
    }

    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    const configs: ConfigFileInfo[] = []

    for (const file of files) {
        const fullPath = path.join(configDir, file)
        try {
            const content = fs.readFileSync(fullPath, 'utf8')
            const yamlConfig = yaml.load(content) as YamlConfig
            const hasLayouts = yamlConfig?.layouts && Object.keys(yamlConfig.layouts).length > 0
            if (!yamlConfig?.layout && !yamlConfig?.bayTemplate && !hasLayouts) continue
            const name = yamlConfig?.name ?? file.replace(/\.(yml|yaml)$/, '')
            configs.push({ file, name, fullPath })
        } catch {
            console.warn(`Skipping config file ${file}: failed to parse`)
        }
    }

    return configs.sort((a, b) => a.name.localeCompare(b.name))
}
