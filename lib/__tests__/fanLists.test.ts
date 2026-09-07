import { describe, expect, it } from 'vitest'

import {
  fanListBadge,
  fanListLabel,
  isArchivedFanslyList,
  isEditableList,
  isFanslyList,
  sortFanLists,
} from '../fanLists'

const local = { id: 'l1', name: 'VIP', source: 'local' }
const imported = { id: 'f1', name: 'VIP', source: 'fansly' }
const archived = {
  id: 'f2',
  name: 'Old Whales',
  source: 'fansly',
  external_archived_at: '2026-09-01T00:00:00Z',
}

describe('list provenance', () => {
  it('distinguishes an imported list from a Cleopatra list', () => {
    expect(isFanslyList(imported)).toBe(true)
    expect(isFanslyList(local)).toBe(false)
  })

  it('treats a list from a database without the source column as local', () => {
    // Rows predating db/fansly_lists_v1.sql have no source at all.
    expect(isFanslyList({ id: 'x', name: 'VIP' })).toBe(false)
    expect(isEditableList({ id: 'x', name: 'VIP' })).toBe(true)
  })
})

describe('rendering local and Fansly lists distinctly', () => {
  it('prefixes imported lists and leaves local ones alone', () => {
    expect(fanListLabel(imported)).toBe('Fansly · VIP')
    expect(fanListLabel(local)).toBe('VIP')
  })

  it('two lists with the same name are still told apart', () => {
    expect(fanListLabel(local)).not.toBe(fanListLabel(imported))
  })

  it('badges only imported lists', () => {
    expect(fanListBadge(imported)).toBe('FANSLY')
    expect(fanListBadge(local)).toBeNull()
  })

  it('marks a mirror Fansly no longer returns', () => {
    expect(isArchivedFanslyList(archived)).toBe(true)
    expect(fanListBadge(archived)).toBe('FANSLY · REMOVED')
    // Still resolvable, so an existing targeting rule keeps working.
    expect(fanListLabel(archived)).toBe('Fansly · Old Whales')
  })

  it('does not mark a local list as archived', () => {
    expect(isArchivedFanslyList({ ...local, external_archived_at: 'x' })).toBe(false)
  })
})

describe('editability', () => {
  it('never offers to edit or delete a list that lives on Fansly', () => {
    expect(isEditableList(imported)).toBe(false)
    expect(isEditableList(archived)).toBe(false)
    expect(isEditableList(local)).toBe(true)
  })
})

describe('ordering', () => {
  it('puts local lists first, then imported, then archived mirrors', () => {
    const ordered = sortFanLists([
      archived,
      imported,
      { id: 'l2', name: 'Buyers', source: 'local' },
      local,
    ])

    expect(ordered.map(list => list.id)).toEqual(['l2', 'l1', 'f1', 'f2'])
  })

  it('does not mutate the array it was given', () => {
    const input = [imported, local]
    sortFanLists(input)
    expect(input.map(list => list.id)).toEqual(['f1', 'l1'])
  })
})
