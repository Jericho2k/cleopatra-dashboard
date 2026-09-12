/**
 * The AI Stack UI must never be able to name a model.
 *
 * An AI Stack Profile is the whole conversational AI configuration, selected by
 * a stable identifier the backend validates. These tests pin the client side of
 * that contract: what a profile detail reads as, where an effective profile came
 * from, and that a generated message can be attributed to the stack that wrote
 * it months later from the row alone.
 */

import { describe, expect, it } from 'vitest'

import {
  describeSource,
  describeStage,
  findProfile,
  messageAIStack,
  profileLabel,
  type AIStackRegistry,
  type AIStackStage,
} from '../aiStack'

const stage = (overrides: Partial<AIStackStage> = {}): AIStackStage => ({
  stage: 'writer_default',
  label: 'Writer — ordinary conversation',
  provider: 'openrouter',
  model: 'moonshotai/kimi-k2.6',
  fallback_provider: 'together',
  fallback_model: 'Qwen/Qwen3.7-Plus',
  prompt_version: 'writer_v2',
  reasoning: false,
  output_mode: 'json_array',
  max_tokens: 1000,
  temperature: null,
  env_overridable: false,
  notes: '',
  ...overrides,
})

const registry: AIStackRegistry = {
  environment_profile: 'cleo_v2',
  environment_variable: 'AI_STACK_PROFILE',
  profiles: [
    {
      profile_id: 'cleo_legacy_v1',
      label: 'Cleo Legacy v1',
      summary: 'Frozen snapshot.',
      stages: [stage({ prompt_version: 'writer_v1' })],
    },
    {
      profile_id: 'cleo_v2',
      label: 'Cleo V2',
      summary: 'One writer voice.',
      stages: [stage()],
    },
  ],
}

describe('profile detail', () => {
  it('describes a stage as model, provider, prompt and reasoning', () => {
    const text = describeStage(stage())

    expect(text).toContain('moonshotai/kimi-k2.6 / openrouter')
    expect(text).toContain('prompt: writer_v2')
    expect(text).toContain('reasoning: off')
    expect(text).toContain('max tokens: 1000')
  })

  it('includes temperature only when the stage actually sets one', () => {
    expect(describeStage(stage())).not.toContain('temperature')
    expect(describeStage(stage({ temperature: 0 }))).toContain('temperature: 0')
  })

  it('reports reasoning on when it is on', () => {
    expect(describeStage(stage({ reasoning: true }))).toContain('reasoning: on')
  })

  it('finds a profile by id and falls back to the raw id for a label', () => {
    expect(findProfile(registry, 'cleo_v2')?.label).toBe('Cleo V2')
    expect(findProfile(registry, 'nope')).toBeNull()
    expect(profileLabel(registry, 'cleo_legacy_v1')).toBe('Cleo Legacy v1')
    expect(profileLabel(registry, 'unknown_profile')).toBe('unknown_profile')
    expect(profileLabel(registry, null)).toBe('—')
  })
})

describe('describeSource', () => {
  it('names which layer of the hierarchy chose the profile', () => {
    expect(describeSource('simulation_fan')).toBe('Test-fan override')
    expect(describeSource('creator')).toBe('Creator override')
    expect(describeSource('environment')).toBe('Production default')
    // An unknown or missing source is the deployment default, not an error.
    expect(describeSource(undefined)).toBe('Production default')
  })
})

describe('messageAIStack', () => {
  it('reads the stack marker the backend persists with each creator message', () => {
    const marker = messageAIStack({
      ppv: { media_ids: ['1'] },
      ai_stack: {
        profile: 'cleo_v2',
        route: 'commercial_complex',
        prompt_version: 'writer_v2',
        provider: 'openrouter',
        model: 'moonshotai/kimi-k2.6',
      },
    })

    expect(marker?.profile).toBe('cleo_v2')
    expect(marker?.route).toBe('commercial_complex')
    expect(marker?.model).toBe('moonshotai/kimi-k2.6')
  })

  it('returns null for a row written before the marker existed', () => {
    // Deliberately not attributed to whatever profile is current: an older row
    // genuinely does not say, and guessing would make the audit trail useless.
    expect(messageAIStack({ ppv: { media_ids: ['1'] } })).toBeNull()
    expect(messageAIStack(null)).toBeNull()
    expect(messageAIStack({ ai_stack: {} })).toBeNull()
    expect(messageAIStack({ ai_stack: { profile: 42 } })).toBeNull()
  })
})
