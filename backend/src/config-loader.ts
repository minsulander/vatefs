/**
 * Configuration loader - loads EFS configuration from YAML files.
 * Supports `include:` to compose configs from shared rule fragments.
 */

import fs from "fs"
import path from "path"
import yaml from "js-yaml"
import type { EfsStaticConfig, SectionRule, ActionRule, DeleteRule, MoveRule } from "./config-types.js"
import type { EfsLayout, Bay, Section } from "@vatefs/common"

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
    layout?: {
        bays: Record<string, {
            sections: Record<string, { title: string; addFromTop?: boolean; height?: number }>
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
function transformLayout(yamlLayout: NonNullable<YamlConfig['layout']>): { layout: EfsLayout; sectionToBay: Map<string, string> } {
    const bays: Bay[] = []
    const sectionToBay = new Map<string, string>()

    for (const [bayId, bayData] of Object.entries(yamlLayout.bays)) {
        const sections: Section[] = []

        for (const [sectionId, sectionData] of Object.entries(bayData.sections)) {
            // Check for duplicate section IDs
            if (sectionToBay.has(sectionId)) {
                throw new Error(`Duplicate section ID "${sectionId}" found in bay "${bayId}" (already exists in bay "${sectionToBay.get(sectionId)}")`)
            }
            sectionToBay.set(sectionId, bayId)

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

    return { layout: { bays }, sectionToBay }
}

/**
 * Transform YAML rules (key-based) to internal format (id-based)
 */
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

/**
 * Recursively load a YAML file and merge all `include:` fragments into it.
 * Rules from included files are the base; the main file's rules override on key conflict.
 * `visited` tracks resolved paths to detect circular includes.
 */
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

    // Accumulate rules from all includes in order
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

    // Main file rules overlay on top (same key = main file wins)
    return {
        ...raw,
        sectionRules: { ...sectionRules, ...raw.sectionRules },
        actionRules:  { ...actionRules,  ...raw.actionRules  },
        deleteRules:  { ...deleteRules,  ...raw.deleteRules  },
        moveRules:    { ...moveRules,    ...raw.moveRules    },
    }
}

/**
 * Load configuration from a YAML file
 */
export function loadConfig(configPath: string): EfsStaticConfig {
    const yamlConfig = loadYamlWithIncludes(configPath)

    // Validate required fields
    if (!yamlConfig.layout?.bays) {
        throw new Error('Configuration must specify layout.bays')
    }

    // Transform layout and build sectionToBay lookup
    const { layout, sectionToBay } = transformLayout(yamlConfig.layout)

    // Transform rules
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

    // Validate that all sectionIds in rules exist in the layout
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
        if (!sectionToBay.has(rule.fromSectionId)) {
            throw new Error(`Move rule "${rule.id}" references unknown fromSection "${rule.fromSectionId}"`)
        }
        if (!sectionToBay.has(rule.toSectionId)) {
            throw new Error(`Move rule "${rule.id}" references unknown toSection "${rule.toSectionId}"`)
        }
    }

    // Note: myAirports is set at runtime from myselfUpdate or CLI args, not from config
    const config: EfsStaticConfig = {
        myAirports: [],
        radarRangeNm: yamlConfig.radarRange ?? 25,
        layout,
        sectionToBay,
        sectionRules,
        actionRules,
        deleteRules,
        moveRules
    }

    console.log(`Loaded config from ${configPath}:`)
    console.log(`  Radar range: ${config.radarRangeNm}nm`)
    console.log(`  Bays: ${config.layout.bays.length}`)
    console.log(`  Sections: ${sectionToBay.size}`)
    console.log(`  Section rules: ${config.sectionRules.length}`)
    console.log(`  Action rules: ${config.actionRules.length}`)
    console.log(`  Delete rules: ${config.deleteRules.length}`)
    console.log(`  Move rules: ${config.moveRules.length}`)

    return config
}

/**
 * Get default config path
 */
export function getDefaultConfigPath(dataDir: string): string {
    return `${dataDir}/config/singlerwy4bays.yml`
}

/**
 * Scan a directory for selectable YAML config files and extract their names.
 * Files without a `layout` key are include fragments and are skipped.
 * Returns an array of config file info sorted by name.
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
            // Skip include fragments (no layout key)
            if (!yamlConfig?.layout) continue
            const name = yamlConfig?.name ?? file.replace(/\.(yml|yaml)$/, '')
            configs.push({ file, name, fullPath })
        } catch {
            // Skip files that can't be parsed
            console.warn(`Skipping config file ${file}: failed to parse`)
        }
    }

    return configs.sort((a, b) => a.name.localeCompare(b.name))
}
