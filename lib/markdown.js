/** Converts a tree of Notion blocks to Markdown. Links to other exported pages stay relative. */

const plain = (segments = []) => segments.map((s) => s.plain_text || '').join('').trim();

const safeUrl = (url) => {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol) ? url : '';
  } catch {
    return '';
  }
};

export class MarkdownRenderer {
  /**
   * @param {{assets: Map<string,string|null>, pageHref: (key:string)=>string|null, pageTitle: (key:string)=>string|null}} ctx
   */
  constructor(ctx) {
    this.assets = ctx.assets;
    this.pageHref = ctx.pageHref;
    this.pageTitle = ctx.pageTitle;
  }

  render(blocks = [], depth = 0) {
    let out = '';
    let i = 0;
    while (i < blocks.length) {
      const type = blocks[i].type;
      if (['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(type)) {
        while (i < blocks.length && blocks[i].type === type) {
          out += this.listItem(blocks[i++], type, depth) + '\n';
        }
        out += '\n';
        continue;
      }
      out += this.block(blocks[i++], depth) + '\n\n';
    }
    return out.trim() + '\n';
  }

  kids(block, depth = 0) {
    return block.children?.length ? this.render(block.children, depth + 1) : '';
  }

  listItem(block, type, depth) {
    const data = block[block.type] || {};
    const indent = '  '.repeat(depth);
    const marker = type === 'numbered_list_item' ? '1. ' : type === 'to_do' ? `- [${data.checked ? 'x' : ' '}] ` : '- ';
    let line = `${indent}${marker}${this.inline(data.rich_text)}`;
    const children = block.children?.length ? '\n' + this.render(block.children, depth + 1).trimEnd() : '';
    return line + children;
  }

  inline(segments = []) {
    return segments
      .map((s) => {
        let text = s.type === 'equation' ? `\`${s.equation?.expression}\`` : (s.plain_text || '').replace(/\n/g, ' ');
        const a = s.annotations || {};
        if (a.code) text = `\`${text}\``;
        if (a.bold) text = `**${text}**`;
        if (a.italic) text = `*${text}*`;
        if (a.strikethrough) text = `~~${text}~~`;
        const href = s.href ?? s.text?.link?.url;
        if (href) {
          const local = this.resolveHref(href);
          text = `[${text}](${local || href})`;
        }
        return text;
      })
      .join('');
  }

  block(block, depth) {
    const type = block.type;
    const d = block[type] || {};

    switch (type) {
      case 'paragraph': {
        const text = this.inline(d.rich_text);
        const kids = this.kids(block, depth);
        return text || kids ? `${text}\n\n${kids}`.trim() : '';
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        // The page title is the h1, so Notion heading 1 becomes h2, and so on.
        const heading = `${'#'.repeat(Number(type.slice(-1)) + 1)} ${this.inline(d.rich_text)}`;
        return heading + (this.kids(block, depth) ? `\n\n${this.kids(block, depth)}` : '');
      }
      case 'quote':
        return `> ${this.inline(d.rich_text)}${this.kids(block, depth) ? '\n>\n> ' + this.kids(block, depth).replace(/\n/g, '\n> ').trimEnd() : ''}`;
      case 'callout': {
        const icon = d.icon?.type === 'emoji' ? d.icon.emoji + ' ' : '';
        return `> ${icon}${this.inline(d.rich_text)}${this.kids(block, depth) ? '\n>\n> ' + this.kids(block, depth).replace(/\n/g, '\n> ').trimEnd() : ''}`;
      }
      case 'toggle':
        return `<details><summary>${this.inline(d.rich_text)}</summary>\n\n${this.kids(block, depth)}\n\n</details>`;
      case 'code': {
        const code = (d.rich_text || []).map((t) => t.plain_text || '').join('');
        const lang = String(d.language || '').replace(/[^a-z0-9+#-]/gi, '');
        const caption = this.inline(d.caption);
        return `\`\`\`${lang}\n${code}\n\`\`\`${caption ? `\n\n*${caption}*` : ''}`;
      }
      case 'divider':
        return '---';
      case 'equation':
        return `$$${d.expression}$$`;
      case 'image': {
        const notionHosted = d.type === 'file';
        const src = notionHosted ? this.assets.get(block.id) : safeUrl(d.external?.url || '');
        if (!src) return `**An image could not be exported.**`;
        return `![${plain(d.caption)}](${src})${plain(d.caption) ? `\n\n*${plain(d.caption)}*` : ''}`;
      }
      case 'file':
      case 'pdf': {
        const name = d.name || plain(d.caption) || 'Download file';
        const href = d.type === 'file' ? this.assets.get(block.id) : safeUrl(d.external?.url || '');
        return href ? `[${name}](${href})` : `**The file "${name}" could not be exported.**`;
      }
      case 'video':
      case 'audio':
      case 'embed':
      case 'bookmark':
      case 'link_preview': {
        if (['video', 'audio'].includes(type) && d.type === 'file') return `**A ${type} file hosted in Notion is not exported.**`;
        const url = d.url || d.external?.url || '';
        const safe = safeUrl(url);
        return safe ? `[${plain(d.caption) || safe}](${safe})` : '';
      }
      case 'table':
        return this.table(block);
      case 'column_list':
        return this.kids(block, depth);
      case 'column':
        return this.kids(block, depth);
      case 'child_page': {
        const href = this.pageHref(String(block.id).replace(/-/g, '').toLowerCase());
        const title = d.title || 'Untitled';
        return href ? `[${title}](${href})` : title;
      }
      case 'child_database':
        return `*The database "${d.title || 'Untitled'}" is not exported yet.*`;
      case 'link_to_page': {
        if (!d.page_id) return '';
        const key = String(d.page_id).replace(/-/g, '').toLowerCase();
        const href = this.pageHref(key);
        const title = this.pageTitle(key);
        return href && title ? `[${title}](${href})` : '';
      }
      case 'synced_block':
        return this.kids(block, depth);
      case 'table_of_contents':
      case 'breadcrumb':
      case 'unsupported':
        return '';
      default:
        return `<!-- unsupported block: ${type} -->`;
    }
  }

  table(block) {
    const rows = (block.children || []).map((row) => (row.table_row?.cells || []).map((cell) => this.inline(cell)));
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill('')];
    const sep = Array(width).fill('---');
    return [
      `| ${pad(rows[0]).join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...rows.slice(1).map(pad).map((r) => `| ${r.join(' | ')} |`),
    ].join('\n');
  }

  /** Links to other exported pages become relative links; everything else stays as it is. */
  resolveHref(href) {
    const looksLikeNotion = href.startsWith('/') || href.includes('notion.so');
    const m = looksLikeNotion && href.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i);
    if (m) {
      const local = this.pageHref(m[1].replace(/-/g, '').toLowerCase());
      if (local) return local;
    }
    return looksLikeNotion && href.startsWith('/') ? `https://www.notion.so${href}` : null;
  }
}
