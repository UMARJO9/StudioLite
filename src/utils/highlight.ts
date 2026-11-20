// Syntax highlighting for the read-only file viewer.
// Language grammars are loaded on demand, so only the ones actually opened cost anything.
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';

type Loader = () => Promise<{ default: LanguageFn }>;

const LOADERS: Record<string, Loader> = {
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  java: () => import('highlight.js/lib/languages/java'),
  xml: () => import('highlight.js/lib/languages/xml'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  json: () => import('highlight.js/lib/languages/json'),
  properties: () => import('highlight.js/lib/languages/properties'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  bash: () => import('highlight.js/lib/languages/bash'),
  ini: () => import('highlight.js/lib/languages/ini'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  css: () => import('highlight.js/lib/languages/css'),
  python: () => import('highlight.js/lib/languages/python'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  dart: () => import('highlight.js/lib/languages/dart'),
};

const BY_EXTENSION: Record<string, string> = {
  kt: 'kotlin',
  kts: 'kotlin',
  java: 'java',
  xml: 'xml',
  html: 'xml',
  svg: 'xml',
  gradle: 'groovy',
  groovy: 'groovy',
  json: 'json',
  properties: 'properties',
  pro: 'properties',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  sh: 'bash',
  bat: 'bash',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  editorconfig: 'ini',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  css: 'css',
  py: 'python',
  sql: 'sql',
  swift: 'swift',
  dart: 'dart',
};

const BY_NAME: Record<string, string> = {
  gradlew: 'bash',
  'CMakeLists.txt': 'bash',
};

/** Above this, highlighting would take noticeably long; the file is shown as plain text. */
const MAX_HIGHLIGHT_CHARS = 400_000;

export function languageOf(fileName: string): string | null {
  if (BY_NAME[fileName]) return BY_NAME[fileName];
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return null;
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Splits highlighted HTML into self-contained lines. A token may span several lines
 * (block comments, raw strings), so open spans are closed at each line end and reopened
 * on the next line.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  let last = 0;
  const re = /<span[^>]*>|<\/span>|\n/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    current += html.slice(last, m.index);
    last = re.lastIndex;
    const token = m[0];
    if (token === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else {
      if (token === '</span>') open.pop();
      else open.push(token);
      current += token;
    }
  }
  current += html.slice(last);
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
}

/** Returns one HTML string per line; safe to render with v-html (all text is escaped). */
export async function highlightToLines(fileName: string, text: string): Promise<string[]> {
  const source = text.replace(/\r\n?/g, '\n');
  const language = languageOf(fileName);
  if (language && source.length <= MAX_HIGHLIGHT_CHARS) {
    try {
      if (!hljs.getLanguage(language)) {
        hljs.registerLanguage(language, (await LOADERS[language]()).default);
      }
      return splitHighlightedLines(hljs.highlight(source, { language }).value);
    } catch (e) {
      console.warn('highlight failed, showing plain text', fileName, e);
    }
  }
  return escapeHtml(source).split('\n');
}
