/** Converts a tree of Notion blocks to HTML. */

export const esc = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const safeUrl = (url) => {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol) ? url : '#';
  } catch {
    return '#';
  }
};

const plain = (segments = []) => segments.map((s) => s.plain_text || '').join('').trim();

/** Notion-hosted images and files (their links expire, so the sync downloads them). */
export function collectAssetBlocks(blocks, out = []) {
  for (const block of blocks) {
    const data = block[block.type] || {};
    if (['image', 'file', 'pdf'].includes(block.type) && data.type === 'file' && data.file?.url) {
      out.push({ id: block.id, url: data.file.url, hint: block.type === 'image' ? 'image' : data.name || 'file' });
    }
    if (block.children) collectAssetBlocks(block.children, out);
  }
  return out;
}

export class Renderer {
  /**
   * @param {{assets: Map<string,string|null>, pageHref: (key:string)=>string|null, pageTitle: (key:string)=>string|null}} ctx
   */
  constructor(ctx) {
    this.assets = ctx.assets;
    this.pageHref = ctx.pageHref;
    this.pageTitle = ctx.pageTitle;
  }

  render(blocks = []) {
    let out = '';
    let i = 0;
    while (i < blocks.length) {
      const type = blocks[i].type;
      if (['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(type)) {
        const tag = type === 'numbered_list_item' ? 'ol' : 'ul';
        out += `<${tag}${type === 'to_do' ? ' class="todo"' : ''}>`;
        while (i < blocks.length && blocks[i].type === type) out += this.listItem(blocks[i++]);
        out += `</${tag}>`;
        continue;
      }
      out += this.block(blocks[i++]);
    }
    return out;
  }

  kids(block) {
    return block.children?.length ? this.render(block.children) : '';
  }

  listItem(block) {
    const data = block[block.type] || {};
    const box = block.type === 'to_do' ? `<input type="checkbox" disabled${data.checked ? ' checked' : ''}> ` : '';
    return `<li>${box}${this.rich(data.rich_text)}${this.kids(block)}</li>`;
  }

  block(block) {
    const type = block.type;
    const d = block[type] || {};

    switch (type) {
      case 'paragraph': {
        const html = this.rich(d.rich_text);
        const kids = this.kids(block);
        return html === '' && kids === '' ? '' : `<p>${html}</p>${kids}`;
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        // The page title is the h1, so Notion heading 1 becomes h2, and so on.
        const tag = `h${Number(type.slice(-1)) + 1}`;
        const heading = `<${tag}>${this.rich(d.rich_text)}</${tag}>`;
        const kids = this.kids(block);
        return kids && d.is_toggleable ? `<details><summary>${heading}</summary>${kids}</details>` : heading + kids;
      }
      case 'quote':
        return `<blockquote>${this.rich(d.rich_text)}${this.kids(block)}</blockquote>`;
      case 'callout': {
        const icon = d.icon?.type === 'emoji' ? esc(d.icon.emoji) : '';
        return `<aside class="callout"><span class="callout-icon">${icon}</span><div>${this.rich(d.rich_text)}${this.kids(block)}</div></aside>`;
      }
      case 'toggle':
        return `<details><summary>${this.rich(d.rich_text)}</summary>${this.kids(block)}</details>`;
      case 'code': {
        const code = (d.rich_text || []).map((t) => t.plain_text || '').join('');
        const lang = String(d.language || '').replace(/[^a-z0-9+#-]/gi, '');
        const caption = this.rich(d.caption);
        return `<pre><code class="language-${esc(lang)}">${esc(code)}</code></pre>${caption ? `<p class="caption">${caption}</p>` : ''}`;
      }
      case 'divider':
        return '<hr>';
      case 'equation':
        return `<div class="eq">${esc(d.expression)}</div>`;
      case 'image':
        return this.image(block, d);
      case 'file':
      case 'pdf':
        return this.fileBlock(block, d);
      case 'video':
      case 'audio':
      case 'embed':
      case 'bookmark':
      case 'link_preview':
        return this.linkBlock(type, d);
      case 'table':
        return this.table(block, d);
      case 'column_list':
        return `<div class="cols">${this.kids(block)}</div>`;
      case 'column':
        return `<div class="col">${this.kids(block)}</div>`;
      case 'child_page': {
        const href = this.pageHref(String(block.id).replace(/-/g, '').toLowerCase());
        const title = esc(d.title || 'Untitled');
        return href ? `<p class="subpage"><a href="${esc(href)}">${title}</a></p>` : `<p class="subpage">${title}</p>`;
      }
      case 'child_database':
        return `<p class="note">The database &ldquo;${esc(d.title || 'Untitled')}&rdquo; is not exported yet.</p>`;
      case 'link_to_page': {
        if (!d.page_id) return '';
        const key = String(d.page_id).replace(/-/g, '').toLowerCase();
        const href = this.pageHref(key);
        const title = this.pageTitle(key);
        return href && title ? `<p class="subpage"><a href="${esc(href)}">${esc(title)}</a></p>` : '';
      }
      case 'synced_block':
        return this.kids(block);
      case 'table_of_contents':
      case 'breadcrumb':
      case 'unsupported':
        return '';
      default:
        return `<!-- unsupported block: ${esc(type)} -->`;
    }
  }

  image(block, d) {
    const notionHosted = d.type === 'file';
    const src = notionHosted ? this.assets.get(block.id) : safeUrl(d.external?.url || '');
    if (!src || src === '#') return '<p class="note">An image could not be exported.</p>';
    const caption = this.rich(d.caption);
    return `<figure><img src="${esc(src)}" alt="${esc(plain(d.caption))}" loading="lazy">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  }

  fileBlock(block, d) {
    const name = d.name || plain(d.caption) || 'Download file';
    const href = d.type === 'file' ? this.assets.get(block.id) : safeUrl(d.external?.url || '');
    if (!href || href === '#') return `<p class="note">The file &ldquo;${esc(name)}&rdquo; could not be exported.</p>`;
    return `<p class="file"><a href="${esc(href)}">${esc(name)}</a></p>`;
  }

  linkBlock(type, d) {
    if (['video', 'audio'].includes(type) && d.type === 'file') return `<p class="note">A ${type} file hosted in Notion is not exported.</p>`;
    const url = d.url || d.external?.url || '';
    if (!url) return '';
    return `<p class="link"><a href="${esc(safeUrl(url))}" rel="noopener noreferrer">${esc(plain(d.caption) || url)}</a></p>`;
  }

  table(block, d) {
    const rows = (block.children || []).map((row, r) => {
      const cells = (row.table_row?.cells || []).map((cell, c) => {
        const tag = (d.has_column_header && r === 0) || (d.has_row_header && c === 0) ? 'th' : 'td';
        return `<${tag}>${this.rich(cell)}</${tag}>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    return `<div class="table-wrap"><table>${rows.join('')}</table></div>`;
  }

  rich(segments = []) {
    return segments
      .map((s) => {
        let text = s.type === 'equation'
          ? `<code class="eq">${esc(s.equation?.expression)}</code>`
          : esc(s.plain_text).replace(/\n/g, '<br>');
        const a = s.annotations || {};
        if (a.code) text = `<code>${text}</code>`;
        if (a.bold) text = `<strong>${text}</strong>`;
        if (a.italic) text = `<em>${text}</em>`;
        if (a.strikethrough) text = `<s>${text}</s>`;
        if (a.underline) text = `<u>${text}</u>`;
        const href = s.href ?? s.text?.link?.url;
        if (href) text = `<a href="${esc(this.resolveHref(href))}" rel="noopener noreferrer">${text}</a>`;
        return text;
      })
      .join('');
  }

  /** Links to other exported pages become relative links; everything else stays as it is. */
  resolveHref(href) {
    const looksLikeNotion = href.startsWith('/') || href.includes('notion.so');
    const m = looksLikeNotion && href.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i);
    if (m) {
      const local = this.pageHref(m[1].replace(/-/g, '').toLowerCase());
      if (local) return local;
    }
    return href.startsWith('/') ? `https://www.notion.so${href}` : safeUrl(href);
  }
}
