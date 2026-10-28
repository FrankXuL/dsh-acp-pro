/**
 * Selection rules for the composer model picker: which sources exist, what each tab shows, and
 * how a selection maps back to a model and its effort.
 *
 * Pure data and pure predicates — no React. The picker component owns rendering and interaction;
 * everything here answers "what should be shown or selected".
 */

import type { AgentProfileView } from './model-seat-sources.ts'
import type { ModelInfo, ModelProviderGroup, ModelSelection } from '../types/runtime.ts'
import { favoriteKey } from './favorites.ts'
import { sourceRoutes } from './model-seat-sources.ts'

/** The pseudo-tab aggregating favorites; never a provider id. */
export const FAVORITES_TAB = '__favorites__'

/** The pseudo-tab for the platform's own providers. */
export const DSH_TAB = 'dsh'

/** One model together with the provider group it came from. */
export interface GroupedModel {
  readonly group: ModelProviderGroup
  readonly model: ModelInfo
}

/** A group of models as one picker section. */
export interface VisibleGroup {
  readonly group: ModelProviderGroup
  readonly models: readonly ModelInfo[]
}

/** Find one provider group by id. */
export function groupOf(groups: readonly ModelProviderGroup[], id: string): ModelProviderGroup | undefined {
  return groups.find(group => group.id === id)
}

/** Resolve a selection to the model it names, when that model is still present. */
export function modelOf(groups: readonly ModelProviderGroup[], selection: ModelSelection | null): ModelInfo | undefined {
  if (selection === null)
    return undefined
  return groupOf(groups, selection.provider)?.models.find(model => model.id === selection.model)
}

/** Display name for an effort id, falling back to the id itself. */
export function effortName(model: ModelInfo | undefined, effortId: string | undefined): string | undefined {
  if (model === undefined || effortId === undefined)
    return undefined
  return model.reasoning?.efforts.find(effort => effort.id === effortId)?.name ?? effortId
}

/**
 * Which tabs the rail shows, and in what order.
 *
 * Favorites first, then the platform, then each configured ACP route that actually contributes
 * something (a provider group or a failure to report). A configured route with no models and no
 * failure is omitted: an empty tab is worse than no tab.
 *
 * @param groups - provider groups from the model directory.
 * @param failures - providers that failed to enumerate.
 * @param agents - configured agent profiles.
 * @returns tab ids in rail order.
 */
export function tabIdsOf(
  groups: readonly ModelProviderGroup[],
  failures: readonly { readonly id: string }[],
  agents: Record<string, AgentProfileView>,
): string[] {
  const present = new Set(groups.map(group => group.id))
  const failed = new Set(failures.map(failure => failure.id))
  const routes = sourceRoutesFromAgents(agents)
  return [
    FAVORITES_TAB,
    DSH_TAB,
    ...routes.filter(route => present.has(route) || failed.has(route)),
  ]
}

/** Routes that may appear on the rail, derived from already-resolved agent profiles. */
function sourceRoutesFromAgents(agents: Record<string, AgentProfileView>): string[] {
  return Object.entries(agents)
    .filter(([, profile]) => profile.enabled !== false)
    .sort(([leftRoute, left], [rightRoute, right]) => {
      const byName = (left.displayName ?? leftRoute).localeCompare(right.displayName ?? rightRoute)
      return byName !== 0 ? byName : leftRoute.localeCompare(rightRoute)
    })
    .map(([route]) => route)
}

/**
 * The models one tab shows, before search filtering.
 *
 * The favorites tab aggregates across every group; every other tab is either the platform
 * (every group that is not an ACP route) or exactly one ACP route.
 *
 * @param tab - active tab id.
 * @param groups - provider groups from the model directory.
 * @param routes - configured ACP routes.
 * @param favoriteSet - identities currently favorited.
 * @returns each shown model with its group, in group order then model order.
 */
export function modelsForTab(
  tab: string,
  groups: readonly ModelProviderGroup[],
  routes: readonly string[],
  favoriteSet: ReadonlySet<string>,
): GroupedModel[] {
  if (tab === FAVORITES_TAB) {
    return groups.flatMap(group =>
      group.models
        .filter(model => favoriteSet.has(favoriteKey(group.id, model.id)))
        .map(model => ({ group, model })),
    )
  }
  const inSource = groups.filter(group => tab === DSH_TAB ? !routes.includes(group.id) : group.id === tab)
  return inSource.flatMap(group => group.models.map(model => ({ group, model })))
}

/**
 * Fold already-filtered models into the sections the picker renders.
 *
 * @param models - models for the active tab, already search-filtered.
 * @returns one section per provider group that still has models.
 */
export function visibleGroupsOf(models: readonly GroupedModel[]): VisibleGroup[] {
  const byGroup = new Map<string, { group: ModelProviderGroup, models: ModelInfo[] }>()
  for (const { group, model } of models) {
    const entry = byGroup.get(group.id) ?? { group, models: [] }
    entry.models.push(model)
    byGroup.set(group.id, entry)
  }
  return [...byGroup.values()]
}

/**
 * Whether the picker shows a search box.
 *
 * Native rule: the search appears when the whole catalog exceeds four models, not per tab — so a
 * small ACP tab inside a large catalog still gets one.
 *
 * @param groups - provider groups from the model directory.
 * @returns whether to show the search entry.
 */
export function showsSearch(groups: readonly ModelProviderGroup[]): boolean {
  return groups.reduce((count, group) => count + group.models.length, 0) > 4
}

/** Whether the current selection belongs to one of the plugin's own ACP routes. */
export function isAcpSelection(selection: ModelSelection | null, routes: readonly string[]): boolean {
  return selection !== null && routes.includes(selection.provider)
}

/** Search predicate for the active query, case-insensitive on the model name. */
export function modelMatcher(query: string): (model: ModelInfo) => boolean {
  const needle = query.trim().toLowerCase()
  return model => needle.length === 0 || model.name.toLowerCase().includes(needle)
}

/** Routes used by the selection layer, so callers do not import two modules for one question. */
export { sourceRoutes }
