export const boardStyles = `
.foreman-board { min-width:0; width:100%; }
.foreman-toolbar { display:grid; grid-template-columns:auto minmax(150px,220px) minmax(180px,1fr); align-items:end; gap:10px; margin:18px 0 14px; }
.foreman-toolbar label { display:flex; flex-direction:column; gap:6px; min-width:0; }
.foreman-toolbar label > span { color:var(--text-muted,#667085); font-size:12px; font-weight:600; }
.foreman-toolbar input,.foreman-toolbar select { width:100%; height:36px; box-sizing:border-box; border:1px solid var(--border,#dfe3ea); border-radius:8px; background:var(--surface,#fff); color:inherit; padding:0 10px; outline:none; }
.foreman-toolbar input:focus,.foreman-toolbar select:focus { border-color:var(--accent,#4f46e5); box-shadow:0 0 0 3px var(--accent-ring,rgba(79,70,229,.12)); }
.foreman-primary { height:36px; border:1px solid var(--accent,#4f46e5); border-radius:8px; background:var(--accent,#4f46e5); color:#fff; font-weight:600; padding:0 12px; cursor:pointer; }
.foreman-primary:hover { filter:brightness(.96); }
.foreman-primary:disabled { cursor:not-allowed; opacity:.45; }
.foreman-columns { display:grid; grid-template-columns:repeat(4,minmax(180px,1fr)); gap:10px; overflow-x:auto; min-height:420px; padding:0 2px 12px; align-items:start; }
.foreman-column { min-width:180px; height:420px; box-sizing:border-box; border:1px solid var(--border,#e4e7ec); border-radius:10px; background:var(--surface-subtle,#f8fafc); padding:8px; overflow-y:auto; }
.foreman-column-header { position:sticky; top:-8px; z-index:1; display:flex; align-items:center; justify-content:space-between; height:40px; box-sizing:border-box; margin:-8px -8px 8px; padding:8px 10px; border-bottom:1px solid var(--border,#e4e7ec); border-radius:9px 9px 0 0; background:var(--surface-subtle,#f8fafc); }
.foreman-column-header strong { font-size:13px; }
.foreman-count { min-width:22px; height:22px; display:grid; place-items:center; border:1px solid var(--border,#e4e7ec); border-radius:999px; background:var(--surface,#fff); color:var(--text-muted,#667085); font-size:12px; }
.foreman-card-list { display:flex; flex-direction:column; gap:8px; }
.foreman-card { border:1px solid var(--border,#e4e7ec); border-radius:8px; background:var(--surface,#fff); box-shadow:0 1px 2px rgba(16,24,40,.04); padding:11px; min-width:0; cursor:pointer; transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease; }
.foreman-card:hover { border-color:var(--accent,#4f46e5); box-shadow:0 4px 12px rgba(16,24,40,.08); transform:translateY(-1px); }
.foreman-card h3 { margin:0 0 9px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:1.35; }
.foreman-card-meta { display:flex; flex-direction:column; gap:4px; color:var(--text-muted,#667085); font-size:11px; }
.foreman-column-name { text-transform:capitalize; }
.foreman-empty { min-height:110px; display:grid; place-items:center; border:1px dashed var(--border,#dfe3ea); border-radius:8px; color:var(--text-muted,#667085); font-size:12px; background:var(--surface,#fff); }
.foreman-dialog { display:flex; flex-direction:column; gap:12px; width:100%; box-sizing:border-box; }
.foreman-dialog h2 { margin:0 0 2px; font-size:18px; }
.foreman-dialog label { display:flex; flex-direction:column; gap:6px; }
.foreman-dialog label > span { font-size:12px; font-weight:600; }
.foreman-dialog input,.foreman-dialog textarea,.foreman-dialog select { width:100%; box-sizing:border-box; border:1px solid var(--border,#dfe3ea); border-radius:8px; background:var(--surface,#fff); color:inherit; padding:8px 10px; }
.foreman-dialog input,.foreman-dialog select { height:36px; }
.foreman-dialog textarea { resize:vertical; }
.foreman-dialog small { color:var(--danger,#d92d20); font-size:12px; }
.foreman-model-fields { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.foreman-project-mode { align-self:flex-start; border:0; background:transparent; color:var(--accent,#4f46e5); padding:0; font-size:12px; cursor:pointer; }
.foreman-dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
.foreman-dialog-actions button { height:36px; border:1px solid var(--border,#dfe3ea); border-radius:8px; background:var(--surface,#fff); color:inherit; padding:0 12px; cursor:pointer; }
.foreman-dialog-actions .foreman-primary { border-color:var(--accent,#4f46e5); background:var(--accent,#4f46e5); color:#fff; }
.foreman-show-more { min-height:32px; border:1px solid var(--border,#dfe3ea); border-radius:8px; background:var(--surface,#fff); color:inherit; }
.foreman-warning { display:flex; justify-content:space-between; gap:12px; margin-bottom:12px; border:1px solid var(--border,#dfe3ea); border-radius:8px; padding:10px; }
.foreman-project-missing { color:var(--danger,#d92d20); }
.foreman-run-state { width:max-content; border-radius:999px; padding:2px 7px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
.foreman-run-working { background:rgba(37,99,235,.12); color:#2563eb; }
.foreman-run-unread { background:rgba(245,158,11,.16); color:#b45309; }
.foreman-run-reviewed { background:rgba(16,185,129,.12); color:#047857; }
.foreman-run-missing,.foreman-run-disconnected { background:rgba(107,114,128,.12); color:#4b5563; }
.foreman-follow-up { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; margin-top:4px; }
.foreman-follow-up input { min-width:0; height:32px; box-sizing:border-box; border:1px solid var(--border,#dfe3ea); border-radius:7px; background:var(--surface,#fff); color:inherit; padding:0 8px; }
.foreman-follow-up button { height:32px; border:1px solid var(--accent,#4f46e5); border-radius:7px; background:var(--accent,#4f46e5); color:#fff; padding:0 9px; }
.foreman-follow-up button:disabled { opacity:.45; }
.foreman-follow-up-error { grid-column:1/-1; color:var(--danger,#d92d20); font-size:11px; }
.foreman-column-hovered { border-color:var(--accent,#4f46e5); box-shadow:0 0 0 3px var(--accent-ring,rgba(79,70,229,.12)); }
@media (max-width:900px) { .foreman-columns { grid-template-columns:repeat(4,220px); } }
@media (max-width:700px) { .foreman-toolbar { grid-template-columns:1fr 1fr; } .foreman-toolbar .foreman-primary { grid-column:1/-1; width:max-content; } }
`
