// Test stand-ins for `@deepseek-ai/dsh-client-ui-primitives`, a runtime seed of the DSH web
// shell that is not installed here. Plain elements keep labels and handlers observable.
import type { ReactNode } from 'react'

export function Button({ children, onClick, disabled }: { children?: ReactNode, onClick?: () => void, disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean, onChange: (next: boolean) => void, label: string, disabled?: boolean }) {
  return <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean, onChange: (next: boolean) => void, label: string, disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />
}

/** Stand-in fish path; the real module exports the long official silhouette. */
export const FISH_LOGO_PATH = 'M0 0h10v10H0z'
export const FISH_LOGO_VIEWBOX = { width: 10, height: 10 }

export function FishLogo({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><path d={FISH_LOGO_PATH} fill="currentColor" /></svg>
}

export function Tag({ children }: { children?: ReactNode }) {
  return <span>{children}</span>
}

const icon = () => null
export const IconChevronLeftOutlineRegular = icon
export const IconEditOutlineRegular = icon
export const IconPlusOutlineRegular = icon
export const IconRefreshOutlineRegular = icon
export const IconTrashOutlineRegular = icon
