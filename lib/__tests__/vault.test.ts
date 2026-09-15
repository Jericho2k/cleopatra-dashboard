/**
 * FE-002 and FE-003 - which image the vault requests, and how much of the vault
 * it loads at all.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALL_ALBUMS,
  VAULT_DETAIL_COLUMNS,
  VAULT_GRID_COLUMNS,
  VAULT_PAGE_SIZE,
  albumTitleOf,
  analysisNotice,
  classificationStatusOf,
  gridImageSource,
  isVideo,
  patchLoadedRow,
  previewImageSource,
  summarizeAlbums,
  totalItems,
  transferMegabytes,
} from '../vault'

const ORIGINAL = 'https://cdn.fansly.com/original.jpg?signature=abc'
const THUMBNAIL = 'https://cdn.fansly.com/thumb.jpg?signature=def'

describe('gridImageSource', () => {
  it('prefers the thumbnail', () => {
    expect(gridImageSource({ id: '1', url: ORIGINAL, thumbnail_url: THUMBNAIL }))
      .toBe(THUMBNAIL)
  })

  it('falls back to the original when no variant exists', () => {
    expect(gridImageSource({ id: '1', url: ORIGINAL, thumbnail_url: null }))
      .toBe(ORIGINAL)
    expect(gridImageSource({ id: '1', url: ORIGINAL, thumbnail_url: '   ' }))
      .toBe(ORIGINAL)
  })

  it('returns null when there is nothing to show', () => {
    expect(gridImageSource({ id: '1' })).toBeNull()
    expect(gridImageSource({ id: '1', url: '', thumbnail_url: '' })).toBeNull()
  })

  it('passes the signed URL through untouched', () => {
    // Signature and expiry live in the query string; rewriting it would break
    // the recovery path that refetches a fresh URL.
    expect(gridImageSource({ id: '1', thumbnail_url: THUMBNAIL })).toBe(THUMBNAIL)
  })
})

describe('previewImageSource', () => {
  it('uses the original, which is what the operator opened it for', () => {
    expect(previewImageSource({ id: '1', url: ORIGINAL, thumbnail_url: THUMBNAIL }))
      .toBe(ORIGINAL)
  })

  it('falls back to the thumbnail rather than showing nothing', () => {
    expect(previewImageSource({ id: '1', url: null, thumbnail_url: THUMBNAIL }))
      .toBe(THUMBNAIL)
  })

  it('returns null when neither exists', () => {
    expect(previewImageSource({ id: '1' })).toBeNull()
  })
})

describe('the grid projection', () => {
  it('asks only for what a tile draws', () => {
    const columns = VAULT_GRID_COLUMNS.split(',').map(column => column.trim())
    expect(columns).toEqual([
      'id',
      'album_title',
      'mimetype',
      'filename',
      'thumbnail_url',
      'url',
    ])
  })

  it('leaves the heavy columns to the detail fetch', () => {
    for (const heavy of ['ai_description', 'tags', 'good_for', 'classification_metadata']) {
      expect(VAULT_GRID_COLUMNS).not.toContain(heavy)
    }
    for (const heavy of ['ai_description', 'tags', 'good_for']) {
      expect(VAULT_DETAIL_COLUMNS).toContain(heavy)
    }
  })

  it('pages rather than loading an album whole', () => {
    expect(VAULT_PAGE_SIZE).toBeLessThanOrEqual(200)
  })
})

describe('album summary', () => {
  it('counts by album and names the empty one', () => {
    const albums = summarizeAlbums([
      { album_title: 'Beach' },
      { album_title: 'Beach' },
      { album_title: null },
      { album_title: '  ' },
      { album_title: 'Shower' },
    ])

    expect(albums).toEqual([
      { title: 'Beach', count: 2 },
      { title: 'Shower', count: 1 },
      { title: 'Uncategorized', count: 2 },
    ])
    expect(totalItems(albums)).toBe(5)
  })

  it('treats a blank album title as Uncategorized', () => {
    expect(albumTitleOf({ album_title: '' })).toBe('Uncategorized')
    expect(albumTitleOf({ album_title: 'Beach' })).toBe('Beach')
  })
})

describe('patchLoadedRow', () => {
  const rows = [
    { id: 'a', content_category: 'nude_photo' },
    { id: 'b', content_category: 'lingerie_photo' },
  ]

  it('replaces the row in place', () => {
    const next = patchLoadedRow(rows, { id: 'b', content_category: 'explicit_photo' })
    expect(next[1].content_category).toBe('explicit_photo')
    expect(next[0]).toBe(rows[0])
  })

  it('returns the same array when the row is not on this page', () => {
    // A realtime UPDATE for an item the operator is not looking at must not
    // cause a render, let alone a reload of the vault.
    expect(patchLoadedRow(rows, { id: 'zzz' })).toBe(rows)
  })

  it('does not mutate the array it was given', () => {
    patchLoadedRow(rows, { id: 'a', content_category: 'changed' })
    expect(rows[0].content_category).toBe('nude_photo')
  })
})

describe('isVideo', () => {
  it('recognises video mimetypes', () => {
    expect(isVideo({ mimetype: 'video/mp4' })).toBe(true)
    expect(isVideo({ mimetype: 'image/jpeg' })).toBe(false)
    expect(isVideo({ mimetype: null })).toBe(false)
    expect(isVideo({})).toBe(false)
  })
})

describe('the vault page itself', () => {
  // Comments explain what these patterns USED to be, so they have to come out
  // before scanning or the guard would trip on its own explanation.
  const source = readFileSync(
    join(process.cwd(), 'app', 'vault', 'page.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n')

  it('never mutates DOM that React owns', () => {
    // The old image error handler assigned to parentElement.innerHTML, so the
    // next reconciliation of that subtree could throw
    // "NotFoundError: The node to be removed is not a child of this node".
    expect(source).not.toContain('innerHTML')
    expect(source).not.toContain('parentElement')
  })

  it('does not flatten the whole vault on every render', () => {
    expect(source).not.toContain('Object.values(vaultAlbums)')
    expect(source).not.toContain('vaultAlbums')
  })

  it('renders grid tiles through the thumbnail-preferring source', () => {
    expect(source).toContain('gridImageSource')
    expect(source).toContain('previewImageSource')
  })

  it('reads albums as an aggregate rather than by loading rows', () => {
    expect(source).toContain('vault_album_summary')
  })

  it('keeps the All view, paginated rather than in memory', () => {
    expect(ALL_ALBUMS).toBe('__all__')
    expect(source).toContain('ALL_ALBUMS')
  })
})

// ---------------------------------------------------------------------------
// How complete an item's analysis is
// ---------------------------------------------------------------------------
//
// A video whose deep scan was skipped to avoid a large billed media transfer is
// not broken, and it is not the agency's problem to fix. In our implementation
// "protected media" means the signed CDN resource could not be sampled directly
// and the billed proxy would be needed — infrastructure behaviour, not a creator
// privacy setting.

describe('classificationStatusOf', () => {
  it('reads the stored status', () => {
    expect(classificationStatusOf({ classification_status: 'complete' })).toBe('complete')
    expect(classificationStatusOf({ classification_status: 'partial' })).toBe('partial')
    expect(classificationStatusOf({ classification_status: 'pending' })).toBe('pending')
  })

  it('treats an errored row as pending, because both mean "not done"', () => {
    expect(classificationStatusOf({ classification_status: 'error' })).toBe('pending')
  })

  it('infers a status for a row that predates the column', () => {
    // A backend deployed ahead of its migration must still render something
    // truthful rather than labelling every item incomplete.
    expect(
      classificationStatusOf({
        classified_at: '2026-01-01T00:00:00Z',
        content_category: 'nude_photo',
      }),
    ).toBe('complete')
    expect(classificationStatusOf({})).toBe('unknown')
    expect(classificationStatusOf(null)).toBe('unknown')
  })
})

describe('analysisNotice', () => {
  it('explains a partial analysis in one plain sentence', () => {
    const notice = analysisNotice({ classification_status: 'partial' })
    expect(notice?.title).toBe('Partial analysis')
    expect(notice?.detail).toBe(
      'Thumbnail classified; deep video scan skipped to avoid a high media-transfer cost.',
    )
  })

  it('says nothing at all about a complete analysis', () => {
    // A notice on every item teaches nobody anything.
    expect(analysisNotice({ classification_status: 'complete' })).toBeNull()
    expect(analysisNotice({})).toBeNull()
    expect(analysisNotice(null)).toBeNull()
  })

  it('points a pending item at the control that can resolve it', () => {
    const notice = analysisNotice({ classification_status: 'pending' })
    expect(notice?.title).toBe('Analysis pending')
    expect(notice?.detail).toContain('manual AI re-analysis')
  })

  it('never exposes low-level CDN or auth jargon', () => {
    // And never asks the agency to "unprotect" or "make public" anything: a
    // protected asset is infrastructure behaviour, not a setting they own.
    for (const status of ['partial', 'pending']) {
      const notice = analysisNotice({ classification_status: status })
      const text = `${notice?.title} ${notice?.detail}`.toLowerCase()
      for (const jargon of [
        'cdn',
        'signed',
        'token',
        'auth',
        '403',
        'unprotect',
        'make public',
        'protected',
        'expired',
      ]) {
        expect(text).not.toContain(jargon)
      }
    }
  })
})

describe('transferMegabytes', () => {
  it('reports what actually moved through the billed proxy', () => {
    expect(transferMegabytes({ classification_media_bytes: 5 * 1024 * 1024 })).toBe(5)
    expect(transferMegabytes({ classification_media_bytes: 1536 * 1024 })).toBe(1.5)
  })

  it('is null for every free retrieval path', () => {
    // The normal case: direct range sampling transfers nothing billable, so
    // there is no cost line to render.
    expect(transferMegabytes({ classification_media_bytes: 0 })).toBeNull()
    expect(transferMegabytes({})).toBeNull()
    expect(transferMegabytes(null)).toBeNull()
  })
})
