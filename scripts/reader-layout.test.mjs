import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReaderPageLayouts,
  getReaderPageIndexAtOffset,
} from '../src/lib/readerLayout.ts';

const pages = Array.from({ length: 400 }, (_, index) => `page-${index}`);
const pageSizes = Object.fromEntries(
  pages.map((uri, index) => [
    uri,
    {
      width: 1000,
      height: index % 7 === 0 ? 2400 : index % 3 === 0 ? 900 : 1600,
    },
  ]),
);
const layouts = buildReaderPageLayouts(pages, pageSizes, 1080, 8);

test('续读第 120 页不会反算成第 300 页', () => {
  assert.equal(getReaderPageIndexAtOffset(layouts, layouts[119].offset), 119);
  assert.notEqual(getReaderPageIndexAtOffset(layouts, layouts[119].offset), 299);
});

test('滚动条跳转的每一页 offset 都能反算回同一页', () => {
  layouts.forEach((layout) => {
    assert.equal(getReaderPageIndexAtOffset(layouts, layout.offset), layout.index);
  });
});

test('页边界前后分别属于相邻页面', () => {
  const boundary = layouts[120].offset;

  assert.equal(getReaderPageIndexAtOffset(layouts, boundary - 1), 119);
  assert.equal(getReaderPageIndexAtOffset(layouts, boundary), 120);
});
