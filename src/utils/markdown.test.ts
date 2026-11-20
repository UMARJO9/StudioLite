import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('escapes HTML in every position', () => {
    const html = renderMarkdown('<img src=x onerror=1> **<b>** `<i>`\n\n```\n<script>\n```');
    expect(html).not.toMatch(/<img|<script|<b>|<i>/);
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).toContain('<strong>&lt;b&gt;</strong>');
    expect(html).toContain('<code>&lt;i&gt;</code>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders paragraphs, bold, italics and inline code', () => {
    expect(renderMarkdown('Это **важно** и *курсив*, см. `Main.kt`.\nвторая строка')).toBe(
      '<p>Это <strong>важно</strong> и <em>курсив</em>, см. <code>Main.kt</code>.<br>вторая строка</p>',
    );
  });

  it('does not treat markup inside code spans or snake_case as emphasis', () => {
    expect(renderMarkdown('`a * b * c` and 2 * 3 * 4')).toBe(
      '<p><code>a * b * c</code> and 2 * 3 * 4</p>',
    );
  });

  it('renders fenced code with its language label, untouched inside', () => {
    expect(renderMarkdown('```kotlin\nval a = **1**\n```')).toBe(
      '<div class="md-code"><div class="md-lang">kotlin</div><pre><code>val a = **1**</code></pre></div>',
    );
  });

  it('renders lists and switches between bullet and numbered', () => {
    expect(renderMarkdown('- один\n- два\n  продолжение\n1. раз\n2. два')).toBe(
      '<ul><li>один</li><li>два<br>продолжение</li></ul><ol><li>раз</li><li>два</li></ol>',
    );
  });

  it('renders headings, quotes and rules', () => {
    expect(renderMarkdown('# Итог\n> цитата\n---')).toBe(
      '<h3>Итог</h3><blockquote>цитата</blockquote><hr>',
    );
  });

  it('shows links as text with the address in a tooltip', () => {
    expect(renderMarkdown('[файл](src/Main.kt)')).toBe(
      '<p><span class="md-link" title="src/Main.kt">файл</span></p>',
    );
  });

  it('closes an unterminated code fence', () => {
    expect(renderMarkdown('```\nabc')).toBe('<div class="md-code"><pre><code>abc</code></pre></div>');
  });
});
