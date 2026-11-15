/** Shared provider display order for the composer and command model pickers. */
import { compareDisplayNames } from '@deepseek-ai/dsh-util-values'

/**
 * Order provider groups by display name, then id; model order within each group is unchanged.
 * @param groups - Provider groups in catalog order.
 * @returns a sorted copy.
 */
export function orderModelProviders<T extends { readonly id: string; readonly name: string }>(groups: readonly T[]): T[] {
  return groups.toSorted((left, right) => compareDisplayNames(left.name, right.name) || compareDisplayNames(left.id, right.id))
}
