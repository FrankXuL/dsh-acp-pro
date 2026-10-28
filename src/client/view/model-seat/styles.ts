/** Stylesheet for the composer model picker, keyed to the shell's `--dsw-*` design tokens. */
export const MODEL_SEAT_CSS = `
.dsh-model-seat{display:inline-flex;position:relative}
.dsh-model-seat-trigger{display:inline-flex;align-items:center;gap:5px;height:28px;background:none;border:none;border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-primary,#eee);cursor:pointer;font:inherit;font-size:13px;padding:0 4px 0 8px;max-width:100%}
.dsh-model-seat-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-model-seat-trigger:disabled{color:var(--dsw-alias-label-dimmed,#777);cursor:default}
/* Card geometry mirrors the native model menu (ui-model-selection ModelSelect.module.css .menu). */
.dsh-model-seat-panel{box-sizing:border-box;position:fixed;z-index:1100;transition:none;will-change:left,bottom;contain:layout paint;display:flex;gap:2px;width:340px;height:360px;max-width:calc(100vw - 32px);max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border:0;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill,#232323);backdrop-filter:var(--dsw-menu-backdrop-filter,none);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,#3a3a3a);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.45));color:var(--dsw-alias-label-primary,#eee);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#555);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#777)}
.dsh-model-seat-panel[data-pane=root]{width:min(240px,calc(100vw - 32px));height:auto}
.dsh-model-seat-panel[data-pane=efforts]{width:min(240px,calc(100vw - 32px));height:auto;max-height:min(360px,calc(100vh - 96px))}
.dsh-model-seat-root{display:flex;flex-direction:column;gap:0;min-width:min(240px,calc(100vw - 32px));padding:2px 0}
.dsh-model-seat-rail{display:flex;flex-direction:column;align-items:center;gap:2px;width:32px;flex:none;padding:2px 0;overflow-y:auto}
.dsh-model-seat-rail-btn{width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;font:inherit}
.dsh-model-seat-rail-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}
.dsh-model-seat-rail-btn[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#fff)}
.dsh-model-seat-rail-btn[data-fav=true][data-active=true]{color:var(--dsw-alias-state-warning-primary,#f5c542)}
.dsh-model-seat-rail-glyph{font-size:12px;font-weight:600;line-height:1}
.dsh-model-seat-trigger-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-model-seat-brand{display:block;width:16px;height:16px;background:currentColor;mask-position:center;mask-repeat:no-repeat;mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:contain}
.dsh-model-seat-brand-img{display:block;width:16px;height:16px;object-fit:contain}
.dsh-model-seat-divider{width:16px;height:1px;flex:none;background:var(--dsw-alias-border-l2,#333);margin:2px 0}
.dsh-model-seat-body{flex:1;min-width:180px;max-width:340px;min-height:0;display:flex;flex-direction:column}
.dsh-model-seat-search{box-sizing:border-box;flex:none;width:100%;height:auto;margin:2px 0 3px;padding:5px 7px;border:0 solid transparent;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;font-size:12px;outline:none}
.dsh-model-seat-search::placeholder{color:var(--dsw-alias-label-caption,#8a8a8a)}
.dsh-model-seat-list{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow-y:auto}
.dsh-model-seat-group{position:sticky;top:0;z-index:1;padding:4px 7px 2px;background:var(--dsw-alias-menu-group-header-fill,rgba(48,49,54,.94));color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;line-height:16px;font-weight:500}
.dsh-model-seat-row{display:flex;align-items:center;gap:2px;min-width:100%}
.dsh-model-seat-model{box-sizing:border-box;flex:1;min-width:0;display:flex;align-items:center;gap:6px;min-height:34px;padding:5px 7px;border:none;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:left;outline:none}
.dsh-model-seat-model:hover,.dsh-model-seat-model:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-model-seat-model:disabled{color:var(--dsw-alias-label-dimmed,#777);cursor:default}
.dsh-model-seat-model-name{flex:1;min-width:0;overflow:hidden;color:inherit;font-size:13px;line-height:18px;font-weight:400;text-overflow:ellipsis;white-space:nowrap}
.dsh-model-seat-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary,#eee);font-size:13px}
.dsh-model-seat-star{flex:none;width:24px;height:24px;display:grid;place-items:center;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);cursor:pointer;font-size:13px;opacity:0}
.dsh-model-seat-row:hover .dsh-model-seat-star,.dsh-model-seat-star[data-on=true],.dsh-model-seat-star:focus-visible{opacity:1}
.dsh-model-seat-star:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}
.dsh-model-seat-star[data-on=true]{color:var(--dsw-alias-state-warning-primary,#f5c542)}
/* Root cells mirror .cell: 34px high, 0 8px padding, 13/20 text. */
.dsh-model-seat-cell{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:auto;min-width:100%;height:34px;padding:0 8px;border:none;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left;outline:none}
.dsh-model-seat-cell:hover,.dsh-model-seat-cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-model-seat-cell-label{flex:0 0 auto;white-space:nowrap}
.dsh-model-seat-cell-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsh-model-seat-cell-chevron{flex:0 0 auto;width:12px;height:12px;color:var(--dsw-alias-menu-icon,#8a8a8a)}
.dsh-model-seat-hint{padding:8px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;line-height:18px}
.dsh-model-seat-error{padding:6px 7px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(255,80,80,.14));color:var(--dsw-alias-state-error-primary,#f66);font-size:11px;line-height:16px}
.dsh-model-seat-rail-slot{display:contents}
`
