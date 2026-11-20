import { describe, expect, it } from 'vitest';
import { highlightToLines, languageOf, splitHighlightedLines } from './highlight';

describe('languageOf', () => {
  it.each([
    ['MainActivity.kt', 'kotlin'],
    ['build.gradle.kts', 'kotlin'],
    ['build.gradle', 'groovy'],
    ['AndroidManifest.xml', 'xml'],
    ['gradle.properties', 'properties'],
    ['libs.versions.toml', 'ini'],
    ['gradlew', 'bash'],
    ['LICENSE', null],
    ['photo.png', null],
  ] as const)('%s → %s', (name, language) => {
    expect(languageOf(name)).toBe(language);
  });
});

describe('splitHighlightedLines', () => {
  it('splits plain text by line', () => {
    expect(splitHighlightedLines('a\nb\n')).toEqual(['a', 'b', '']);
  });

  it('closes and reopens a span that runs over several lines', () => {
    const html = 'x <span class="c">/* one\ntwo\nthree */</span> y';
    expect(splitHighlightedLines(html)).toEqual([
      'x <span class="c">/* one</span>',
      '<span class="c">two</span>',
      '<span class="c">three */</span> y',
    ]);
  });

  it('keeps nesting intact across a line break', () => {
    const html = '<span class="s">"a <span class="v">${b\n}</span> c"</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="s">"a <span class="v">${b</span></span>',
      '<span class="s"><span class="v">}</span> c"</span>',
    ]);
  });
});

describe('highlightToLines', () => {
  it('highlights Kotlin and returns one entry per source line', async () => {
    const lines = await highlightToLines('A.kt', 'fun main() {\r\n    val x = "<b>"\r\n}');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('hljs-keyword');
    // Source text is escaped, never passed through as markup.
    expect(lines[1]).toContain('&lt;b&gt;');
    expect(lines[1]).not.toContain('<b>');
  });

  it('escapes files of unknown type', async () => {
    expect(await highlightToLines('notes', 'a <script> & b\nc')).toEqual([
      'a &lt;script&gt; &amp; b',
      'c',
    ]);
  });
});
