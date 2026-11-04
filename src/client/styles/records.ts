/**
 * ACP execution record styles. The Web shell ships no utility CSS to third-party bundles,
 * so the plugin carries its own sheet keyed to the shell's `--dsw-*` design tokens.
 */
export const RECORDS_CSS = `
.dap-rec{margin:2px 0;border-radius:var(--dsw-radius-md,8px);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);border:.5px solid var(--dsw-alias-border-l2);overflow:hidden}
.dap-rec-head{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:5px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dap-rec-head:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.dap-rec-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dap-rec-title{flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dap-rec-summary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dap-rec-summary-with-preview{flex:none;max-width:28%}
.dap-rec-input-preview{display:inline-flex;flex:1;align-items:center;gap:6px;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dap-rec-input-preview-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dap-rec-preview-truncated{flex:none;font-family:inherit;font-size:11px;white-space:nowrap}
.dap-rec-meta{flex:none;display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dap-rec-duration{font-variant-numeric:tabular-nums}
.dap-rec-status[role=alert]{color:var(--dsw-alias-state-error-primary);font-weight:500}
.dap-rec-status[role=status]{color:var(--dsw-alias-state-warn-label)}
.dap-rec-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.dap-rec[data-status=in_progress] .dap-rec-dot{background:var(--dsw-alias-state-warn-primary);animation:dap-pulse 1.2s ease-in-out infinite}
.dap-rec[data-status=completed] .dap-rec-dot{background:var(--dsw-alias-state-success-primary)}
.dap-rec[data-status=failed] .dap-rec-dot{background:var(--dsw-alias-state-error-primary)}
.dap-rec[data-status=failed] .dap-rec-title{color:var(--dsw-alias-state-error-primary)}
/* A by-name MCP skip reaches us through the failure channel; it must not inherit error colour. */
.dap-rec[data-status=skipped] .dap-rec-dot{background:var(--dsw-alias-state-idle-primary)}
.dap-rec[data-status=skipped] .dap-rec-title{color:var(--dsw-alias-label-primary)}
@keyframes dap-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dap-rec-body{display:flex;flex-direction:column;gap:8px;padding:2px 10px 10px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dap-pre{box-sizing:border-box;max-width:100%;max-height:320px;overflow:auto;margin:6px 0 0;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.dap-field{display:flex;flex-direction:column;gap:2px;margin-top:6px}
.dap-field-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dap-rec-locations{display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.dap-file-path{max-width:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:left;text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--dsw-alias-label-secondary) 45%,transparent);text-underline-offset:2px;overflow-wrap:anywhere;cursor:pointer}
.dap-file-path:hover{color:var(--dsw-alias-label-primary)}
.dap-file-path:focus-visible,.dap-rec-head:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.dap-hint{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dap-diff-block{margin-top:8px}
.dap-diff-block>.dap-file-path{margin-bottom:4px}
.dap-diff{box-sizing:border-box;max-width:100%;max-height:420px;overflow:auto;margin:0;padding:6px 0;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.dap-line{display:block;padding:0 10px}
.dap-line-added{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dap-line-removed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dap-line-context{color:var(--dsw-alias-label-secondary)}
.dap-diff-fallback{display:flex;flex-direction:column}
.dap-plan{margin:4px 0;padding:8px 12px;border-radius:var(--dsw-radius-md,8px);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);border:.5px solid var(--dsw-alias-border-l2)}
.dap-plan-head{display:flex;align-items:baseline;gap:8px}
.dap-plan-title{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dap-plan-count{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dap-plan-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:3px}
.dap-plan-item{display:flex;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dap-plan-item[data-status=in_progress]{color:var(--dsw-alias-label-primary)}
.dap-plan-item[data-status=completed]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dap-plan-item[data-status=cancelled]{color:var(--dsw-alias-label-tertiary)}
.dap-plan-mark{flex:none;width:14px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dap-permission{margin:4px 0;padding:8px 12px;border-radius:var(--dsw-radius-md,8px);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);border:.5px solid var(--dsw-alias-border-l2)}
.dap-permission[data-status=pending]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,var(--dsw-alias-border-l2))}
.dap-permission-head{display:flex;align-items:center;gap:8px;min-width:0}
.dap-permission-glyph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dap-permission[data-status=pending] .dap-permission-glyph{color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary)}
.dap-permission[data-status=allowed] .dap-permission-glyph{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary)}
.dap-permission[data-status=rejected] .dap-permission-glyph{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.dap-permission[data-status=cancelled] .dap-permission-glyph{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.dap-permission-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dap-permission-kind{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}
.dap-permission-status{flex:none;padding:1px 8px;border-radius:11px;font-size:11px;line-height:16px;font-weight:500;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-secondary)}
.dap-permission[data-status=pending] .dap-permission-status{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.dap-permission[data-status=allowed] .dap-permission-status{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.dap-permission[data-status=rejected] .dap-permission-status{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dap-permission[data-status=cancelled] .dap-permission-status{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-tertiary)}
.dap-permission-options{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.dap-permission-option{display:inline-flex;align-items:baseline;gap:6px;max-width:100%;padding:2px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform);border:.5px solid var(--dsw-alias-border-l1)}
.dap-permission-option-kind{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dap-permission-option-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}
.dap-permission-option[data-kind=allow_once] .dap-permission-option-kind,.dap-permission-option[data-kind=allow_always] .dap-permission-option-kind{color:var(--dsw-alias-state-success-primary)}
.dap-permission-option[data-kind=reject_once] .dap-permission-option-kind,.dap-permission-option[data-kind=reject_always] .dap-permission-option-kind{color:var(--dsw-alias-state-error-primary)}
.dap-permission-empty{margin-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dap-permission-hint{margin-top:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
`
