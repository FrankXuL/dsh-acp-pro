import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk'
import type { ContentBlock, GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import { fileHandleText, offloadedImageText, requestImageHandleText, textOnlyImageText } from '@deepseek-ai/dsh-llm'

type ImageAttachmentRef = Extract<ContentBlock, { type: 'image' }>['attachment']

/** One image prepared for the agent: base64 request bytes plus the size its handle text names. */
export interface PromptImage {
  data: string
  mimeType: string
  width: number
  height: number
}

/**
 * Image bytes for the turn being sent. Building a prompt records every image it would
 * send in `wanted`; the caller reads those and builds again with them in `read`.
 */
export interface PromptImages {
  read: ReadonlyMap<string, PromptImage>
  wanted: Map<string, ImageAttachmentRef>
}

type Conversation = GenerateOptions['messages']

const CONTINUE_PROMPT = 'Continue.'

function blockText(block: ContentBlock): string | undefined {
  switch (block.type) {
    case 'text':
      return block.text
    case 'image':
      return block.offloaded === true ? offloadedImageText(block.attachment) : textOnlyImageText(block.attachment)
    case 'file':
      return fileHandleText(block.attachment, undefined)
    case 'tool-call':
      return `[tool call ${block.name} ${block.arguments}]`
    default:
      return undefined
  }
}

function messageText(message: RequestMessage): string {
  return message.content.map(blockText).filter((text): text is string => text !== undefined && text.length > 0).join('\n')
}

/**
 * One content block as the agent sees it: the image bytes read for this turn plus their
 * handle text, else whatever text stands in for the block. An image nobody has read yet is
 * recorded as wanted, so the caller can read it and build the prompt again.
 */
function blockParts(block: ContentBlock, images: PromptImages | undefined): AcpContentBlock[] {
  if (block.type === 'image' && images !== undefined && block.offloaded !== true) {
    const id = String(block.attachment.attachmentId)
    const image = images.read.get(id)
    if (image !== undefined) {
      return [
        { type: 'text', text: requestImageHandleText(block.attachment, image) },
        { type: 'image', data: image.data, mimeType: image.mimeType },
      ]
    }
    images.wanted.set(id, block.attachment)
  }
  const text = blockText(block)
  return text === undefined || text.length === 0 ? [] : [{ type: 'text', text }]
}

function toAcpBlocks(messages: readonly RequestMessage[], images?: PromptImages): AcpContentBlock[] {
  const blocks = messages.flatMap(message => message.content.flatMap(block => blockParts(block, images)))
  return blocks.length > 0 ? blocks : [{ type: 'text', text: CONTINUE_PROMPT }]
}

/**
 * Prompt blocks under construction. Text accumulates into one block until an image has to
 * break the run, so a transcript without images is still sent as the single block it was.
 */
class BlockWriter {
  private readonly blocks: AcpContentBlock[] = []
  private pending = ''

  write(text: string, separator = '\n'): void {
    if (text.length === 0)
      return
    this.pending = this.pending.length === 0 ? text : `${this.pending}${separator}${text}`
  }

  attach(block: AcpContentBlock): void {
    this.flush()
    this.blocks.push(block)
  }

  private flush(): void {
    if (this.pending.length === 0)
      return
    this.blocks.push({ type: 'text', text: this.pending })
    this.pending = ''
  }

  done(): AcpContentBlock[] {
    this.flush()
    return this.blocks
  }
}

const ROLE_LABEL: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool result',
}

export function systemText(options: GenerateOptions): string {
  const parts = options.messages.filter(message => message.role === 'system').map(messageText)
  if (options.system !== undefined)
    parts.unshift(options.system)
  return parts.filter(part => part.length > 0).join('\n\n')
}

export function conversationOf(options: GenerateOptions): Conversation {
  return options.messages.filter(message => message.role !== 'system')
}

export function consumedIds(conversation: Conversation): string[] {
  return conversation.flatMap(message => message.id === undefined ? [] : [message.id])
}

export function incrementalPrompt(conversation: Conversation, consumed: readonly string[], route: string, images?: PromptImages): AcpContentBlock[] | undefined {
  if (consumed.length > conversation.length)
    return undefined
  for (const [index, id] of consumed.entries()) {
    if (conversation[index]?.id !== id)
      return undefined
  }
  const fresh: RequestMessage[] = []
  for (const message of conversation.slice(consumed.length)) {
    if (message.role === 'assistant') {
      if (message.source.provider === route && fresh.length === 0)
        continue
      return undefined
    }
    if (message.role === 'tool')
      return undefined
    if (message.role === 'user')
      fresh.push(message)
  }
  return toAcpBlocks(fresh, images)
}

/**
 * The replayed history. Text is labelled by role as one run; an image the turn can send is
 * attached in place, so rebuilding a session does not silently blind the agent to pictures
 * the user already sent.
 */
function writeHistory(writer: BlockWriter, history: Conversation, images: PromptImages | undefined): void {
  const messages = history.filter(message => message.role in ROLE_LABEL)
    .map(message => [ROLE_LABEL[message.role]!, message.content.flatMap(block => blockParts(block, images))] as const)
    .filter(([, parts]) => parts.length > 0)
  if (messages.length === 0)
    return
  writer.write('<conversation_history>', '\n\n')
  for (const [order, [label, parts]] of messages.entries()) {
    let labelled = false
    for (const [index, part] of parts.entries()) {
      // The role label opens the message, whether its first part is text or a picture.
      const separator = index === 0 && order > 0 ? '\n\n' : '\n'
      if (part.type === 'text') {
        writer.write(labelled ? part.text : `${label}: ${part.text}`, separator)
        labelled = true
        continue
      }
      if (!labelled) {
        writer.write(`${label}:`, separator)
        labelled = true
      }
      writer.attach(part)
    }
  }
  writer.write('</conversation_history>')
}

export function fullPrompt(conversation: Conversation, system: string | undefined, images?: PromptImages): AcpContentBlock[] {
  let split = conversation.length
  while (split > 0 && conversation[split - 1]?.role === 'user')
    split--
  const writer = new BlockWriter()
  if (system !== undefined && system.length > 0)
    writer.write(`<system_instructions>\n${system}\n</system_instructions>`)
  // The first history message follows its opening tag on the next line; later ones are
  // separated by a blank line, as is the whole block from the system instructions above it.
  writeHistory(writer, conversation.slice(0, split), images)
  const preface = writer.done()
  const blocks = toAcpBlocks(conversation.slice(split), images)
  return preface.length === 0 ? blocks : [...preface, ...blocks]
}
