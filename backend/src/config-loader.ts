/**
 * Configuration loader - loads EFS configuration from YAML files.
 */

import fs from "fs"
import yaml from "js-yaml"
import type { EfsStaticConfig, SectionRule, ActionRule, DeleteRule, MoveRule } from "./config-types.js"
import type { EfsLayout, Bay, Section } from "@vatefs/common"

/**
 * Raw YAML config structure (before transformation)
 */
interface YamlConfig {
    radarRange?: number
    layout: {
        bays: Record<string, {
            sections: Record<string, { title: string; addFromTop?: boolean; height?: number }>
        }>
    }
    sectionRules: Record<string, Omit<SectionRule, 'id'>>
    actionRules: Record<string, Omit<ActionRule, 'id'>>
    deleteRules: Record<string, Omit<DeleteRule, 'id'>>
    moveRules: Record<string, Omit<MoveRule, 'id'>>
}

/**
 * Transform YAML layout (key-based) to internal format (id-based)
 * Also builds sectionToBay lookup map
 */
function transformLayout(yamlLayout: YamlConfig['layout']): { layout: EfsLayout; sectionToBay: Map<string, string> } {
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
 * Load configuration from a YAML file
 */
export function loadConfig(configPath: string): EfsStaticConfig {
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`)
    }

    const content = fs.readFileSync(configPath, 'utf8')
    const yamlConfig = yaml.load(content) as YamlConfig

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
    return `${dataDir}/config/ESGG.yml`
}
