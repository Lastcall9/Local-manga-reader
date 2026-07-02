export type PageSize = {
  height: number;
  width: number;
};

export type Chapter = {
  id: string;
  title: string;
  uri: string;
  pages: string[];
  pageSizes?: Record<string, PageSize>;
};

export type Book = {
  id: string;
  title: string;
  uri: string;
  coverUri: string;
  pageCount: number;
  chapters: Chapter[];
};

export type LibraryState = {
  rootUri: string | null;
  books: Book[];
};

export type ReaderState = {
  book: Book;
  chapterIndex: number;
  pageIndex: number;
};

export type ReadingProgress = {
  chapterIndex: number;
  pageIndex: number;
  updatedAt?: number;
};

export type ProgressMap = Record<string, ReadingProgress>;

export type ReaderMode = 'paged' | 'scroll';

export type ThemeMode = 'system' | 'light' | 'dark';

export type ReadingDirection = 'ltr' | 'rtl';

export type ImageFitMode = 'height' | 'width';

export type PageGapMode = 'none' | 'small' | 'medium';

export type LibrarySortMode = 'recent' | 'name' | 'progress' | 'pages';

export type AppSettings = {
  readerMode: ReaderMode;
  themeMode: ThemeMode;
  readingDirection: ReadingDirection;
  imageFitMode: ImageFitMode;
  pageGapMode: PageGapMode;
  librarySortMode: LibrarySortMode;
};
