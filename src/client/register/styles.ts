import { PLUGIN_ID } from '../../shared/constants.ts'
import { AGENTS_CSS } from '../styles/agents.ts'
import { RECORDS_CSS } from '../styles/records.ts'

/** Mount the page sheet for the plugin's lifetime. */
export function registerStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.owner = PLUGIN_ID
  style.textContent = AGENTS_CSS + RECORDS_CSS
  document.head.append(style)
  return () => {
    style.remove()
  }
}
