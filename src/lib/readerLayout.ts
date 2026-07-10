import type { PageSize } from '../types/library';

export type ReaderPageLayout = {
  index: number;
  length: number;
  offset: number;
};

// 入参：页面、原始尺寸、屏宽和页间距。返回值：FlatList 可直接使用的确定性布局表。
export const buildReaderPageLayouts = (
  pages: string[],
  pageSizes: Record<string, PageSize>,
  width: number,
  pageGap: number,
) =>
  pages.reduce<ReaderPageLayout[]>((layouts, uri, index) => {
    const size = pageSizes[uri];

    if (!size || size.width <= 0 || size.height <= 0) {
      throw new Error(`Missing page size for layout: ${uri}`);
    }

    const previousLayout = layouts[index - 1];
    const length = Math.max(1, Math.round((width * size.height) / size.width)) + pageGap;

    layouts.push({
      index,
      length,
      offset: previousLayout ? previousLayout.offset + previousLayout.length : 0,
    });

    return layouts;
  }, []);

// 入参：确定性布局表和滚动 offset。返回值：屏幕顶部实际对应的页索引。
export const getReaderPageIndexAtOffset = (layouts: ReaderPageLayout[], offset: number) => {
  if (layouts.length === 0) {
    return 0;
  }

  const safeOffset = Math.max(0, offset);
  let low = 0;
  let high = layouts.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const layout = layouts[middle];

    if (safeOffset < layout.offset + layout.length) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
};
