/** Shared provider display order for the composer and command model pickers. */

/**
 * Compare two display names the same way on every machine: case-folded code
 * points, so neither the host locale nor a vendor decides the order.
 * @param left - first display name.
 * @param right - second display name.
 * @returns a negative, zero, or positive comparison.
 */
export function compareDisplayNames(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a !== b) return a < b ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Order provider groups by display name, then id; model order within each group is unchanged.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy.
 */
export function orderModelProviders<T extends { readonly id: string; readonly name: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) => compareDisplayNames(left.name, right.name) || compareDisplayNames(left.id, right.id))
}
