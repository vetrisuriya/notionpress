import { esc } from './render.js';

export function pageHtml({ title, icon, breadcrumb, body, cssHref }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="${esc(cssHref)}"></head><body><main>${breadcrumb ? `<nav class="crumbs">${breadcrumb}</nav>` : ''}<h1>${icon ? esc(icon) + ' ' : ''}${esc(title)}</h1>${body}</main></body></html>
`;
}

export const CSS = `:root{--ink:#1d2733;--muted:#5d6b78;--paper:#ffffff;--tint:#f2f5f7;--rule:#d9e0e6;--link:#1f6f5c}
@media (prefers-color-scheme:dark){:root{--ink:#e4e9ed;--muted:#9aa7b2;--paper:#161b20;--tint:#1e252b;--rule:#2f3942;--link:#6fc7ad}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:18px/1.7 Charter,"Iowan Old Style",Georgia,serif}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
h1,h2,h3,h4,.crumbs,figcaption,.caption,.note,summary{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:2.1rem;line-height:1.2;margin:.4rem 0 1.5rem}
h2{font-size:1.5rem;margin:2.2rem 0 .6rem}h3{font-size:1.25rem;margin:1.8rem 0 .5rem}h4{font-size:1.05rem;margin:1.5rem 0 .4rem}
a{color:var(--link)}
.crumbs{font-size:.85rem;color:var(--muted)}.crumbs a{color:var(--muted)}
blockquote{margin:1.2rem 0;padding:.1rem 1rem;border-left:3px solid var(--rule);color:var(--muted)}
pre{background:var(--tint);padding:1rem;overflow-x:auto;border-radius:6px;font-size:.85rem;line-height:1.5}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}
p code,li code{background:var(--tint);padding:.1em .35em;border-radius:4px}
hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
img{max-width:100%;height:auto;border-radius:4px}
figure{margin:1.5rem 0}figcaption,.caption{font-size:.85rem;color:var(--muted);margin-top:.4rem}
.callout{display:flex;gap:.75rem;background:var(--tint);padding:1rem;border-radius:6px;margin:1.2rem 0}
.callout-icon{font-size:1.2rem}
.table-wrap{overflow-x:auto;margin:1.2rem 0}
table{border-collapse:collapse;min-width:100%;font-family:system-ui,sans-serif;font-size:.92rem}
td,th{border:1px solid var(--rule);padding:.45rem .7rem;text-align:left;vertical-align:top}th{background:var(--tint)}
details{margin:.8rem 0}summary{cursor:pointer}
.cols{display:flex;gap:1.5rem;flex-wrap:wrap}.col{flex:1 1 14rem;min-width:0}
.todo{list-style:none;padding-left:.2rem}
.subpage{margin:.4rem 0;font-family:system-ui,sans-serif}
.note{color:var(--muted);font-size:.9rem}
.eq{font-family:ui-monospace,monospace;text-align:center;margin:1rem 0}
`;
