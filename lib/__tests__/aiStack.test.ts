/**
 * The AI Stack UI must never be able to name a model.
 *
 * An AI Stack Profile is the whole conversational AI configuration, selected by
 * a stable identifier the backend validates. These tests pin the client side of
 * that contract: what a profile detail reads as, where an effective profile came
 * from, and that a generated message can be attributed to the stack that wrote
 * it months later from the row alone.
 *
 * And the depth question the backend now decides: an agency account receives
 * `{ id, name }` per profile and nothing else, so the Simulator's selector has
 * to work from that alone. These tests assert it does — the redaction itself is
 * the backend's and is proven there.
 */

import { describe, expect, it } from 'vitest'

import {
  describeSource,
  describeStage,
  findProfile,
  messageAIStack,
  normalizeProfile,
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

/** What the platform owner receives: identity plus the whole routing. */
const registry: AIStackRegistry = {
  environment_profile: 'cleo_v2',
  environment_variable: 'AI_STACK_PROFILE',
  diagnostics: true,
  profiles: [
    {
      id: 'cleo_legacy_v1',
      name: 'Cleo Legacy v1',
      summary: 'Frozen snapshot.',
      stages: [stage({ prompt_version: 'writer_v1' })],
    },
    {
      id: 'cleo_v2',
      name: 'Cleo V2',
      summary: 'One writer voice.',
      stages: [stage()],
    },
  ],
}

/** What an agency account receives. The selector must work from this alone. */
const agencyRegistry: AIStackRegistry = {
  environment_profile: 'cleo_v3',
  diagnostics: false,
  profiles: [
    { id: 'cleo_legacy_v1', name: 'Cleo Legacy v1' },
    { id: 'cleo_v2', name: 'Cleo V2' },
    { id: 'cleo_v3', name: 'Cleo V3' },
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
    expect(findProfile(registry, 'cleo_v2')?.name).toBe('Cleo V2')
    expect(findProfile(registry, 'nope')).toBeNull()
    expect(profileLabel(registry, 'cleo_legacy_v1')).toBe('Cleo Legacy v1')
    expect(profileLabel(registry, 'unknown_profile')).toBe('unknown_profile')
    expect(profileLabel(registry, null)).toBe('—')
  })
})

describe('the reduced representation an agency receives', () => {
  it('is enough to render and resolve the Simulator dropdown', () => {
    // What the <option> elements are built from: a value to send and a label
    // to show, for every profile in the registry.
    expect(
      agencyRegistry.profiles.map(profile => [profile.id, profile.name]),
    ).toEqual([
      ['cleo_legacy_v1', 'Cleo Legacy v1'],
      ['cleo_v2', 'Cleo V2'],
      ['cleo_v3', 'Cleo V3'],
    ])
    // And selecting Cleo V3 resolves, which is what the control needs to
    // confirm the choice back to the operator.
    expect(findProfile(agencyRegistry, 'cleo_v3')?.name).toBe('Cleo V3')
    expect(profileLabel(agencyRegistry, 'cleo_v3')).toBe('Cleo V3')
  })

  it('carries no routing for the UI to render even by accident', () => {
    for (const profile of agencyRegistry.profiles) {
      expect(profile.stages).toBeUndefined()
      expect(profile.summary).toBeUndefined()
    }
    expect(agencyRegistry.environment_variable).toBeUndefined()
    expect(JSON.stringify(agencyRegistry).toLowerCase()).not.toContain('kimi')
  })
})

describe('normalizeProfile', () => {
  it('reads the reduced shape', () => {
    expect(normalizeProfile({ id: 'cleo_v3', name: 'Cleo V3' })).toEqual({
      id: 'cleo_v3',
      name: 'Cleo V3',
    })
  })

  it('still reads a backend that has not shipped the reduced shape yet', () => {
    // `profile_id`/`label` are the owner payload's names for the same two
    // facts. Accepted so the dropdown is never empty mid-deploy.
    const profile = normalizeProfile({
      profile_id: 'cleo_v2',
      label: 'Cleo V2',
      summary: 'One writer voice.',
      stages: [stage()],
    })

    expect(profile?.id).toBe('cleo_v2')
    expect(profile?.name).toBe('Cleo V2')
    expect(profile?.stages).toHaveLength(1)
  })

  it('falls back to the id for a name, and drops a row with no id', () => {
    expect(normalizeProfile({ id: 'cleo_v9' })?.name).toBe('cleo_v9')
    expect(normalizeProfile({ name: 'Nameless' })).toBeNull()
    expect(normalizeProfile(null)).toBeNull()
    expect(normalizeProfile('cleo_v3')).toBeNull()
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

  it('reads a redacted marker as the profile alone', () => {
    // What an agency receives: the backend strips route, prompt version,
    // provider and model out of the simulated-turn response.
    const marker = messageAIStack({ ai_stack: { profile: 'cleo_v3' } })

    expect(marker?.profile).toBe('cleo_v3')
    expect(marker?.model).toBeUndefined()
    expect(marker?.provider).toBeUndefined()
    expect(marker?.route).toBeUndefined()
    expect(marker?.prompt_version).toBeUndefined()
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
