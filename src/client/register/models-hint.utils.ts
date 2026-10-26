/**
 * The official Models page edits ACP routes with a generic editor that only says
 * `<hint> (<namespace>)`. Rewrite exactly those hint lines; the namespace suffix is the
 * one stable, locale-independent marker the editor renders.
 * @returns how many lines were rewritten.
 */
export function rewriteModelsHints(root: ParentNode, namespace: string, text: string): number {
  const suffix = ` (${namespace})`
  let rewritten = 0
  for (const element of root.querySelectorAll('p')) {
    const current = element.textContent ?? ''
    if (element.childElementCount === 0 && current.endsWith(suffix)) {
      element.textContent = text
      rewritten++
    }
  }
  return rewritten
}
