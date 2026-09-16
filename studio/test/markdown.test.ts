import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withoutFrontmatter } from '../src/markdown.ts';

describe('withoutFrontmatter', () => {
  test('drops a leading frontmatter block', () => {
    assert.equal(
      withoutFrontmatter('---\nid: ui\ndescription: UI rules\n---\n\n# Real heading\n'),
      '\n# Real heading\n'
    );
  });

  test('leaves a file with no frontmatter alone', () => {
    const body = '# Code style\n\nNo frontmatter here.\n';
    assert.equal(withoutFrontmatter(body), body);
  });

  test('only the leading block counts', () => {
    // A thematic break further down is content, not metadata.
    const body = '# Title\n\n---\n\nAfter a rule.\n';
    assert.equal(withoutFrontmatter(body), body);
  });

  test('a frontmatter block with nothing after it yields an empty body', () => {
    assert.equal(withoutFrontmatter('---\nid: ui\n---\n'), '');
  });

  test('a stray opening fence is not treated as frontmatter', () => {
    const body = '---\nid: ui\n\nnever closed\n';
    assert.equal(withoutFrontmatter(body), body);
  });
});
