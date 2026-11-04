/**
 * The slice of `@deepseek-ai/dsh-client-ui-chat` (0.2.1-rc.5) the client uses.
 *
 * Platform seed, never installed here (see `dsh-client-ui-slots.d.ts`). Declarations are
 * transcribed from the published `lib/types/client`, limited to what this plugin produces: a
 * Chat-target view node, the merge-extensible payload registry its Definitions key into, and the
 * keyed `conversation.chat.node` slot entry whose `keyProps.node` carries that payload.
 */
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  import type { ConversationLocation, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

  /** Merge-extensible payload registry keyed by final Chat renderer kind. */
  export interface ChatNodeDataMap {
  }

  /** Renderer kinds contributed by the currently installed Chat business modules. */
  export type ChatNodeKind = Extract<keyof ChatNodeDataMap, string>

  /** Final Chat render unit produced by a Chat business Definition. */
  export interface ChatConversationViewNode extends ConversationViewNode {
    readonly target: 'chat'
    readonly anchorSeq: number
    readonly location: ConversationLocation
    readonly visibility: 'visible' | 'hidden'
  }

  /** Final Chat Node narrowed to one registered renderer kind and payload. */
  export type ChatNode<Kind extends ChatNodeKind = ChatNodeKind> = ChatConversationViewNode & {
    readonly kind: Kind
    readonly data: ChatNodeDataMap[Kind]
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  import type { ChatNode, ChatNodeKind } from '@deepseek-ai/dsh-client-ui-chat/client'

  interface SlotMap {
    /** Keyed Chat renderer: the owner supplies file opening, the key supplies the node. */
    'conversation.chat.node': {
      kind: 'keyed'
      scope: 'session'
      owner: {
        openFile: (path: string, options?: { line?: number }) => void
        cwd?: string | undefined
      }
      keyProps: {
        [Kind in ChatNodeKind]: { node: ChatNode<Kind> }
      }
    }
  }
}
