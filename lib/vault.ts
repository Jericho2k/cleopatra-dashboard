/**
 * What the vault page asks the database for, and which image it renders.
 *
 * FE-002 - the grid used `item.url`, the ORIGINAL Fansly asset, inside a
 * 100x100 box, while `thumbnail_url` sat selected and unused. At 200 visible
 * items and a typical 2-4 MB original that is hundreds of megabytes of image
 * transfer to draw postage stamps.
 *
 * FE-003 - the page loaded the ENTIRE creator_vault_media table into state, 26
 * columns including ai_description, tags, good_for and both signed URLs, in
 * 1,000-row pages awaited in a loop. At 50,000 items that is ~75 MB of JSON
 * across 50 sequential requests and a plausible OOM. The grid renders an image
 * and nothing else; everything else belongs in the detail modal, fetched when
 * it opens.
 */

/** Rows per page of a browsed album. Two screens' worth on a wide monitor. */
export const VAULT_PAGE_SIZE = 200

/**
 * The projection the grid needs.
 *
 * Both URLs are here because the grid prefers the thumbnail and falls back to
 * the original when a variant was never produced. Everything the grid does not
 * draw - descriptions, tags, scene fields, classification metadata - is left
 * for the detail fetch.
 */
export const VAULT_GRID_COLUMNS = 'id, album_title, mimetype, filename, thumbnail_url, url'

/** The heavy columns, read for one item when its modal opens. */
export const VAULT_DETAIL_COLUMNS = [
  'id',
  'album_title',
  'mimetype',
  'filename',
  'thumbnail_url',
  'url',
  'content_category',
  'ai_description',
  'price_min',
  'price_max',
  'scene_id',
  'scene_location',
  'scene_outfit',
  'scene_lighting',
  'explicitness_level',
  'good_for',
  'tags',
  'classification_version',
  'classification_model',
  'classification_source',
  'classification_confidence',
  'classified_at',
].join(', ')

export const ALL_ALBUMS = '__all__'
export const UNCATEGORIZED_ALBUM = 'Uncategorized'

export type VaultGridItem = {
  id: string
  album_title?: string | null
  mimetype?: string | null
  filename?: string | null
  thumbnail_url?: string | null
  url?: string | null
}

export type VaultAlbum = {
  title: string
  count: number
}

export function albumTitleOf(item: { album_title?: string | null }): string {
  const title = (item.album_title ?? '').trim()
  return title || UNCATEGORIZED_ALBUM
}

/**
 * The image the GRID should request: the thumbnail whenever one exists.
 *
 * Signed URL expiry is unchanged by this - both URLs are signed the same way
 * and refreshed by the same reload, so a stale thumbnail fails exactly as a
 * stale original did, and the caller renders its placeholder.
 */
export function gridImageSource(item: VaultGridItem): string | null {
  const thumbnail = (item.thumbnail_url ?? '').trim()
  if (thumbnail) return thumbnail
  const original = (item.url ?? '').trim()
  return original || null
}

/**
 * The image the PREVIEW should request: the original, where full resolution is
 * what the operator opened the modal for. The thumbnail is the fallback, so an
 * item whose original is missing still shows something.
 */
export function previewImageSource(item: VaultGridItem): string | null {
  const original = (item.url ?? '').trim()
  if (original) return original
  const thumbnail = (item.thumbnail_url ?? '').trim()
  return thumbnail || null
}

export function isVideo(item: { mimetype?: string | null }): boolean {
  return Boolean(item.mimetype?.startsWith('video'))
}

/**
 * Album counts from raw rows.
 *
 * Only used by the fallback path, for a deployment where the
 * vault_album_summary function has not been applied yet. The normal path gets
 * the same shape from one aggregate round trip that transfers no rows at all.
 */
export function summarizeAlbums(
  rows: { album_title?: string | null }[],
): VaultAlbum[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const title = albumTitleOf(row)
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

export function totalItems(albums: VaultAlbum[]): number {
  return albums.reduce((sum, album) => sum + album.count, 0)
}

/**
 * Apply one realtime row change to the page currently on screen.
 *
 * The old handler re-ran the whole vault load 750 ms after ANY change to
 * creator_vault_media, so a categorisation run made the page re-download the
 * entire vault over and over. An UPDATE only ever affects one row, and if that
 * row is not on the current page there is nothing to do at all.
 *
 * Returns the same array reference when nothing changed, so React can skip the
 * re-render.
 */
export function patchLoadedRow<T extends { id: string }>(
  rows: T[],
  changed: Partial<T> & { id: string },
): T[] {
  const index = rows.findIndex(row => row.id === changed.id)
  if (index === -1) return rows
  const next = rows.slice()
  next[index] = { ...next[index], ...changed }
  return next
}
