import { describe, expect, it } from 'vitest'
import {
    remapPushActionForStand,
    standRequiresStartupInsteadOfPush,
} from './essa-push-stands.js'

describe('ESSA push vs startup stand rules', () => {
    it('jets push by default', () => {
        expect(standRequiresStartupInsteadOfPush('31', 'J')).toBe(false)
        expect(remapPushActionForStand('PUSH', '31', 'J')).toBe('PUSH')
    })

    it('jet exceptions use startup', () => {
        expect(standRequiresStartupInsteadOfPush('R9C', 'J')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('G149', 'J')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('S5', 'J')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('S75', 'J')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('M1', 'J')).toBe(true)
        expect(remapPushActionForStand('PUSH', 'S4', 'J')).toBe('STUP')
    })

    it('prop exceptions include apron G/S and even stands 52–58', () => {
        expect(standRequiresStartupInsteadOfPush('52', 'T')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('G141', 'P')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('S10', 'T')).toBe(true)
        expect(standRequiresStartupInsteadOfPush('31', 'T')).toBe(false)
        expect(remapPushActionForStand('PUSH', '54', 'T')).toBe('STUP')
    })

    it('leaves non-PUSH actions alone', () => {
        expect(remapPushActionForStand('TAXI', 'R9C', 'J')).toBe('TAXI')
        expect(remapPushActionForStand(undefined, 'R9C', 'J')).toBeUndefined()
    })
})
