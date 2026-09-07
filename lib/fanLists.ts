/**
 * Presentation rules for fan lists.
 *
 * Lists come from two places: Cleopatra itself, and the creator's own Fansly
 * account. Operators must be able to tell them apart at a glance, because
 * Cleopatra does not own a Fansly list and cannot rename, edit, or delete it.
 */

export type FanListLike = {
  id: string
  name: string
  source?: string | null
  external_archived_at?: string | null
}

/** Whether this list mirrors a list that lives on the creator's Fansly account. */
export function isFanslyList(list: FanListLike): boolean {
  return list.source === 'fansly'
}

/** Whether Fansly has stopped returning this mirrored list.
 *
 *  The row is kept rather than deleted so an Auto Audience or re-engagement
 *  rule pointing at it still resolves, but it should not be offered as a fresh
 *  targeting choice.
 */
export function isArchivedFanslyList(list: FanListLike): boolean {
  return isFanslyList(list) && Boolean(list.external_archived_at)
}

/** Whether an operator may rename, recolor, or delete this list in Cleopatra. */
export function isEditableList(list: FanListLike): boolean {
  return !isFanslyList(list)
}

/** Display name, prefixed for imported lists: "Fansly · VIP". */
export function fanListLabel(list: FanListLike): string {
  return isFanslyList(list) ? `Fansly · ${list.name}` : list.name
}

/** Short source badge, or null for Cleopatra's own lists. */
export function fanListBadge(list: FanListLike): string | null {
  if (!isFanslyList(list)) return null
  return isArchivedFanslyList(list) ? 'FANSLY · REMOVED' : 'FANSLY'
}

/** Local lists first, then imported ones, each alphabetically, with archived
 *  mirrors last so they never sit above a live choice. */
export function sortFanLists<T extends FanListLike>(lists: T[]): T[] {
  return [...lists].sort((a, b) => {
    const rank = (list: FanListLike) =>
      isArchivedFanslyList(list) ? 2 : isFanslyList(list) ? 1 : 0
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
}
