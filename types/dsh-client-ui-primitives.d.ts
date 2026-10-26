/**
 * The slice of `@deepseek-ai/dsh-client-ui-primitives` (0.2.0-rc.2) the client uses.
 *
 * The package is a platform seed: DSH's web module table hands every client bundle the
 * shell's own instance, so it is never installed here (its `@deepseek-ai/cordis` peer
 * range also excludes the alpha cordis this repo builds against). Declarations are
 * transcribed from the published `lib/types`.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type {
    ButtonHTMLAttributes,
    ForwardRefExoticComponent,
    JSX,
    ReactNode,
    RefAttributes,
  } from 'react'

  export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

  export const Button: ForwardRefExoticComponent<{
    variant?: ButtonVariant
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string | undefined
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>>

  export function Checkbox(props: {
    checked: boolean
    onChange: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string | undefined
    className?: string | undefined
  }): JSX.Element

  export type TagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'

  export function Tag(props: { tone?: TagTone, className?: string | undefined, children?: ReactNode }): JSX.Element

  export interface IconProps {
    size?: number | undefined
    className?: string | undefined
  }

  export const IconPlusOutlineRegular: (props: IconProps) => JSX.Element
  export const IconRefreshOutlineRegular: (props: IconProps) => JSX.Element
  export const IconEditOutlineRegular: (props: IconProps) => JSX.Element
  export const IconTrashOutlineRegular: (props: IconProps) => JSX.Element
  export const IconChevronLeftOutlineRegular: (props: IconProps) => JSX.Element
}
