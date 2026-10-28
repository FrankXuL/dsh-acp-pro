export const SESSION_CONTROL_CSS = `
.dsh-acp-session-control {
  display: grid;
  gap: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
.dsh-acp-session-control__session {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-acp-session-control h3,
.dsh-acp-session-control p {
  margin: 0;
}
.dsh-acp-session-control h3 {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
}
.dsh-acp-session-control__native,
.dsh-acp-session-control__settings,
.dsh-acp-session-control__commands {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dsh-acp-session-control__native {
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-session-control__field {
  display: grid;
  min-width: 140px;
  gap: 4px;
}
.dsh-acp-session-control__field small,
.dsh-acp-session-control__commands > span {
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-session-control select,
.dsh-acp-session-control button {
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
}
.dsh-acp-session-control button {
  cursor: pointer;
}
.dsh-acp-session-control button:disabled,
.dsh-acp-session-control select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.dsh-acp-session-control button:focus-visible,
.dsh-acp-session-control select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-success-primary);
  outline-offset: 2px;
}
.dsh-acp-session-control__commands {
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-acp-session-control__unknown {
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-tsp-secondary);
}
.dsh-acp-session-control__notice {
  color: var(--dsw-alias-state-error-primary);
}
`
