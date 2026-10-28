import { PLUGIN_ID } from '../../shared/constants.ts'
import { SESSION_CONTROL_CSS } from '../styles/session-control.ts'

export function registerSessionControlStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.owner = `${PLUGIN_ID}-session-control`
  style.textContent = SESSION_CONTROL_CSS
  document.head.append(style)
  return () => { style.remove() }
}
