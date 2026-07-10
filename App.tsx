import { StatusBar } from 'expo-status-bar';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookDetailModal } from './src/components/BookDetailModal';
import { LibraryView } from './src/components/LibraryView';
import { ReaderModal } from './src/components/ReaderModal';
import { clearArchiveCache } from './src/lib/archiveCache';
import { APP_VERSION } from './src/lib/appVersion';
import { scanLibrary } from './src/lib/libraryScanner';
import {
  DEFAULT_SETTINGS,
  loadProgress,
  loadSettings,
  loadStoredLibrary,
  saveLibrary,
  saveProgress,
  saveSettings,
} from './src/lib/libraryStorage';
import { disablePrivacyMode, enablePrivacyMode, getPrivacyModeEnabled } from './src/lib/privacyMode';
import { getColors, radii, resolveThemeMode } from './src/styles/theme';
import type {
  AppSettings,
  Book,
  LibrarySortMode,
  PageGapMode,
  PageSize,
  ProgressMap,
  ReaderMode,
  ReaderState,
  ReadingDirection,
  ThemeMode,
} from './src/types/library';

const LIBRARY_SAVE_DEBOUNCE_MS = 800;

// 入参：新扫描书库与旧书库。返回值：把仍然存在的页面尺寸缓存迁移到新书库。
const mergeBooksWithCachedPageSizes = (nextBooks: Book[], cachedBooks: Book[]) => {
  const cachedBookMap = new Map(cachedBooks.map((book) => [book.id, book]));

  return nextBooks.map((book) => {
    const cachedBook = cachedBookMap.get(book.id);

    if (!cachedBook) {
      return book;
    }

    const cachedChapterMap = new Map(cachedBook.chapters.map((chapter) => [chapter.id, chapter]));
    const nextChapters = book.chapters.map((chapter) => {
      const cachedChapter = cachedChapterMap.get(chapter.id);

      if (!cachedChapter?.pageSizes) {
        return chapter;
      }

      const pageSet = new Set(chapter.pages);
      const pageSizes = Object.fromEntries(
        Object.entries(cachedChapter.pageSizes).filter(([uri]) => pageSet.has(uri)),
      );

      return Object.keys(pageSizes).length > 0 ? { ...chapter, pageSizes } : chapter;
    });

    return {
      ...book,
      chapters: nextChapters,
    };
  });
};

export default function App() {
  return (
    <SafeAreaProvider>
      <MangaReaderApp />
    </SafeAreaProvider>
  );
}

function MangaReaderApp() {
  const insets = useSafeAreaInsets();
  const systemTheme = useColorScheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const resolvedTheme = resolveThemeMode(settings.themeMode, systemTheme === 'dark' ? 'dark' : 'light');
  const colors = useMemo(() => getColors(resolvedTheme), [resolvedTheme]);
  const [rootUri, setRootUri] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const progressRef = useRef<ProgressMap>({});
  const progressSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [reader, setReader] = useState<ReaderState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isPrivacyModeEnabled, setIsPrivacyModeEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const librarySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLibraryState = useRef<{ rootUri: string | null; books: Book[] } | null>(null);

  const selectedProgress = useMemo(() => {
    if (!selectedBook) {
      return null;
    }

    return progress[selectedBook.id] ?? { chapterIndex: 0, pageIndex: 0 };
  }, [progress, selectedBook]);

  const continueEntry = useMemo(() => {
    const entries = books
      .map((book) => ({ book, progress: progress[book.id] }))
      .filter((entry) => Boolean(entry.progress))
      .sort((left, right) => (right.progress?.updatedAt ?? 0) - (left.progress?.updatedAt ?? 0));

    return entries[0] ?? null;
  }, [books, progress]);

  const visibleBooks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredBooks = normalizedQuery
      ? books.filter((book) => book.title.toLowerCase().includes(normalizedQuery))
      : books;

    return [...filteredBooks].sort((left, right) => {
      const leftProgress = progress[left.id];
      const rightProgress = progress[right.id];

      if (settings.librarySortMode === 'name') {
        return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' });
      }

      if (settings.librarySortMode === 'pages') {
        return right.pageCount - left.pageCount;
      }
      const updatedAtDifference = (rightProgress?.updatedAt ?? 0) - (leftProgress?.updatedAt ?? 0);

      if (updatedAtDifference !== 0) {
        return updatedAtDifference;
      }

      return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [books, progress, searchQuery, settings.librarySortMode]);

  const updateSettings = useCallback(async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    await saveSettings(nextSettings);
  }, []);

  // 入参：待保存的完整进度。副作用：按调用顺序写入，避免旧进度晚于新进度落盘。
  const saveProgressInOrder = useCallback(async (nextProgress: ProgressMap) => {
    const queuedSave = progressSaveQueue.current
      .catch(() => undefined)
      .then(() => saveProgress(nextProgress));

    progressSaveQueue.current = queuedSave;
    await queuedSave;
  }, []);

  const changeReaderMode = useCallback(
    (readerMode: ReaderMode) => {
      void updateSettings({ ...settings, readerMode });
    },
    [settings, updateSettings],
  );

  const changeThemeMode = useCallback(
    (themeMode: ThemeMode) => {
      void updateSettings({ ...settings, themeMode });
    },
    [settings, updateSettings],
  );

  const changeReadingDirection = useCallback(
    (readingDirection: ReadingDirection) => {
      void updateSettings({ ...settings, readingDirection });
    },
    [settings, updateSettings],
  );

  const changePageGapMode = useCallback(
    (pageGapMode: PageGapMode) => {
      void updateSettings({ ...settings, pageGapMode });
    },
    [settings, updateSettings],
  );

  const changeLibrarySortMode = useCallback(
    (librarySortMode: LibrarySortMode) => {
      void updateSettings({ ...settings, librarySortMode });
    },
    [settings, updateSettings],
  );

  // 入参：更新后的根目录和书籍列表。副作用：短延迟合并保存书库，避免滚动时频繁写存储。
  const scheduleLibrarySave = useCallback((nextRootUri: string | null, nextBooks: Book[]) => {
    pendingLibraryState.current = { rootUri: nextRootUri, books: nextBooks };

    if (librarySaveTimer.current) {
      clearTimeout(librarySaveTimer.current);
    }

    librarySaveTimer.current = setTimeout(() => {
      const nextState = pendingLibraryState.current;

      pendingLibraryState.current = null;
      void (nextState ? saveLibrary(nextState) : Promise.resolve());
      librarySaveTimer.current = null;
    }, LIBRARY_SAVE_DEBOUNCE_MS);
  }, []);

  // 副作用：立即保存尚未落盘的书库尺寸缓存，用于关闭阅读器或卸载前收尾。
  const flushPendingLibrarySave = useCallback(async () => {
    const nextState = pendingLibraryState.current;

    if (!nextState) {
      return;
    }

    if (librarySaveTimer.current) {
      clearTimeout(librarySaveTimer.current);
      librarySaveTimer.current = null;
    }

    pendingLibraryState.current = null;
    await saveLibrary(nextState);
  }, []);

  const persistScannedLibrary = useCallback(async (nextRootUri: string) => {
    setIsScanning(true);
    setErrorMessage(null);
    await flushPendingLibrarySave();

    try {
      const scanResult = await scanLibrary(nextRootUri, books);
      const scannedBooks = scanResult.books;
      const nextPrivacyModeEnabled = await getPrivacyModeEnabled(nextRootUri);
      const nextBooks = mergeBooksWithCachedPageSizes(scannedBooks, books);
      const nextState = { rootUri: nextRootUri, books: nextBooks };

      setRootUri(nextRootUri);
      setBooks(nextBooks);
      setIsPrivacyModeEnabled(nextPrivacyModeEnabled);
      await saveLibrary(nextState);

      if (scanResult.warnings.length > 0) {
        const warningPreview = scanResult.warnings.slice(0, 3).join('\n');
        const remainingWarningCount = Math.max(0, scanResult.warnings.length - 3);
        const remainingWarningText = remainingWarningCount > 0 ? `\n另有 ${remainingWarningCount} 项` : '';

        setErrorMessage(
          `扫描完成，但有 ${scanResult.warnings.length} 项未更新：\n${warningPreview}${remainingWarningText}`,
        );
      } else if (nextBooks.length === 0) {
        setErrorMessage('没有找到图片文件夹或 ZIP/CBZ。请确认目录结构和文件格式正确。');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '扫描目录失败');
    } finally {
      setIsScanning(false);
    }
  }, [books, flushPendingLibrarySave]);

  const chooseRootDirectory = useCallback(async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('仅支持安卓目录选择', 'Expo 的本地目录授权在 Android 上可用。');
      return;
    }

    const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();

    if (!permission.granted) {
      return;
    }

    await persistScannedLibrary(permission.directoryUri);
  }, [persistScannedLibrary]);

  const refreshLibrary = useCallback(async () => {
    if (!rootUri) {
      await chooseRootDirectory();
      return;
    }

    await persistScannedLibrary(rootUri);
  }, [chooseRootDirectory, persistScannedLibrary, rootUri]);

  // 入参：待删除书籍。副作用：删除本地目录，并同步移除书架与阅读进度。
  const deleteBook = useCallback(
    async (book: Book) => {
      await flushPendingLibrarySave();
      setErrorMessage(null);

      try {
        await StorageAccessFramework.deleteAsync(book.uri, { idempotent: true });

        const isDeletingRootBook = book.uri === rootUri;
        const nextRootUri = isDeletingRootBook ? null : rootUri;
        const nextBooks = isDeletingRootBook ? [] : books.filter((currentBook) => currentBook.id !== book.id);
        const nextProgress = { ...progressRef.current };
        delete nextProgress[book.id];

        setRootUri(nextRootUri);
        setBooks(nextBooks);
        progressRef.current = nextProgress;
        setProgress(nextProgress);

        if (isDeletingRootBook) {
          setIsPrivacyModeEnabled(false);
        }

        if (selectedBook?.id === book.id) {
          setSelectedBook(null);
        }

        if (reader?.book.id === book.id) {
          setReader(null);
        }

        await Promise.all([
          saveLibrary({ rootUri: nextRootUri, books: nextBooks }),
          saveProgressInOrder(nextProgress),
          book.sourceType === 'archive' ? clearArchiveCache(book.uri) : Promise.resolve(),
        ]);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : `删除《${book.title}》失败`);
      }
    },
    [books, flushPendingLibrarySave, reader?.book.id, rootUri, saveProgressInOrder, selectedBook?.id],
  );

  // 入参：待删除书籍。副作用：二次确认后触发本地文件删除。
  const confirmDeleteBook = useCallback(
    (book: Book) => {
      Alert.alert(
        '删除漫画',
        `确定删除《${book.title}》吗？这会同步删除本地文件，无法在 App 内撤销。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: () => void deleteBook(book),
          },
        ],
      );
    },
    [deleteBook],
  );

  // 入参：图片原始尺寸。副作用：写入对应章节的尺寸缓存，用于下次中间页恢复时直接计算 offset。
  const updatePageSize = useCallback(
    (bookId: string, chapterIndex: number, uri: string, size: PageSize) => {
      if (size.width <= 0 || size.height <= 0) {
        return;
      }

      setBooks((currentBooks) => {
        let didChange = false;
        const nextBooks = currentBooks.map((book) => {
          if (book.id !== bookId) {
            return book;
          }

          const chapter = book.chapters[chapterIndex];
          const currentSize = chapter?.pageSizes?.[uri];

          if (!chapter || (currentSize?.width === size.width && currentSize.height === size.height)) {
            return book;
          }

          didChange = true;
          const nextChapters = [...book.chapters];
          nextChapters[chapterIndex] = {
            ...chapter,
            pageSizes: {
              ...(chapter.pageSizes ?? {}),
              [uri]: size,
            },
          };

          return {
            ...book,
            chapters: nextChapters,
          };
        });

        if (didChange) {
          scheduleLibrarySave(rootUri, nextBooks);
        }

        return didChange ? nextBooks : currentBooks;
      });
    },
    [rootUri, scheduleLibrarySave],
  );

  const togglePrivacyMode = useCallback(async () => {
    if (!rootUri) {
      await chooseRootDirectory();
      return;
    }

    try {
      const nextEnabled = isPrivacyModeEnabled
        ? await disablePrivacyMode(rootUri)
        : await enablePrivacyMode(rootUri);

      setIsPrivacyModeEnabled(nextEnabled);
      Alert.alert(
        nextEnabled ? '隐私模式已开启' : '隐私模式已关闭',
        nextEnabled
          ? '已在漫画根目录创建 .nomedia。系统相册会跳过该目录，App 仍可读取。'
          : '已删除 .nomedia。系统相册可能需要一段时间后才重新显示这些图片。',
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '切换隐私模式失败');
    }
  }, [chooseRootDirectory, isPrivacyModeEnabled, rootUri]);

  const openReader = useCallback(
    (book: Book, chapterIndex?: number, pageIndex?: number) => {
      const saved = progressRef.current[book.id] ?? { chapterIndex: 0, pageIndex: 0 };
      const nextChapterIndex = Math.min(chapterIndex ?? saved.chapterIndex, book.chapters.length - 1);
      const chapter = book.chapters[nextChapterIndex];
      const nextPageIndex = Math.min(pageIndex ?? saved.pageIndex, chapter.pages.length - 1);

      setSelectedBook(null);
      setReader({
        book,
        chapterIndex: Math.max(0, nextChapterIndex),
        pageIndex: Math.max(0, nextPageIndex),
      });
    },
    [],
  );

  const continueReading = useCallback(() => {
    if (!continueEntry) {
      return;
    }

    openReader(continueEntry.book);
  }, [continueEntry, openReader]);

  // 入参：新的阅读位置。副作用：更新 UI 状态并按顺序持久化每本书的阅读进度。
  const updateReaderPage = useCallback(
    async (nextReader: ReaderState) => {
      setReader(nextReader);

      const nextProgress = {
        ...progressRef.current,
        [nextReader.book.id]: {
          chapterIndex: nextReader.chapterIndex,
          pageIndex: nextReader.pageIndex,
          updatedAt: Date.now(),
        },
      };

      progressRef.current = nextProgress;
      setProgress(nextProgress);

      try {
        await saveProgressInOrder(nextProgress);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '保存阅读进度失败');
      }
    },
    [saveProgressInOrder],
  );

  const goToNextPage = useCallback(async () => {
    if (!reader) {
      return;
    }

    const chapter = reader.book.chapters[reader.chapterIndex];

    if (reader.pageIndex < chapter.pages.length - 1) {
      await updateReaderPage({ ...reader, pageIndex: reader.pageIndex + 1 });
      return;
    }

    if (reader.chapterIndex < reader.book.chapters.length - 1) {
      await updateReaderPage({ ...reader, chapterIndex: reader.chapterIndex + 1, pageIndex: 0 });
    }
  }, [reader, updateReaderPage]);

  const goToPreviousPage = useCallback(async () => {
    if (!reader) {
      return;
    }

    if (reader.pageIndex > 0) {
      await updateReaderPage({ ...reader, pageIndex: reader.pageIndex - 1 });
      return;
    }

    if (reader.chapterIndex > 0) {
      const previousChapter = reader.book.chapters[reader.chapterIndex - 1];

      await updateReaderPage({
        ...reader,
        chapterIndex: reader.chapterIndex - 1,
        pageIndex: previousChapter.pages.length - 1,
      });
    }
  }, [reader, updateReaderPage]);

  useEffect(() => {
    let isMounted = true;

    const restore = async () => {
      try {
        const [storedLibrary, storedProgress, storedSettings] = await Promise.all([
          loadStoredLibrary(),
          loadProgress(),
          loadSettings(),
        ]);

        if (!isMounted) {
          return;
        }

        setRootUri(storedLibrary.rootUri);
        setBooks(storedLibrary.books);
        progressRef.current = storedProgress;
        setProgress(storedProgress);
        setSettings(storedSettings);

        if (storedLibrary.rootUri) {
          setIsPrivacyModeEnabled(await getPrivacyModeEnabled(storedLibrary.rootUri));
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '读取本地书架失败');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void restore();

    return () => {
      isMounted = false;

      if (librarySaveTimer.current) {
        clearTimeout(librarySaveTimer.current);
      }

      void flushPendingLibrarySave();
    };
  }, [flushPendingLibrarySave]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />
      <View style={[styles.header, { backgroundColor: colors.header, paddingTop: insets.top + 10 }]}>
        <View style={styles.titleRow}>
          <View>
          <Text style={styles.appTitle}>本地漫画</Text>
          <Text style={styles.appSubtitle}>
            {rootUri ? `${books.length} 本书 · ${isPrivacyModeEnabled ? '隐私模式' : '普通模式'}` : '未选择目录'}
          </Text>
          <Text style={styles.appVersion}>v{APP_VERSION}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="刷新书架"
              disabled={isScanning}
              onPress={() => void refreshLibrary()}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: '#263241' },
                pressed && styles.pressed,
                isScanning && styles.disabled,
              ]}
            >
              <Text style={styles.secondaryButtonText}>{isScanning ? '扫描中' : '刷新'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新选择目录"
              onPress={chooseRootDirectory}
              style={({ pressed }) => [styles.secondaryButton, { backgroundColor: '#263241' }, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryButtonText}>目录</Text>
            </Pressable>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: isPrivacyModeEnabled }}
              accessibilityLabel="切换隐私模式"
              onPress={() => void togglePrivacyMode()}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: isPrivacyModeEnabled ? colors.primary : '#263241' },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>隐私</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {errorMessage ? (
        <Text style={[styles.errorText, { backgroundColor: colors.dangerSurface, color: colors.dangerText }]}>
          {errorMessage}
        </Text>
      ) : null}
      <LibraryView
        colors={colors}
        books={visibleBooks}
        progress={progress}
        searchQuery={searchQuery}
        sortMode={settings.librarySortMode}
        continueBook={continueEntry?.book ?? null}
        continueProgress={continueEntry?.progress ?? null}
        isLoading={isLoading}
        isScanning={isScanning}
        bottomInset={insets.bottom}
        onChooseRootDirectory={chooseRootDirectory}
        onSelectBook={setSelectedBook}
        onContinueReading={continueReading}
        onSearchQueryChange={setSearchQuery}
        onSortModeChange={changeLibrarySortMode}
      />
      <BookDetailModal
        colors={colors}
        book={selectedBook}
        progress={selectedProgress}
        onClose={() => setSelectedBook(null)}
        onOpenReader={openReader}
        onDeleteBook={confirmDeleteBook}
      />
      <ReaderModal
        colors={colors}
        reader={reader}
        readerMode={settings.readerMode}
        readingDirection={settings.readingDirection}
        pageGapMode={settings.pageGapMode}
        onClose={() => {
          void flushPendingLibrarySave();
          setReader(null);
        }}
        onReaderChange={(nextReader) => void updateReaderPage(nextReader)}
        onReaderModeChange={changeReaderMode}
        onReadingDirectionChange={changeReadingDirection}
        onPageGapModeChange={changePageGapMode}
        onPageSizeChange={updatePageSize}
        themeMode={settings.themeMode}
        onThemeModeChange={changeThemeMode}
        onNextPage={() => void goToNextPage()}
        onPreviousPage={() => void goToPreviousPage()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  appSubtitle: {
    color: '#B8C1CC',
    fontSize: 13,
    marginTop: 4,
  },
  appVersion: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 52,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  activeSecondaryButtonText: {
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.55,
  },
  errorText: {
    borderRadius: radii.md,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    marginBottom: 12,
    marginHorizontal: 20,
    padding: 12,
  },
  pressed: {
    opacity: 0.72,
  },
});
