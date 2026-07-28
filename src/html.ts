export function htmlToText(node: Node): string {
  return convert(node)
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

function convert(node: Node): string {
  let text = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      text += child.textContent ?? '';
      continue;
    }
    if (child.nodeType === 1) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') {
        text += '\n';
        continue;
      }
      const inner = convert(el);
      if (tag === 'p' || tag === 'li') {
        text += `${inner}\n`;
      } else if (tag === 'ul' || tag === 'ol') {
        text += `\n${inner}\n`;
      } else {
        text += inner;
      }
    }
  }
  return text;
}