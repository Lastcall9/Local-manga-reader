import {
  getInfoAsync,
  readDirectoryAsync,
  StorageAccessFramework,
} from 'expo-file-system/legacy';

import type { Book, Chapter, PageSize } from '../types/library';
import { prepareArchive } from './archiveCache';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'cbz']);
const SCAN_CONCURRENCY = 4;

type BookSourceOptions = {
  sourceType?: Book['sourceType'];
  archiveSignature?: string;
  title?: string;
};

type ScannedBookEntry = {
  book: Book | null;
  warning?: string;
};

export type LibraryScanResult = {
  books: Book[];
  warnings: string[];
};

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
const isArchiveUri = (uri: string) => ARCHIVE_EXTENSIONS.has(getFileExtension(uri));

const compareByName = (left: string, right: string) =>
  getDisplayName(left).localeCompare(getDisplayName(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

const readDirectory = async (uri: string) =>
  uri.startsWith('content://')
    ? StorageAccessFramework.readDirectoryAsync(uri)
    : readDirectoryAsync(uri);

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

const getImagePages = async (dirUri: string) => {
  const entries = await readDirectory(dirUri);

  return entries.filter(isImageUri).sort(compareByName);
};

const areSamePages = (left: string[], right: string[]) =>
  left.length === right.length && left.every((uri, index) => uri === right[index]);

// 入参：已知页面尺寸与新页面列表。返回：仍然有效的尺寸缓存。
const retainKnownPageSizes = (pageSizes: Record<string, PageSize> | undefined, pages: string[]) => {
  if (!pageSizes) {
    return undefined;
  }

  const pageSet = new Set(pages);
  const retainedPageSizes = Object.fromEntries(
    Object.entries(pageSizes).filter(([uri]) => pageSet.has(uri)),
  );

  return Object.keys(retainedPageSizes).length > 0 ? retainedPageSizes : undefined;
};

// 入参：章节信息与可选旧章节。返回：保留有效尺寸缓存的新章节。
const createChapter = (
  uri: string,
  title: string,
  pages: string[],
  modifiedAt: number | undefined,
  cachedChapter?: Chapter,
): Chapter => ({
  id: uri,
  title,
  uri,
  pages,
  pageSizes: retainKnownPageSizes(cachedChapter?.pageSizes, pages),
  modifiedAt,
});

// 入参：漫画目录与旧章节。返回：只重新读取发生变化的章节。
export const scanChapters = async (
  bookUri: string,
  cachedChapters: Chapter[] = [],
  bookModifiedAt?: number,
): Promise<Chapter[]> => {
  const entries = (await readDirectory(bookUri)).sort(compareByName);
  const directPages = entries.filter(isImageUri);
  const cachedChapterMap = new Map(cachedChapters.map((chapter) => [chapter.id, chapter]));

  if (directPages.length > 0) {
    const cachedChapter = cachedChapterMap.get(bookUri);

    if (cachedChapter && areSamePages(cachedChapter.pages, directPages)) {
      return cachedChapter.modifiedAt === bookModifiedAt
        ? [cachedChapter]
        : [{ ...cachedChapter, modifiedAt: bookModifiedAt }];
    }

    return [createChapter(bookUri, '正文', directPages, bookModifiedAt, cachedChapter)];
  }

  const scannedChapters = await mapWithConcurrency(entries, SCAN_CONCURRENCY, async (entry) => {
    const info = await getInfoAsync(entry);

    if (!info.exists || !info.isDirectory) {
      return null;
    }

    const cachedChapter = cachedChapterMap.get(entry);
    const canReuseCachedChapter = Boolean(
      cachedChapter &&
      info.modificationTime > 0 &&
      cachedChapter.modifiedAt === info.modificationTime,
    );

    if (canReuseCachedChapter) {
      return cachedChapter ?? null;
    }

    const pages = await getImagePages(entry);

    if (pages.length === 0) {
      return null;
    }

    if (cachedChapter && areSamePages(cachedChapter.pages, pages)) {
      return {
        ...cachedChapter,
        title: getDisplayName(entry),
        modifiedAt: info.modificationTime,
      };
    }

    return createChapter(entry, getDisplayName(entry), pages, info.modificationTime, cachedChapter);
  });

  return scannedChapters.filter((chapter): chapter is Chapter => Boolean(chapter));
};

const createBook = (
  uri: string,
  chapters: Chapter[],
  cachedBook?: Book,
  sourceOptions: BookSourceOptions = {},
): Book => {
  const pageCount = chapters.reduce((total, chapter) => total + chapter.pages.length, 0);
  const title = sourceOptions.title ?? getDisplayName(uri);
  const coverUri = chapters[0].pages[0];
  const sourceType = sourceOptions.sourceType ?? 'directory';
  const canReuseCachedBook = Boolean(
    cachedBook &&
    cachedBook.title === title &&
    cachedBook.pageCount === pageCount &&
    cachedBook.coverUri === coverUri &&
    (cachedBook.sourceType ?? 'directory') === sourceType &&
    cachedBook.archiveSignature === sourceOptions.archiveSignature &&
    cachedBook.chapters.length === chapters.length &&
    cachedBook.chapters.every((chapter, index) => chapter === chapters[index]),
  );

  if (canReuseCachedBook) {
    return cachedBook as Book;
  }

  return {
    id: uri,
    title,
    uri,
    coverUri,
    pageCount,
    chapters,
    sourceType,
    archiveSignature: sourceOptions.archiveSignature,
  };
};

const resolveArchiveContentRoot = async (contentUri: string) => {
  const entries = (await readDirectory(contentUri)).sort(compareByName);

  if (entries.some(isImageUri)) {
    return contentUri;
  }

  const directoryEntries = await mapWithConcurrency(entries, SCAN_CONCURRENCY, async (entry) => {
    const info = await getInfoAsync(entry);

    return info.exists && info.isDirectory ? entry : null;
  });
  const directories = directoryEntries.filter((entry): entry is string => Boolean(entry));

  return directories.length === 1 ? directories[0] : contentUri;
};

const scanArchiveBook = async (archiveUri: string, cachedBook: Book | undefined) => {
  let sourceInfo = await getInfoAsync(archiveUri);

  if (!sourceInfo.exists || sourceInfo.isDirectory) {
    return null;
  }

  if (sourceInfo.modificationTime <= 0) {
    sourceInfo = await getInfoAsync(archiveUri, { md5: true });
  }

  if (!sourceInfo.exists || sourceInfo.isDirectory) {
    return null;
  }

  const preparedArchive = await prepareArchive(archiveUri, {
    size: sourceInfo.size,
    modificationTime: sourceInfo.modificationTime,
    md5: sourceInfo.md5,
  });

  if (
    cachedBook?.sourceType === 'archive' &&
    cachedBook.archiveSignature === preparedArchive.signature
  ) {
    return cachedBook;
  }

  const contentRootUri = await resolveArchiveContentRoot(preparedArchive.contentUri);
  const cachedChapters = cachedBook?.sourceType === 'archive' ? cachedBook.chapters : [];
  const chapters = await scanChapters(contentRootUri, cachedChapters);

  if (chapters.length === 0) {
    throw new Error(`归档《${getDisplayName(archiveUri)}》中没有找到可读图片`);
  }

  return createBook(archiveUri, chapters, cachedBook, {
    sourceType: 'archive',
    archiveSignature: preparedArchive.signature,
    title: getDisplayName(archiveUri),
  });
};

const scanRootEntry = async (
  entry: string,
  cachedBook: Book | undefined,
): Promise<ScannedBookEntry> => {
  try {
    const info = await getInfoAsync(entry);

    if (!info.exists) {
      return { book: null };
    }

    if (info.isDirectory) {
      const chapters = await scanChapters(entry, cachedBook?.chapters, info.modificationTime);

      return {
        book: chapters.length > 0
          ? createBook(entry, chapters, cachedBook, { sourceType: 'directory' })
          : null,
      };
    }

    if (!isArchiveUri(entry)) {
      return { book: null };
    }

    return { book: await scanArchiveBook(entry, cachedBook) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误';
    const conciseReason = reason.split('\n')[0].slice(0, 240);

    return {
      book: cachedBook ?? null,
      warning: `跳过《${getDisplayName(entry)}》：${conciseReason}`,
    };
  }
};

// 入参：用户授权的根目录与旧书库。返回：复用未变书籍和章节的新书库。
export const scanLibrary = async (
  rootUri: string,
  cachedBooks: Book[] = [],
): Promise<LibraryScanResult> => {
  const rootEntries = (await readDirectory(rootUri)).sort(compareByName);
  const cachedBookMap = new Map(cachedBooks.map((book) => [book.id, book]));
  const rootDirectPages = rootEntries.filter(isImageUri);

  if (rootDirectPages.length > 0) {
    const rootInfo = await getInfoAsync(rootUri);
    const cachedBook = cachedBookMap.get(rootUri);
    const chapters = await scanChapters(
      rootUri,
      cachedBook?.chapters,
      rootInfo.exists ? rootInfo.modificationTime : undefined,
    );

    return {
      books: chapters.length > 0
        ? [createBook(rootUri, chapters, cachedBook, { sourceType: 'directory' })]
        : [],
      warnings: [],
    };
  }

  const scannedEntries = await mapWithConcurrency(rootEntries, SCAN_CONCURRENCY, async (entry) =>
    scanRootEntry(entry, cachedBookMap.get(entry)),
  );

  return {
    books: scannedEntries
      .map((entry) => entry.book)
      .filter((book): book is Book => Boolean(book)),
    warnings: scannedEntries
      .map((entry) => entry.warning)
      .filter((warning): warning is string => Boolean(warning)),
  };
};
