import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AcpSessionConfigChoice, AcpSessionSnapshot } from '../../shared/session-control.ts'
import type { AcpSessionControlClient } from '../../shared/session-control-remote.ts'
import type { Translate } from '../locales/index.ts'

interface SessionControlPanelProps {
  sessionId: string
  input: InputState
  inputActions: InputActions
  control: AcpSessionControlClient
  t: Translate
}

function isConfigGroup(choice: AcpSessionConfigChoice): choice is Extract<AcpSessionConfigChoice, { group: string }> {
  return 'group' in choice
}

function commandText(name: string): string {
  return `${name.startsWith('/') ? name : `/${name}`} `
}

export function insertSessionCommand(inputActions: InputActions, name: string): boolean {
  return inputActions.insertText(commandText(name), inputActions.captureInsertion())
}

function sameSession(left: AcpSessionSnapshot, right: AcpSessionSnapshot): boolean {
  return left.provider === right.provider && left.sessionId === right.sessionId
}

function mergeSnapshots(current: AcpSessionSnapshot[] | undefined, incoming: AcpSessionSnapshot[]): AcpSessionSnapshot[] {
  return incoming.map((snapshot) => {
    const previous = current?.find(candidate => sameSession(candidate, snapshot))
    return previous !== undefined && previous.revision > snapshot.revision ? previous : snapshot
  })
}

function isNativeOption(option: AcpSessionSnapshot['configOptions'][number]): boolean {
  return option.id === 'model' || option.id === 'thought_level'
    || option.category === 'model' || option.category === 'thought_level'
}

function ConfigOptions({
  option,
  disabled,
  pending,
  turnPending,
  onChange,
  t,
}: {
  option: AcpSessionSnapshot['configOptions'][number]
  disabled: boolean
  pending: boolean
  turnPending: boolean
  onChange: (value: string) => void
  t: Translate
}) {
  const options = option.options.flatMap((choice) => isConfigGroup(choice) ? choice.options : [choice])
  const current = options.find(value => value.value === option.currentValue)
  const hasCurrent = current !== undefined

  return (
    <label className="dsh-acp-session-control__field">
      <span>{option.name}{turnPending ? ` · ${t('session.nextTurn')}` : ''}</span>
      {option.description && <small>{option.description}</small>}
      <select
        aria-label={option.name}
        value={option.currentValue}
        disabled={disabled || pending}
        onChange={event => onChange(event.currentTarget.value)}
      >
        {!hasCurrent && <option value={option.currentValue}>{option.currentValue}</option>}
        {option.options.map((choice) => isConfigGroup(choice)
          ? <optgroup key={choice.group} label={choice.name || choice.group}>
              {choice.options.map(value => <option key={value.value} value={value.value}>{value.name}</option>)}
            </optgroup>
          : <option key={choice.value} value={choice.value}>{choice.name}</option>)}
      </select>
      {pending && <small aria-live="polite">{t('session.saving')}</small>}
    </label>
  )
}

/** ACP controls scoped to the owning DSH session; command buttons only edit its composer. */
export function SessionControlPanel({ sessionId, input, inputActions, control, t }: SessionControlPanelProps) {
  const [snapshots, setSnapshots] = useState<AcpSessionSnapshot[] | undefined>()
  const [unavailable, setUnavailable] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const requestId = useRef(0)
  const requestInFlight = useRef(false)
  const currentSessionId = useRef(sessionId)
  currentSessionId.current = sessionId

  const loadSnapshots = useCallback(async () => {
    if (sessionId !== currentSessionId.current || requestInFlight.current)
      return
    requestInFlight.current = true
    const request = ++requestId.current
    try {
      const result = await control.getSessionSnapshots({ dshSessionId: sessionId })
      if (request !== requestId.current || sessionId !== currentSessionId.current)
        return
      if (!result.ok) {
        setUnavailable(true)
        return
      }
      setUnavailable(false)
      setSnapshots(current => sessionId === currentSessionId.current ? mergeSnapshots(current, result.value) : current)
    }
    catch {
      if (request === requestId.current && sessionId === currentSessionId.current)
        setUnavailable(true)
    }
    finally {
      requestInFlight.current = false
    }
  }, [control, sessionId])

  useEffect(() => {
    requestId.current++
    setSnapshots(undefined)
    setUnavailable(false)
    setNotice(undefined)
    setPending(new Set())
    void loadSnapshots()
    const timer = setInterval(() => { void loadSnapshots() }, 1_000)
    return () => {
      clearInterval(timer)
      requestId.current++
    }
  }, [loadSnapshots])

  const changeSnapshot = useCallback((targetSessionId: string, updated: AcpSessionSnapshot) => {
    if (targetSessionId !== currentSessionId.current || updated.sessionId !== targetSessionId)
      return
    setSnapshots(current => {
      if (current === undefined || targetSessionId !== currentSessionId.current)
        return current
      const existing = current.find(snapshot => sameSession(snapshot, updated))
      if (existing === undefined || existing.revision > updated.revision)
        return current
      return current.map(snapshot => sameSession(snapshot, updated) ? updated : snapshot)
    })
  }, [])

  const runUpdate = useCallback(async (
    key: string,
    action: () => ReturnType<AcpSessionControlClient['setSessionConfig']>,
  ) => {
    if (sessionId !== currentSessionId.current)
      return
    const targetSessionId = sessionId
    setPending(current => new Set(current).add(key))
    setNotice(undefined)
    try {
      const result = await action()
      if (targetSessionId !== currentSessionId.current)
        return
      if (!result.ok) {
        setNotice('session.updateFailed')
        await loadSnapshots()
        return
      }
      changeSnapshot(targetSessionId, result.value)
    }
    catch {
      if (targetSessionId !== currentSessionId.current)
        return
      setNotice('session.updateFailed')
      await loadSnapshots()
    }
    finally {
      setPending(current => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }, [changeSnapshot, loadSnapshots, sessionId])

  const insertCommand = useCallback((name: string) => {
    if (sessionId !== currentSessionId.current)
      return
    const inserted = insertSessionCommand(inputActions, name)
    setNotice(inserted ? 'session.commandInserted' : 'session.inputChanged')
  }, [inputActions, sessionId])

  const resetUnknown = useCallback(async (snapshot: AcpSessionSnapshot) => {
    if (snapshot.sessionId !== sessionId || sessionId !== currentSessionId.current)
      return
    requestId.current++
    const targetSessionId = sessionId
    const key = `reset:${snapshot.provider}:${snapshot.sessionId}`
    setPending(current => new Set(current).add(key))
    setNotice(undefined)
    try {
      const result = await control.resetSession({ provider: snapshot.provider, sessionId: snapshot.sessionId })
      if (targetSessionId !== currentSessionId.current)
        return
      if (!result.ok) {
        setNotice('session.resetFailed')
        return
      }
      await loadSnapshots()
    }
    catch {
      if (targetSessionId === currentSessionId.current)
        setNotice('session.resetFailed')
    }
    finally {
      setPending(current => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }, [control, loadSnapshots, sessionId])

  if (unavailable && (snapshots === undefined || snapshots.length === 0)) {
    return (
      <section className="dsh-acp-session-control" aria-label={t('session.title')}>
        <p role="status">{t('session.unavailable')}</p>
        <button type="button" onClick={() => void loadSnapshots()}>{t('session.retry')}</button>
      </section>
    )
  }

  if (snapshots === undefined || snapshots.length === 0)
    return null

  return (
    <section className="dsh-acp-session-control" aria-label={t('session.title')}>
      {unavailable && <p role="status">{t('session.unavailable')} <button type="button" onClick={() => void loadSnapshots()}>{t('session.retry')}</button></p>}
      {snapshots.map(snapshot => {
        const unknown = snapshot.turnState === 'unknown'
        const turnPending = snapshot.turnState === 'running'
        const nativeOptions = snapshot.configOptions.filter(isNativeOption)
        const editableOptions = snapshot.configOptions.filter(option => !isNativeOption(option))
        const hasConfigMode = editableOptions.some(option => option.category === 'mode')
        const resetKey = `reset:${snapshot.provider}:${snapshot.sessionId}`

        return (
          <div key={`${snapshot.provider}:${snapshot.sessionId}`} className="dsh-acp-session-control__session">
            <h3>{t('session.title')} · {snapshot.provider}</h3>

            {nativeOptions.length > 0 && (
              <div className="dsh-acp-session-control__native" aria-label={t('session.nativeSettings')}>
                {nativeOptions.map(option => (
                  <span key={option.id}>
                    <strong>{option.id === 'model' || option.category === 'model' ? t('session.nativeModel') : t('session.nativeThoughtLevel')}:</strong> {option.currentValue}
                  </span>
                ))}
              </div>
            )}

            {unknown ? (
              <div className="dsh-acp-session-control__unknown" role="alert">
                <p>{t('session.unknownTitle')}</p>
                <p>{t('session.unknownDescription')}</p>
                <button
                  type="button"
                  disabled={pending.has(resetKey)}
                  onClick={() => void resetUnknown(snapshot)}
                >
                  {t('session.newContext')}
                </button>
              </div>
            ) : (
              <>
                <div className="dsh-acp-session-control__settings">
                  {editableOptions.map(option => {
                    const key = `config:${snapshot.provider}:${snapshot.sessionId}:${option.id}`
                    return (
                      <ConfigOptions
                        key={option.id}
                        option={option}
                        disabled={unknown}
                        pending={pending.has(key)}
                        turnPending={turnPending}
                        onChange={value => void runUpdate(key, () => control.setSessionConfig({
                          provider: snapshot.provider,
                          sessionId: snapshot.sessionId,
                          configId: option.id,
                          value,
                          expectedRevision: snapshot.revision,
                        }))}
                        t={t}
                      />
                    )
                  })}

                  {!hasConfigMode && snapshot.availableModes.length > 0 && (
                    <label className="dsh-acp-session-control__field">
                      <span>{t('session.mode')}{turnPending ? ` · ${t('session.nextTurn')}` : ''}</span>
                      <select
                        aria-label={t('session.mode')}
                        value={snapshot.currentModeId ?? ''}
                        disabled={pending.has(`mode:${snapshot.provider}:${snapshot.sessionId}`)}
                        onChange={event => {
                          const modeId = event.currentTarget.value
                          if (!modeId) return
                          const key = `mode:${snapshot.provider}:${snapshot.sessionId}`
                          void runUpdate(key, () => control.setSessionMode({
                            provider: snapshot.provider,
                            sessionId: snapshot.sessionId,
                            modeId,
                            expectedRevision: snapshot.revision,
                          }))
                        }}
                      >
                        {!snapshot.currentModeId && <option value="" disabled>{t('session.mode')}</option>}
                        {snapshot.availableModes.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>

                <div className="dsh-acp-session-control__commands">
                  <strong>{t('session.commands')}</strong>
                  {snapshot.availableCommands.length === 0
                    ? <span>{t('session.noCommands')}</span>
                    : snapshot.availableCommands.map(command => (
                        <button
                          key={command.name}
                          type="button"
                          disabled={input.phase === 'adjudicating' || input.phase === 'submitting'}
                          aria-label={t('session.insertCommand').replace('{name}', command.name)}
                          title={command.description || command.inputHint}
                          onClick={() => insertCommand(command.name)}
                        >
                          {`/${command.name}`}
                        </button>
                      ))}
                </div>
              </>
            )}

            {notice && <p className="dsh-acp-session-control__notice" role="status">{t(notice as Parameters<Translate>[0])}</p>}
          </div>
        )
      })}
    </section>
  )
}
