import { StorageAccessFramework } from 'expo-file-system/legacy';

import type { Book, Chapter } from '../types/library';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const SCAN_CONCURRENCY = 8;

export const getDisplayName = (uri: string) => {
  const rawName = getFileName(uri);

  return rawName.replace(/^primary:/, '').replace(/\.[a-z0-9]+$/i, '');
};

const getFileName = (uri: string) => {
  const decoded = decodeURIComponent(uri);
  const segments = decoded.split('/').filter(Boolean);

  return segments[segments.length - 1] ?? decoded;
};

const getFileExtension = (uri: string) => {
  const name = getFileName(uri);
  const dotIndex = name.lastIndexOf('.');

  return dotIndex === -1 ? '' : name.slice(dotIndex + 1).toLowerCase();
};

const isImageUri = (uri: string) => IMAGE_EXTENSIONS.has(getFileExtension(uri));

const compareByName = (left: string, right: string) =>
  getDisplayName(left).localeCompare(getDisplayName(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

const readDirectory = async (uri: string) => StorageAccessFramework.readDirectoryAsync(uri);

const mapWithConcurrency = async <Input, Output>(
  items: Input[],
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>,
) => {
  const results = new Array<Output>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);

  return results;
};

const readChildDirectory = async (uri: string) => {
  try {
    return await readDirectory(uri);
  } catch {
    return null;
  }
};

const getImagePages = async (dirUri: string) => {
  const entries = await readChildDirectory(dirUri);

  return entries ? entries.filter(isImageUri).sort(compareByName) : [];
};

// 入参：漫画根目录或章节目录 URI。返回：按文件名自然排序后的章节列表。
export const scanChapters = async (bookUri: string): Promise<Chapter[]> => {
  const directPages = await getImagePages(bookUri);

  if (directPages.length > 0) {
    return [
      {
        id: bookUri,
        title: '正文',
        uri: bookUri,
        pages: directPages,
      },
    ];
  }

  const entries = ((await readChildDirectory(bookUri)) ?? []).sort(compareByName);
  const scannedChapters = await mapWithConcurrency(entries, SCAN_CONCURRENCY, async (entry) => {
    const pages = await getImagePages(entry);

    if (pages.length === 0) {
      return null;
    }

    return {
      id: entry,
      title: getDisplayName(entry),
      uri: entry,
      pages,
    };
  });

  return scannedChapters.filter((chapter): chapter is Chapter => Boolean(chapter));
};

// 入参：用户授权的根目录 URI。返回：可阅读书籍列表；只保留含图片页面的目录。
export const scanLibrary = async (rootUri: string) => {
  const rootEntries = (await readDirectory(rootUri)).sort(compareByName);
  const scannedBooks = await mapWithConcurrency(rootEntries, SCAN_CONCURRENCY, async (entry) => {
    const chapters = await scanChapters(entry);

    if (chapters.length === 0) {
      return null;
    }

    const pageCount = chapters.reduce((total, chapter) => total + chapter.pages.length, 0);

    return {
      id: entry,
      title: getDisplayName(entry),
      uri: entry,
      coverUri: chapters[0].pages[0],
      pageCount,
      chapters,
    };
  });
  const books = scannedBooks.filter((book): book is Book => Boolean(book));

  if (books.length === 0) {
    const chapters = await scanChapters(rootUri);

    if (chapters.length > 0) {
      books.push({
        id: rootUri,
        title: getDisplayName(rootUri),
        uri: rootUri,
        coverUri: chapters[0].pages[0],
        pageCount: chapters.reduce((total, chapter) => total + chapter.pages.length, 0),
        chapters,
      });
    }
  }

  return books;
};
