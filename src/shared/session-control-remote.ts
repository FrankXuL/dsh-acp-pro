import { z, type ZodType } from 'zod'
import type { AcpSessionControl, AcpSessionSnapshot } from './session-control.ts'

/** The strict codec subset consumed by DSH Typert's Host and Client faces. */
export interface AcpRemoteCodec {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly create: () => ZodType
  readonly encode: (value: unknown, writeBytes: (bytes: Uint8Array, path: readonly (string | number)[]) => null) => unknown
  readonly decode: (value: unknown) => unknown
}

export interface AcpRemoteParameter {
  readonly name: string
  readonly wire: string
  readonly source: 'json'
  readonly codec: AcpRemoteCodec
  readonly acceptsUndefined?: true
}

export interface AcpRemoteInvocation {
  readonly id: string
  readonly service: 'acpSessionControl'
  readonly namespace: 'acpSessionControl'
  readonly method: keyof AcpSessionControl
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly AcpRemoteParameter[]
  readonly result: AcpRemoteCodec
}

export interface AcpSessionControlContribution {
  readonly package: 'dsh-acp-pro'
  readonly descriptors: readonly AcpRemoteInvocation[]
}

export interface AcpRemoteFailure {
  code: string
  message: string
}

export type AcpRemoteResult<T> =
  | { ok: true, value: T }
  | { ok: false, error: AcpRemoteFailure }

export interface AcpSessionControlClient {
  getSessionSnapshots(input: { dshSessionId: string }): Promise<AcpRemoteResult<AcpSessionSnapshot[]>>
  setSessionConfig(input: {
    provider: string
    sessionId: string
    configId: string
    value: string
    expectedRevision?: number
  }): Promise<AcpRemoteResult<AcpSessionSnapshot>>
  setSessionMode(input: {
    provider: string
    sessionId: string
    modeId: string
    expectedRevision?: number
  }): Promise<AcpRemoteResult<AcpSessionSnapshot>>
  resetSession(input: { provider: string, sessionId: string }): Promise<AcpRemoteResult<void>>
}

const configValueSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
}).strict()

const configGroupSchema = z.object({
  group: z.string(),
  name: z.string(),
  options: z.array(configValueSchema),
}).strict()

const configOptionSchema = z.object({
  type: z.literal('select'),
  id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
  currentValue: z.string(),
  options: z.array(z.union([configValueSchema, configGroupSchema])),
}).strict()

const snapshotSchema = z.object({
  provider: z.string(),
  sessionId: z.string(),
  acpSessionId: z.string().optional(),
  turnState: z.enum(['idle', 'running', 'unknown']),
  revision: z.number().int().nonnegative(),
  configOptions: z.array(configOptionSchema),
  currentModeId: z.string().optional(),
  availableModes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  }).strict()),
  availableCommands: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputHint: z.string().optional(),
  }).strict()),
  recovery: z.enum(['new', 'loaded']),
}).strict()

function codec(typeSymbol: string, schema: ZodType): AcpRemoteCodec {
  const parse = (value: unknown): unknown => schema.parse(value)
  return {
    mode: 'strict',
    typeSymbol,
    create: () => schema,
    encode: parse,
    decode: parse,
  }
}

function parameter(name: string, valueCodec: AcpRemoteCodec, acceptsUndefined = false): AcpRemoteParameter {
  return {
    name,
    wire: name,
    source: 'json',
    codec: valueCodec,
    ...(acceptsUndefined ? { acceptsUndefined: true } : {}),
  }
}

const textCodec = codec('dsh-acp-pro#string', z.string())
const revisionCodec = codec('dsh-acp-pro#number', z.number().int().nonnegative().optional())
const snapshotListCodec = codec('dsh-acp-pro#AcpSessionSnapshot[]', z.array(snapshotSchema))
const snapshotCodec = codec('dsh-acp-pro#AcpSessionSnapshot', snapshotSchema)
const voidCodec = codec('dsh-acp-pro#void', z.undefined())

/** Checked-in matching Host/Client contribution; all boundary values use strict codecs. */
export const ACP_SESSION_CONTROL_CONTRIBUTION: AcpSessionControlContribution = {
  package: 'dsh-acp-pro',
  descriptors: [
    {
      id: 'dsh-acp-pro#acpSessionControl/getSessionSnapshots',
      service: 'acpSessionControl',
      namespace: 'acpSessionControl',
      method: 'getSessionSnapshots',
      invocation: { kind: 'direct' },
      parameters: [parameter('dshSessionId', textCodec)],
      result: snapshotListCodec,
    },
    {
      id: 'dsh-acp-pro#acpSessionControl/setSessionConfig',
      service: 'acpSessionControl',
      namespace: 'acpSessionControl',
      method: 'setSessionConfig',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('provider', textCodec),
        parameter('sessionId', textCodec),
        parameter('configId', textCodec),
        parameter('value', textCodec),
        parameter('expectedRevision', revisionCodec, true),
      ],
      result: snapshotCodec,
    },
    {
      id: 'dsh-acp-pro#acpSessionControl/setSessionMode',
      service: 'acpSessionControl',
      namespace: 'acpSessionControl',
      method: 'setSessionMode',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('provider', textCodec),
        parameter('sessionId', textCodec),
        parameter('modeId', textCodec),
        parameter('expectedRevision', revisionCodec, true),
      ],
      result: snapshotCodec,
    },
    {
      id: 'dsh-acp-pro#acpSessionControl/resetSession',
      service: 'acpSessionControl',
      namespace: 'acpSessionControl',
      method: 'resetSession',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('provider', textCodec),
        parameter('sessionId', textCodec),
      ],
      result: voidCodec,
    },
  ],
}
