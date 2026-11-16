import type { IconProps } from './icons/props.ts'

/**
 * Render the product mark: the application tile with the logical-not glyph.
 * The tile carries fixed colors so it matches the application and favicon artwork in both themes.
 * @param props.size - square edge in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the product name for accessibility).
 */
export function ProductMark({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#2C2C2A" />
      <path d="M27 37H73V63" stroke="#F0997B" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
