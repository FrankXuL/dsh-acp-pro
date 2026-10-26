import type { Translate } from '../locales/index.ts'
import { rewriteModelsHints } from './models-hint.utils.ts'

/** The settings panel; the Models page editor only ever renders inside it. */
const SETTINGS_DIALOG = '[role="dialog"]'

/**
 * Replace the official Models page editor's "edit cordis.patch.yml" hint for ACP routes
 * with a pointer to the ACP Agents page. The editor offers no slot, so the patch follows
 * the DOM while the plugin's settings section is served.
 */
export function registerModelsHint(namespace: string, t: Translate): () => void {
  const sync = (): void => {
    for (const dialog of document.querySelectorAll(SETTINGS_DIALOG))
      rewriteModelsHints(dialog, namespace, t('managedHere'))
  }
  // keep:effect DOM patch of an official component; the observer is disconnected by the returned disposer.
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  sync()
  return () => observer.disconnect()
}
