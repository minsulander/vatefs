/**
 * Configuration loader - loads EFS configuration from YAML files.
 * Supports `include:` to compose configs from shared rule fragments.
 * Supports `layoutMode: multiAirport` with `bayTemplate` for IRIS-style columns.
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
    /** File basename (e.g. "singlerwy4bays.yml") */
    file: string
    /** Display name from the "name" field in YAML */
    name: string
    /** Full path to the config file */
    fullPath: string
}

/**
 * Raw YAML config structure (before transformation).
 * `layout` is optional so include-only fragments are valid YAML.
 */
interface YamlConfig {
    name?: string
    include?: string[]
    radarRange?: number
    groundRange?: number
    layoutMode?: 'standard' | 'multiAirport' | 'essaRoles'
    columnCount?: number
    bayTemplate?: BayTemplate
    layout?: {
        bays: Record<string, {
            sections: Record<string, {
                title: string
                addFromTop?: boolean
                height?: number
                visibleFor?: EssaFamily[]
            }>
        }>
    }
    sectionRules?: Record<string, Omit<SectionRule, 'id'>>
    actionRules?: Record<string, Omit<ActionRule, 'id'>>
    deleteRules?: Record<string, Omit<DeleteRule, 'id'>>
    moveRules?: Record<string, Omit<MoveRule, 'id'>>
}

/**
 * Transform YAML layout (key-based) to internal format (id-based).
 * Also builds sectionToBay lookup map.
 */
function transformLayout(yamlLayout: NonNullable<YamlConfig['layout']>): {
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
                height: sectionData.height
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

/**
 * Load configuration from a YAML file
 */
export function loadConfig(configPath: string): EfsStaticConfig {
    const yamlConfig = loadYamlWithIncludes(configPath)
    const layoutMode = yamlConfig.layoutMode ?? 'standard'
    const isMulti = layoutMode === 'multiAirport'

    let layout: EfsLayout
    let sectionToBay: Map<string, string>
    let sectionVisibleFor: Map<string, EssaFamily[]> | undefined
    let bayTemplate: BayTemplate | undefined
    let columnCount: number | undefined

    if (isMulti) {
        if (!yamlConfig.bayTemplate?.sections) {
            throw new Error('multiAirport config must specify bayTemplate.sections')
        }
        bayTemplate = yamlConfig.bayTemplate
        const rawCount = yamlConfig.columnCount ?? DEFAULT_COLUMN_COUNT
        columnCount = Math.max(MIN_COLUMN_COUNT, Math.min(MAX_COLUMN_COUNT, rawCount))
        const columnAirports = normalizeColumnAirports([], columnCount)
        const built = buildMultiAirportLayout(bayTemplate, columnCount, columnAirports)
        // Include idle bay in internal layout so sectionToBay covers idle_* sections
        layout = { bays: [...built.layout.bays, ...built.idleLayout.bays] }
        sectionToBay = built.sectionToBay
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

    const sectionRules = yamlConfig.sectionRules
        ? transformRules<SectionRule>(yamlConfig.sectionRules)
        : []
    const actionRules = yamlConfig.actionRules
        ? transformRules<ActionRule>(yamlConfig.actionRules)
        : []
    const deleteRules = yamlConfig.deleteRules
        ? transformRules<DeleteRule>(yamlConfig.deleteRules)
        : []
    const moveRules = yamlConfig.moveRules
        ? transformRules<MoveRule>(yamlConfig.moveRules)
        : []

    if (isMulti) {
        // Rules use logical section IDs (app/rwy/twy/dep)
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
                // toSectionId must be logical in multi mode
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
            if (!sectionToBay.has(rule.toSectionId)) {
                throw new Error(`Move rule "${rule.id}" references unknown toSection "${rule.toSectionId}"`)
            }
        }
    }

    const config: EfsStaticConfig = {
        myAirports: [],
        radarRangeNm: yamlConfig.radarRange ?? 25,
        groundRangeNm: yamlConfig.groundRange ?? 3,
        layout,
        sectionToBay,
        sectionRules,
        actionRules,
        deleteRules,
        moveRules,
        layoutMode,
        sectionVisibleFor,
        bayTemplate,
        columnCount,
        activeAirports: isMulti ? [] : undefined,
        columnAirports: isMulti ? normalizeColumnAirports([], columnCount ?? DEFAULT_COLUMN_COUNT) : undefined
    }

    console.log(`Loaded config from ${configPath}:`)
    console.log(`  Mode: ${layoutMode}`)
    console.log(`  Radar range: ${config.radarRangeNm}nm, ground range: ${config.groundRangeNm}nm`)
    console.log(`  Bays: ${config.layout.bays.length}`)
    console.log(`  Sections: ${sectionToBay.size}`)
    console.log(`  Section rules: ${config.sectionRules.length}`)
    console.log(`  Action rules: ${config.actionRules.length}`)
    console.log(`  Delete rules: ${config.deleteRules.length}`)
    console.log(`  Move rules: ${config.moveRules.length}`)

    return config
}

export function getDefaultConfigPath(dataDir: string): string {
    return `${dataDir}/config/singlerwy4bays.yml`
}

/**
 * Scan a directory for selectable YAML config files and extract their names.
 * Files without a `layout` or `bayTemplate` key are include fragments and are skipped.
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
            // Skip include fragments (no layout and no bayTemplate)
            if (!yamlConfig?.layout && !yamlConfig?.bayTemplate) continue
            const name = yamlConfig?.name ?? file.replace(/\.(yml|yaml)$/, '')
            configs.push({ file, name, fullPath })
        } catch {
            console.warn(`Skipping config file ${file}: failed to parse`)
        }
    }

    return configs.sort((a, b) => a.name.localeCompare(b.name))
}
