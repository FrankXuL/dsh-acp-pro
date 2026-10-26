import type { PlanEntry, SessionUpdate, ToolCallStatus, Usage } from '@agentclientprotocol/sdk'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

type OpenKind = 'text' | 'reasoning'

interface OpenBlock {
  kind: OpenKind
  index: number
  text: string
}

const PLAN_MARK: Record<PlanEntry['status'], string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
}

const TERMINAL_STATUS: ReadonlySet<ToolCallStatus> = new Set(['completed', 'failed'])

export class ChunkTranslator {
  private open: OpenBlock | undefined
  private nextIndex = 0
  private readonly tools = new Map<string, { title: string, status: ToolCallStatus | undefined }>()

  constructor(private readonly showToolCalls: boolean) {}

  get emittedBlocks(): number {
    return this.nextIndex
  }

  push(update: SessionUpdate): StreamChunk[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return update.content.type === 'text' ? this.append('text', update.content.text) : []
      case 'agent_thought_chunk':
        return update.content.type === 'text' ? this.append('reasoning', update.content.text) : []
      case 'tool_call': {
        if (!this.showToolCalls)
          return []
        this.tools.set(update.toolCallId, { title: update.title, status: update.status })
        const status = update.status !== undefined && TERMINAL_STATUS.has(update.status) ? ` (${update.status})` : ''
        return this.append('reasoning', `${this.separator()}▸ [${update.kind ?? 'tool'}] ${update.title}${status}\n`)
      }
      case 'tool_call_update': {
        if (!this.showToolCalls)
          return []
        const known = this.tools.get(update.toolCallId) ?? { title: update.toolCallId, status: undefined }
        const title = update.title ?? known.title
        const status = update.status ?? known.status
        const changed = status !== known.status && status !== undefined && TERMINAL_STATUS.has(status)
        this.tools.set(update.toolCallId, { title, status: status ?? undefined })
        return changed ? this.append('reasoning', `  ↳ ${title}: ${status}\n`) : []
      }
      case 'plan': {
        if (!this.showToolCalls || update.entries.length === 0)
          return []
        const lines = update.entries.map(entry => `${PLAN_MARK[entry.status] ?? '[ ]'} ${entry.content}`)
        return this.append('reasoning', `${this.separator()}Plan:\n${lines.join('\n')}\n`)
      }
      default:
        return []
    }
  }

  close(): StreamChunk[] {
    const open = this.open
    if (open === undefined)
      return []
    this.open = undefined
    return [{
      type: 'block-end',
      index: open.index,
      block: open.kind === 'text' ? { type: 'text', text: open.text } : { type: 'reasoning', text: open.text },
    }]
  }

  private separator(): string {
    const open = this.open
    return open?.kind === 'reasoning' && open.text.length > 0 && !open.text.endsWith('\n') ? '\n' : ''
  }

  private append(kind: OpenKind, text: string): StreamChunk[] {
    if (text.length === 0)
      return []
    const chunks: StreamChunk[] = []
    if (this.open?.kind !== kind) {
      chunks.push(...this.close())
      this.open = { kind, index: this.nextIndex++, text: '' }
      chunks.push({ type: 'block-start', index: this.open.index, blockType: kind })
    }
    const open = this.open!
    open.text += text
    chunks.push(kind === 'text'
      ? { type: 'text-delta', index: open.index, text }
      : { type: 'reasoning-delta', index: open.index, text })
    return chunks
  }
}

function delta(current: number | null | undefined, previous: number | null | undefined): number {
  return Math.max(0, (current ?? 0) - (previous ?? 0))
}

export function usageDelta(current: Usage, previous: Usage | undefined): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: delta(current.inputTokens, previous?.inputTokens),
    outputTokens: delta(current.outputTokens, previous?.outputTokens),
    totalTokens: delta(current.totalTokens, previous?.totalTokens),
  }
  const cacheRead = delta(current.cachedReadTokens, previous?.cachedReadTokens)
  const cacheWrite = delta(current.cachedWriteTokens, previous?.cachedWriteTokens)
  const reasoning = delta(current.thoughtTokens, previous?.thoughtTokens)
  if (cacheRead > 0)
    usage.cacheReadTokens = cacheRead
  if (cacheWrite > 0)
    usage.cacheWriteTokens = cacheWrite
  if (reasoning > 0)
    usage.reasoningTokens = reasoning
  return usage
}
