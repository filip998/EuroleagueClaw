const SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!]/g;

/** Escape all MarkdownV2 special characters for literal use. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, '\\$&');
}

export function bold(text: string): string {
  return `*${escapeMarkdownV2(text)}*`;
}

export function italic(text: string): string {
  return `_${escapeMarkdownV2(text)}_`;
}

export function underline(text: string): string {
  return `__${escapeMarkdownV2(text)}__`;
}

export function strikethrough(text: string): string {
  return `~${escapeMarkdownV2(text)}~`;
}

export function inlineCode(text: string): string {
  const escaped = text.replace(/[`\\]/g, '\\$&');
  return `\`${escaped}\``;
}

export function link(label: string, url: string): string {
  return `[${escapeMarkdownV2(label)}](${escapeMarkdownV2(url)})`;
}

/** Wrap text in a MarkdownV2 code block (triple backticks). Only ` and \ need escaping inside. */
export function codeBlock(text: string): string {
  const escaped = text.replace(/[`\\]/g, '\\$&');
  return `\`\`\`\n${escaped}\n\`\`\``;
}
