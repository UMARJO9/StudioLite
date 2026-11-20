// A small Markdown renderer for chat answers. All source text is HTML-escaped before any
// markup is added, so the result is safe for v-html. Covers what chat answers actually use:
// headings, lists, fenced and inline code, bold, italics, quotes. Links are shown, not followed.
import { escapeHtml } from './highlight';

function renderInline(text: string): string {
  // Code spans are taken out first so that their content is not treated as markup.
  return text
    .split(/(`[^`\n]+`)/g)
    .map((part) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part)
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<span class="md-link" title="$2">$1</span>');
    })
    .join('');
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      html.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    }
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      const label = fence[1] ? `<div class="md-lang">${escapeHtml(fence[1])}</div>` : '';
      html.push(`<div class="md-code">${label}<pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6); // chat headings stay modest
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(renderInline((bullet ?? numbered)![1]));
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      html.push('<hr>');
      continue;
    }

    // Indented continuation of a list item stays with that item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += '<br>' + renderInline(line.trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flush();
  return html.join('');
}
