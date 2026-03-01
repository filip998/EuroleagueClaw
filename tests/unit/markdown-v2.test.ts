import { describe, it, expect } from 'vitest';
import {
  escapeMarkdownV2,
  bold,
  italic,
  underline,
  strikethrough,
  inlineCode,
  link,
  codeBlock,
} from '../../src/shared/markdown-v2.js';

describe('escapeMarkdownV2', () => {
  it('should escape all Telegram MarkdownV2 special characters', () => {
    // Test each special char in sequence (excluding backslash, tested separately)
    const specials = '_*[]()~`>#+-=|{}.!';
    const escaped = escapeMarkdownV2(specials);
    expect(escaped).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!');
  });

  it('should escape individual special characters', () => {
    expect(escapeMarkdownV2('_')).toBe('\\_');
    expect(escapeMarkdownV2('*')).toBe('\\*');
    expect(escapeMarkdownV2('[')).toBe('\\[');
    expect(escapeMarkdownV2(']')).toBe('\\]');
    expect(escapeMarkdownV2('(')).toBe('\\(');
    expect(escapeMarkdownV2(')')).toBe('\\)');
    expect(escapeMarkdownV2('~')).toBe('\\~');
    expect(escapeMarkdownV2('`')).toBe('\\`');
    expect(escapeMarkdownV2('>')).toBe('\\>');
    expect(escapeMarkdownV2('#')).toBe('\\#');
    expect(escapeMarkdownV2('+')).toBe('\\+');
    expect(escapeMarkdownV2('-')).toBe('\\-');
    expect(escapeMarkdownV2('=')).toBe('\\=');
    expect(escapeMarkdownV2('|')).toBe('\\|');
    expect(escapeMarkdownV2('{')).toBe('\\{');
    expect(escapeMarkdownV2('}')).toBe('\\}');
    expect(escapeMarkdownV2('.')).toBe('\\.');
    expect(escapeMarkdownV2('!')).toBe('\\!');
  });

  it('should not escape backslash (not in regex character class)', () => {
    // The SPECIAL_CHARS regex uses \- and \] as escapes inside the character class.
    // Standalone backslash is not explicitly matched.
    expect(escapeMarkdownV2('\\')).toBe('\\');
  });

  it('should NOT escape emoji characters', () => {
    expect(escapeMarkdownV2('🏀')).toBe('🏀');
    expect(escapeMarkdownV2('🔥')).toBe('🔥');
    expect(escapeMarkdownV2('🎯')).toBe('🎯');
    expect(escapeMarkdownV2('🛡️')).toBe('🛡️');
    expect(escapeMarkdownV2('✅')).toBe('✅');
    expect(escapeMarkdownV2('📋')).toBe('📋');
    expect(escapeMarkdownV2('🏆')).toBe('🏆');
  });

  it('should return empty string unchanged', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

  it('should return plain text without special chars unchanged', () => {
    expect(escapeMarkdownV2('hello world')).toBe('hello world');
    expect(escapeMarkdownV2('abc123')).toBe('abc123');
  });

  it('should handle basketball scoreline like "Real Madrid 93-70 Bayern"', () => {
    const result = escapeMarkdownV2('Real Madrid 93-70 Bayern');
    expect(result).toBe('Real Madrid 93\\-70 Bayern');
  });

  it('should handle text with mixed special chars and regular text', () => {
    const result = escapeMarkdownV2('Score: 89-78 (OT)');
    expect(result).toBe('Score: 89\\-78 \\(OT\\)');
  });

  it('should handle text with emoji and special chars mixed', () => {
    const result = escapeMarkdownV2('🏀 Game #1 (Finals)');
    expect(result).toBe('🏀 Game \\#1 \\(Finals\\)');
  });
});

describe('bold', () => {
  it('should wrap text with * and escape inner content', () => {
    expect(bold('hello')).toBe('*hello*');
  });

  it('should escape special chars inside bold', () => {
    expect(bold('93-70')).toBe('*93\\-70*');
  });

  it('should handle text with formatting chars', () => {
    expect(bold('Real Madrid (MAD)')).toBe('*Real Madrid \\(MAD\\)*');
  });
});

describe('italic', () => {
  it('should wrap text with _ and escape inner content', () => {
    expect(italic('hello')).toBe('_hello_');
  });

  it('should escape special chars inside italic', () => {
    expect(italic('score: 89-78')).toBe('_score: 89\\-78_');
  });
});

describe('underline', () => {
  it('should wrap text with __ and escape inner content', () => {
    expect(underline('hello')).toBe('__hello__');
  });

  it('should escape special chars inside underline', () => {
    expect(underline('test_value')).toBe('__test\\_value__');
  });
});

describe('strikethrough', () => {
  it('should wrap text with ~ and escape inner content', () => {
    expect(strikethrough('removed')).toBe('~removed~');
  });

  it('should escape tilde inside strikethrough', () => {
    expect(strikethrough('~old~')).toBe('~\\~old\\~~');
  });
});

describe('inlineCode', () => {
  it('should wrap text with backticks', () => {
    expect(inlineCode('code')).toBe('`code`');
  });

  it('should escape backticks and backslashes inside code', () => {
    expect(inlineCode('a`b')).toBe('`a\\`b`');
    expect(inlineCode('a\\b')).toBe('`a\\\\b`');
  });

  it('should NOT escape other special chars inside code', () => {
    // inlineCode only escapes ` and \, not MarkdownV2 specials
    expect(inlineCode('a-b')).toBe('`a-b`');
    expect(inlineCode('a*b')).toBe('`a*b`');
  });
});

describe('link', () => {
  it('should format as MarkdownV2 link with escaped label and url', () => {
    const result = link('Click here', 'https://example.com');
    expect(result).toBe('[Click here](https://example\\.com)');
  });

  it('should escape special chars in label', () => {
    const result = link('Game #1', 'https://example.com');
    expect(result).toContain('[Game \\#1]');
  });

  it('should escape special chars in URL', () => {
    const result = link('Link', 'https://example.com/path?a=1&b=2');
    expect(result).toContain('example\\.com');
  });
});

describe('codeBlock', () => {
  it('should wrap content in triple backticks', () => {
    const result = codeBlock('hello');
    expect(result).toBe('```\nhello\n```');
  });

  it('should escape backticks inside content', () => {
    const result = codeBlock('a`b');
    expect(result).toBe('```\na\\`b\n```');
  });

  it('should escape backslashes inside content', () => {
    const result = codeBlock('a\\b');
    expect(result).toBe('```\na\\\\b\n```');
  });

  it('should handle empty content', () => {
    const result = codeBlock('');
    expect(result).toBe('```\n\n```');
  });

  it('should NOT escape MarkdownV2 special chars (only ` and \\)', () => {
    const result = codeBlock('score: 89-78 (OT)');
    expect(result).toBe('```\nscore: 89-78 (OT)\n```');
  });

  it('should handle multiline content', () => {
    const result = codeBlock('line1\nline2\nline3');
    expect(result).toBe('```\nline1\nline2\nline3\n```');
  });
});
