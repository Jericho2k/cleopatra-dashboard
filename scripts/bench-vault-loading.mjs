/**
 * FE-002 / FE-003 - what the vault page actually pulls into the browser.
 *
 * This is an analytical model, not a live measurement: it computes rows
 * fetched, request count, JSON transferred and rows retained for the BEFORE and
 * AFTER designs at four vault sizes. The row-size constants come from the
 * columns each design selects, so the shape of the answer is exact even though
 * the byte figures are estimates.
 *
 * Usage:
 *   node scripts/bench-vault-loading.mjs
 *   node scripts/bench-vault-loading.mjs --json
 */

const SIZES = [100, 1000, 10000, 50000]

// BEFORE: 26 columns including ai_description, tags, good_for and BOTH signed
// CDN URLs (200-400 characters each). The audit estimated 1-2 KB per row.
const BEFORE_ROW_BYTES = 1500
const BEFORE_PAGE_SIZE = 1000

// AFTER: id, album_title, mimetype, filename, thumbnail_url, url. Two signed
// URLs still dominate; everything descriptive is gone.
const AFTER_ROW_BYTES = 620
const AFTER_PAGE_SIZE = 200

// One album row from the aggregate: a title and a count.
const ALBUM_ROW_BYTES = 40
const ALBUMS_PER_VAULT = size => Math.max(1, Math.min(40, Math.round(size / 250)))

// A typical original vs the variant the grid should have been asking for.
const ORIGINAL_IMAGE_BYTES = 3 * 1024 * 1024
const THUMBNAIL_IMAGE_BYTES = 25 * 1024
// The old grid capped rendering at 200 tiles; the new one loads 200 per page.
const VISIBLE_TILES = 200

function before(size) {
  const requests = Math.ceil(size / BEFORE_PAGE_SIZE)
  return {
    rows_fetched_initially: size,
    requests_initially: requests,
    json_bytes: size * BEFORE_ROW_BYTES,
    rows_retained: size,
    image_bytes_opening_an_album: VISIBLE_TILES * ORIGINAL_IMAGE_BYTES,
    // Any change to any row re-ran the whole load, debounced 750 ms.
    realtime_update_rows_refetched: size,
    realtime_update_requests: requests,
  }
}

function after(size) {
  const albums = ALBUMS_PER_VAULT(size)
  const firstPage = Math.min(size, AFTER_PAGE_SIZE)
  return {
    // Opening the page fetches album counts only: no media rows at all.
    rows_fetched_initially: albums,
    requests_initially: 1,
    json_bytes: albums * ALBUM_ROW_BYTES,
    rows_retained: albums,
    // Then opening an album fetches one page.
    rows_fetched_opening_an_album: firstPage,
    requests_opening_an_album: 1,
    json_bytes_opening_an_album: firstPage * AFTER_ROW_BYTES,
    rows_retained_browsing_an_album: firstPage,
    image_bytes_opening_an_album: firstPage * THUMBNAIL_IMAGE_BYTES,
    // An UPDATE patches one row in place; nothing is refetched.
    realtime_update_rows_refetched: 0,
    realtime_update_requests: 0,
  }
}

const results = SIZES.map(size => ({ size, before: before(size), after: after(size) }))

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log('Vault page data loading, before vs after')
  console.log()
  const header =
    `${'vault'.padStart(7)}` +
    `${'rows (before)'.padStart(15)}${'rows (after)'.padStart(14)}` +
    `${'reqs (before)'.padStart(15)}${'reqs (after)'.padStart(13)}` +
    `${'JSON before'.padStart(14)}${'JSON after'.padStart(13)}`
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const row of results) {
    console.log(
      `${String(row.size).padStart(7)}` +
        `${String(row.before.rows_fetched_initially).padStart(15)}` +
        `${String(row.after.rows_fetched_initially).padStart(14)}` +
        `${String(row.before.requests_initially).padStart(15)}` +
        `${String(row.after.requests_initially).padStart(13)}` +
        `${mb(row.before.json_bytes).padStart(14)}` +
        `${mb(row.after.json_bytes).padStart(13)}`,
    )
  }
  console.log()
  console.log('Rows and requests above are for OPENING THE PAGE. Opening an album')
  console.log(
    `then costs 1 request and ${AFTER_PAGE_SIZE} rows, whatever the vault size.`,
  )
  console.log()
  console.log(
    `Images for one album view: ${mb(VISIBLE_TILES * ORIGINAL_IMAGE_BYTES)} of originals ` +
      `before, ${mb(AFTER_PAGE_SIZE * THUMBNAIL_IMAGE_BYTES)} of thumbnails after.`,
  )
  console.log(
    'One realtime row change: whole vault refetched before, one row patched in place after.',
  )
  console.log()
  console.log('Byte figures are modelled from the selected columns, not measured.')
}
