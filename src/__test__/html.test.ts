import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { htmlToText } from '../html.ts';

function node(html: string): Node {
  const dom = new JSDOM(`<body>${html}</body>`);
  return dom.window.document.body;
}

describe('htmlToText', () => {
  it('returns plain text unchanged', () => {
    expect(htmlToText(node('hello world'))).toBe('hello world');
  });

  it('extracts text from a single paragraph', () => {
    expect(htmlToText(node('<p>hello</p>'))).toBe('hello');
  });

  it('separates paragraphs with newlines', () => {
    expect(htmlToText(node('<p>one</p><p>two</p>'))).toBe('one\ntwo');
  });

  it('renders inline strong inside paragraph', () => {
    expect(htmlToText(node('<p>hi <strong>there</strong></p>'))).toBe(
      'hi there',
    );
  });

  it('renders br as newline (br><br collapses to one line removed)', () => {
    expect(htmlToText(node('<p>line1<br>line2</p>'))).toBe('line1\nline2');
  });

  it('collapses consecutive br into single line break', () => {
    expect(htmlToText(node('<p>a<br><br>b</p>'))).toBe('a\nb');
  });

  it('renders list items as separate lines', () => {
    const html = '<ul><li>one</li><li>two</li><li>three</li></ul>';
    expect(htmlToText(node(html))).toBe('one\ntwo\nthree');
  });

  it('renders ordered list items too', () => {
    const html = '<ol><li>a</li><li>b</li></ol>';
    expect(htmlToText(node(html))).toBe('a\nb');
  });

  it('handles nested lists', () => {
    const html =
      '<ul><li>parent<ul><li>child1</li><li>child2</li></ul></li></ul>';
    expect(htmlToText(node(html))).toBe('parent\nchild1\nchild2');
  });

  it('collapses internal whitespace runs', () => {
    expect(htmlToText(node("<p>hello   \t  world</p>"))).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(htmlToText(node('   <p>hi</p>   '))).toBe('hi');
  });

  it('removes empty lines from output', () => {
    const html = '<p>one</p><p></p><p>two</p>';
    expect(htmlToText(node(html))).toBe('one\ntwo');
  });

  it('returns empty string for empty body', () => {
    expect(htmlToText(node(''))).toBe('');
  });

  it('returns empty string for body with only whitespace', () => {
    expect(htmlToText(node('   \n  \t '))).toBe('');
  });

  it('renders anchor text inline', () => {
    expect(htmlToText(node('<p>see <a href="#">docs</a></p>'))).toBe('see docs');
  });

  it('mixes paragraphs, breaks, and lists', () => {
    const html =
      '<p>Intro line</p><ul><li>item1</li><li>item2</li></ul><p>Outro<br>second</p>';
    expect(htmlToText(node(html))).toBe(
      'Intro line\nitem1\nitem2\nOutro\nsecond',
    );
  });

  it('handles span wrapping text inside paragraph', () => {
    expect(htmlToText(node('<p><span>wrapped</span></p>'))).toBe('wrapped');
  });

  it('drops empty paragraph-only content but keeps siblings', () => {
    const html = '<p></p><p>kept</p><p></p>';
    expect(htmlToText(node(html))).toBe('kept');
  });

  it('does not collapse single newlines into spaces', () => {
    expect(htmlToText(node('<p>a</p><p>b</p>'))).toBe('a\nb');
  });
});