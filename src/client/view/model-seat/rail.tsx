/**
 * The picker's source rail: one glyph button per source, plus the tab-name and glyph rules.
 *
 * Presentation only — it receives the already-resolved tab list and reports clicks. Keeping it
 * separate means a change to rail chrome never touches selection logic, and vice versa.
 */

import type { ReactElement } from 'react'
import type { AgentProfileView } from '../../service/model-seat-sources.ts'
import { DSH_TAB, FAVORITES_TAB } from '../../service/selection.ts'
import { resolveSourceIcon } from '../../service/model-seat-sources.ts'
import { MONOCHROME_PROVIDERS, providerIconUrl } from '../../assets/provider-icons.ts'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '@deepseek-ai/dsh-client-ui-primitives'

const FAVORITES_ICON = <path d="M12 3.7l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.72l-5.1 2.68.97-5.68L3.75 9.7l5.7-.83z" />

/** The platform source is DSH itself, so its mark is the native fish silhouette. */
function PlatformIcon(): ReactElement {
  return (
    <svg
      width={17}
      height={17}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={FISH_LOGO_PATH} fill="currentColor" />
    </svg>
  )
}

/** One rail glyph: favorites star, platform mark, or the configured/detected provider mark. */
export function SourceIcon({ tab, agents }: { tab: string, agents: Record<string, AgentProfileView> }): ReactElement {
  const common = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (tab === FAVORITES_TAB)
    return <svg {...common} fill="currentColor" stroke="none">{FAVORITES_ICON}</svg>
  if (tab === DSH_TAB)
    return <PlatformIcon />
  const glyph = resolveSourceIcon(agents[tab] ?? {}, tab)
  if (glyph.kind === 'builtin') {
    const url = providerIconUrl(glyph.name)
    if (url !== undefined) {
      // Monochrome marks follow the label colour so they survive a light theme; the rest keep
      // their own colours and are drawn as images.
      return MONOCHROME_PROVIDERS.has(glyph.name)
        ? <span className="dsh-model-seat-brand" style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }} />
        : <img className="dsh-model-seat-brand-img" src={url} alt="" draggable={false} width={16} height={16} />
    }
  }
  if (glyph.kind === 'url')
    return <img className="dsh-model-seat-rail-img" src={glyph.url} alt="" width={16} height={16} />
  if (glyph.kind === 'builtin')
    return <span className="dsh-model-seat-rail-glyph">{glyph.name.slice(0, 1).toUpperCase()}</span>
  return <span className="dsh-model-seat-rail-glyph">{glyph.text}</span>
}

/** Display name for one rail tab. */
export function tabName(tab: string, agents: Record<string, AgentProfileView>): string {
  if (tab === FAVORITES_TAB)
    return '收藏'
  if (tab === DSH_TAB)
    return 'DSH'
  return agents[tab]?.displayName ?? tab
}
