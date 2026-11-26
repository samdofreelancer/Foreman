export const boardStyles = `
.foreman-board { min-width: 0; }
.foreman-toolbar { display:flex; gap:12px; align-items:flex-end; margin-bottom:16px; }
.foreman-toolbar label { display:flex; flex-direction:column; gap:4px; }
.foreman-toolbar input,.foreman-toolbar select { min-height:32px; }
.foreman-primary { height:32px; }
.foreman-columns { display:flex; gap:12px; overflow-x:auto; min-height:360px; padding-bottom:8px; }
.foreman-column { flex:0 0 280px; min-width:280px; border:1px solid var(--border); border-radius:8px; padding:10px; }
.foreman-column-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.foreman-count { min-width:24px; text-align:center; border-radius:12px; background:var(--surface-raised); padding:2px 6px; }
.foreman-card-list { display:flex; flex-direction:column; gap:8px; }
.foreman-card { border:1px solid var(--border); border-radius:6px; padding:10px; min-width:0; }
.foreman-card h3 { margin:0 0 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.foreman-card-meta { display:flex; flex-direction:column; gap:3px; color:var(--text-muted); font-size:12px; }
.foreman-empty { border:1px dashed var(--border); border-radius:6px; padding:24px 10px; text-align:center; color:var(--text-muted); }
.foreman-card { cursor:pointer; }
.foreman-dialog { display:flex; flex-direction:column; gap:12px; min-width:min(520px, calc(100vw - 40px)); }
.foreman-dialog label { display:flex; flex-direction:column; gap:4px; }
.foreman-dialog input,.foreman-dialog textarea,.foreman-dialog select { min-height:32px; }
.foreman-dialog small { color:var(--danger); }
.foreman-model-fields { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.foreman-dialog-actions { display:flex; justify-content:flex-end; gap:8px; }
.foreman-show-more { min-height:32px; }
.foreman-warning { display:flex; justify-content:space-between; gap:12px; margin-bottom:12px; border:1px solid var(--border); border-radius:6px; padding:8px; }
.foreman-project-missing { color:var(--danger); }
@media (max-width: 700px) { .foreman-toolbar { flex-wrap:wrap; } .foreman-column { flex-basis:260px; min-width:260px; } }
`
