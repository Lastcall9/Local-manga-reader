import { StatusBar } from 'expo-status-bar';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, type ColorScheme } from '../styles/theme';
import type {
  PageGapMode,
  PageSize,
  ReaderMode,
  ReaderState,
  ReadingDirection,
  ThemeMode,
} from '../types/library';
import { SegmentedControl } from './SegmentedControl';

const DEFAULT_SCROLL_PAGE_RATIO = 1.42;
const DRAG_SCROLL_INTERVAL_MS = 40;
const SIDE_PROGRESS_TOP_OFFSET = 88;
const SIDE_PROGRESS_BOTTOM_OFFSET = 68;
const SIDE_PROGRESS_THUMB_SIZE = 34;
const INITIAL_SIZE_PREFETCH_RADIUS = 4;
const PAGE_SIZE_CACHE_LIMIT = 1600;

type PageLayout = {
  index: number;
  length: number;
  offset: number;
};

const pageSizeCache = new Map<string, PageSize>();

// 入参：图片地址与原始尺寸。返回值：可复用的尺寸缓存；无效尺寸返回 null。
const rememberPageSize = (uri: string, width: number, height: number) => {
  if (width <= 0 || height <= 0) {
    return null;
  }

  if (pageSizeCache.has(uri)) {
    pageSizeCache.delete(uri);
  } else if (pageSizeCache.size >= PAGE_SIZE_CACHE_LIMIT) {
    const oldestUri = pageSizeCache.keys().next().value;

    if (oldestUri !== undefined) {
      pageSizeCache.delete(oldestUri);
    }
  }

  const size = { height, width };
  pageSizeCache.set(uri, size);

  return size;
};

// 入参：章节图片地址。返回值：当前进程已知的尺寸，用于避免再次进入时从空布局开始。
const getCachedPageSizes = (pages: string[], persistedSizes: Record<string, PageSize> = {}) =>
  pages.reduce<Record<string, PageSize>>((sizes, uri) => {
    const size = pageSizeCache.get(uri) ?? persistedSizes[uri];

    if (size) {
      sizes[uri] = size;
      rememberPageSize(uri, size.width, size.height);
    }

    return sizes;
  }, {});

// 入参：章节页与当前页。返回：需要优先测量的附近页面。
const getNearbyPageUris = (pages: string[], pageIndex: number) => {
  const nearbyUris: string[] = [];
  const addedUris = new Set<string>();
  const safePageIndex = Math.min(pages.length - 1, Math.max(0, pageIndex));
  const addPage = (nextPageIndex: number) => {
    const uri = pages[nextPageIndex];

    if (!uri || addedUris.has(uri)) {
      return;
    }

    nearbyUris.push(uri);
    addedUris.add(uri);
  };

  for (let distance = 0; distance <= INITIAL_SIZE_PREFETCH_RADIUS; distance += 1) {
    addPage(safePageIndex + distance);
    addPage(safePageIndex - distance);
  }

  return nearbyUris;
};

type ReaderModalProps = {
  colors: ColorScheme;
  reader: ReaderState | null;
  readerMode: ReaderMode;
  readingDirection: ReadingDirection;
  pageGapMode: PageGapMode;
  onClose: () => void;
  onReaderChange: (reader: ReaderState) => void;
  onReaderModeChange: (mode: ReaderMode) => void;
  onReadingDirectionChange: (direction: ReadingDirection) => void;
  onPageGapModeChange: (mode: PageGapMode) => void;
  onPageSizeChange: (bookId: string, chapterIndex: number, uri: string, size: PageSize) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
};

export const ReaderModal = ({
  colors,
  reader,
  readerMode,
  readingDirection,
  pageGapMode,
  onClose,
  onReaderChange,
  onReaderModeChange,
  onReadingDirectionChange,
  onPageGapModeChange,
  onPageSizeChange,
  themeMode,
  onThemeModeChange,
  onNextPage,
  onPreviousPage,
}: ReaderModalProps) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<FlashListRef<string>>(null);
  const reportedPageSizeKeys = useRef(new Set<string>());
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const draggingPageIndex = useRef<number | null>(null);
  const isScrubbingProgress = useRef(false);
  const lastDragScrollAt = useRef(0);
  const committedVisiblePageIndex = useRef(reader?.pageIndex ?? 0);
  const [isOverlayVisible, setIsOverlayVisible] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isChapterSheetVisible, setIsChapterSheetVisible] = useState(false);
  const [isScrollListReady, setIsScrollListReady] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState<number | null>(null);
  const [visibleScrollPageIndex, setVisibleScrollPageIndex] = useState(reader?.pageIndex ?? 0);
  const [pageSizes, setPageSizes] = useState<Record<string, PageSize>>({});
  const activeChapter = reader ? reader.book.chapters[reader.chapterIndex] : null;
  const chapterKey = reader && activeChapter
    ? `${reader.book.id}:${activeChapter.id}:${activeChapter.pages.length}`
    : '';
  const activeBookId = reader?.book.id ?? '';
  const activeChapterIndex = reader?.chapterIndex ?? 0;
  const pageGap = pageGapMode === 'none' ? 0 : pageGapMode === 'small' ? 8 : 16;
  const progressTrackTop = insets.top + SIDE_PROGRESS_TOP_OFFSET;
  const progressTrackBottom = insets.bottom + SIDE_PROGRESS_BOTTOM_OFFSET;
  const progressTrackHeight = Math.max(1, height - progressTrackTop - progressTrackBottom);
  const progressThumbTravel = Math.max(1, progressTrackHeight - SIDE_PROGRESS_THUMB_SIZE);
  const getKnownPageSize = (uri: string) => pageSizes[uri] ?? pageSizeCache.get(uri) ?? activeChapter?.pageSizes?.[uri];

  // 入参：图片原始尺寸。返回值：长滚动模式下按屏宽等比缩放后的 item 高度。
  const getScaledPageHeight = (size: PageSize | undefined) => {
    if (!size || size.width <= 0 || size.height <= 0) {
      return Math.max(1, Math.round(width * DEFAULT_SCROLL_PAGE_RATIO)) + pageGap;
    }

    return Math.max(1, Math.round((width * size.height) / size.width)) + pageGap;
  };

  const pageLayouts = useMemo<PageLayout[]>(() => {
    const pages = activeChapter?.pages ?? [];

    return pages.reduce<PageLayout[]>((layouts, uri, index) => {
      const previousLayout = layouts[index - 1];
      const offset = previousLayout ? previousLayout.offset + previousLayout.length : 0;

      layouts.push({
        index,
        length: getScaledPageHeight(getKnownPageSize(uri)),
        offset,
      });

      return layouts;
    }, []);
  }, [chapterKey, pageGap, pageSizes, width]);

  const restorePageIndex = reader ? reader.pageIndex : 0;

  // 入参：图片原始尺寸。副作用：更新内存尺寸缓存，并把变化上报给书库持久化。
  const recordPageSize = useCallback(
    (uri: string, imageWidth: number, imageHeight: number) => {
      const nextSize = rememberPageSize(uri, imageWidth, imageHeight);

      if (!nextSize) {
        return;
      }

      setPageSizes((currentSizes) => {
        const currentSize = currentSizes[uri];

        if (currentSize?.width === imageWidth && currentSize.height === imageHeight) {
          return currentSizes;
        }

        return {
          ...currentSizes,
          [uri]: nextSize,
        };
      });

      const sizeKey = `${uri}:${nextSize.width}x${nextSize.height}`;

      if (!reportedPageSizeKeys.current.has(sizeKey)) {
        reportedPageSizeKeys.current.add(sizeKey);
        onPageSizeChange(activeBookId, activeChapterIndex, uri, nextSize);
      }
    },
    [activeBookId, activeChapterIndex, onPageSizeChange],
  );

  useEffect(() => {
    setIsOverlayVisible(false);
    setIsSettingsVisible(false);
    setIsChapterSheetVisible(false);
    setPreviewPageIndex(null);
    setVisibleScrollPageIndex(reader?.pageIndex ?? 0);
    committedVisiblePageIndex.current = reader?.pageIndex ?? 0;
    setPageSizes(getCachedPageSizes(activeChapter?.pages ?? [], activeChapter?.pageSizes));
    reportedPageSizeKeys.current.clear();
    setIsScrollListReady(readerMode !== 'scroll');
    draggingPageIndex.current = null;
    isScrubbingProgress.current = false;
  }, [chapterKey, readerMode]);

  useEffect(() => {
    if (!activeChapter || readerMode !== 'scroll') {
      return;
    }

    let isCancelled = false;
    const nearbyUris = getNearbyPageUris(activeChapter.pages, visibleScrollPageIndex);

    nearbyUris.forEach((uri) => {
      if (pageSizeCache.has(uri)) {
        return;
      }

      Image.getSize(
        uri,
        (imageWidth, imageHeight) => {
          if (isCancelled || imageWidth <= 0 || imageHeight <= 0) {
            return;
          }

          recordPageSize(uri, imageWidth, imageHeight);
        },
        () => undefined,
      );
    });

    return () => {
      isCancelled = true;
    };
  }, [activeChapter, readerMode, recordPageSize, visibleScrollPageIndex]);

  if (!reader || !activeChapter) {
    return null;
  }

  const chapter = activeChapter;
  const pageUri = chapter.pages[reader.pageIndex];
  const visiblePageIndex =
    isScrubbingProgress.current && previewPageIndex !== null
      ? previewPageIndex
      : readerMode === 'scroll'
        ? visibleScrollPageIndex
        : reader.pageIndex;
  const progressRatio = chapter.pages.length <= 1 ? 0 : visiblePageIndex / (chapter.pages.length - 1);
  const progressFillHeight = progressRatio * progressTrackHeight;
  const progressThumbTop = progressRatio * progressThumbTravel;
  const isScrollReaderLoading = readerMode === 'scroll' && !isScrollListReady;

  const updateVisibleReadingPosition = (nextPageIndex: number) => {
    if (isScrubbingProgress.current) {
      return;
    }

    const safePageIndex = Math.min(chapter.pages.length - 1, Math.max(0, nextPageIndex));

    setVisibleScrollPageIndex((currentPageIndex) =>
      currentPageIndex === safePageIndex ? currentPageIndex : safePageIndex,
    );
    committedVisiblePageIndex.current = safePageIndex;
  };

  const commitVisibleReadingPosition = () => {
    if (isScrubbingProgress.current) {
      return;
    }

    const safePageIndex = Math.min(chapter.pages.length - 1, Math.max(0, committedVisiblePageIndex.current));

    if (safePageIndex !== reader.pageIndex) {
      onReaderChange({ ...reader, pageIndex: safePageIndex });
    }
  };

  const scrollToPageIndex = (nextPageIndex: number) => {
    const safePageIndex = Math.min(chapter.pages.length - 1, Math.max(0, nextPageIndex));
    const targetLayout = pageLayouts[safePageIndex];

    if (!targetLayout) {
      return;
    }

    // 进度条可能一次跨很多页，直接按估算 offset 跳转，避免未测量 item 的 index 跳转导致空白。
    scrollRef.current?.scrollToOffset({ animated: false, offset: targetLayout.offset, viewPosition: 0 });
  };

  const jumpToChapter = (chapterIndex: number) => {
    onReaderChange({ ...reader, chapterIndex, pageIndex: 0 });
    setIsChapterSheetVisible(false);
    setIsOverlayVisible(false);
  };

  const handleLeftPageTap = () => {
    if (readingDirection === 'rtl') {
      onNextPage();
      return;
    }

    onPreviousPage();
  };

  const handleRightPageTap = () => {
    if (readingDirection === 'rtl') {
      onPreviousPage();
      return;
    }

    onNextPage();
  };

  // 入参：进度条相对比例。返回值：限制在有效范围内的页码。
  const getPageIndexFromRatio = (ratio: number) => {
    const nextRatio = Math.min(1, Math.max(0, ratio));

    return Math.round(nextRatio * (chapter.pages.length - 1));
  };

  // 入参：触摸点屏幕 Y 坐标。返回值：基于进度条轨道的目标页码。
  const getPageIndexFromProgressY = (pageY: number) => {
    const trackY = Math.min(progressTrackHeight, Math.max(0, pageY - progressTrackTop));

    return getPageIndexFromRatio(trackY / progressTrackHeight);
  };

  // 入参：目标页码。副作用：拖动中只预览和节流滚动，松手后再保存进度。
  const previewJumpToPageIndex = (nextPageIndex: number) => {
    const now = Date.now();

    isScrubbingProgress.current = true;
    draggingPageIndex.current = nextPageIndex;
    setPreviewPageIndex(nextPageIndex);

    if (now - lastDragScrollAt.current > DRAG_SCROLL_INTERVAL_MS) {
      scrollToPageIndex(nextPageIndex);
      lastDragScrollAt.current = now;
    }
  };

  const beginProgressScrub = (pageY: number) => {
    lastDragScrollAt.current = 0;
    previewJumpToPageIndex(getPageIndexFromProgressY(pageY));
  };

  const commitDraggedPageIndex = () => {
    const nextPageIndex = draggingPageIndex.current;

    if (nextPageIndex === null) {
      isScrubbingProgress.current = false;
      return;
    }

    draggingPageIndex.current = null;
    isScrubbingProgress.current = false;
    setPreviewPageIndex(null);
    setVisibleScrollPageIndex(nextPageIndex);
    committedVisiblePageIndex.current = nextPageIndex;
    scrollToPageIndex(nextPageIndex);

    if (nextPageIndex !== reader.pageIndex) {
      onReaderChange({ ...reader, pageIndex: nextPageIndex });
    }
  };

  const toggleOverlayOnTap = (pageX: number, pageY: number) => {
    const start = touchStart.current;

    if (!start) {
      return;
    }

    const deltaX = Math.abs(pageX - start.x);
    const deltaY = Math.abs(pageY - start.y);
    const elapsed = Date.now() - start.time;

    if (deltaX < 8 && deltaY < 8 && elapsed < 260) {
      setIsOverlayVisible((visible) => !visible);
    }
  };

  const header = isOverlayVisible ? (
    <View style={[styles.readerHeader, { paddingTop: insets.top + 8, backgroundColor: 'rgba(2, 6, 23, 0.92)' }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭阅读器"
        onPress={onClose}
        style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.readerSurface }]}
      >
        <Text style={[styles.backText, { color: colors.readerText }]}>‹</Text>
      </Pressable>
      <View style={styles.readerTitleBox}>
        <Text numberOfLines={1} style={[styles.readerTitle, { color: colors.readerText }]}>
          {reader.book.title}
        </Text>
        <Text numberOfLines={1} style={[styles.readerSubtitle, { color: colors.readerMuted }]}>
          {chapter.title} · {visiblePageIndex + 1}/{chapter.pages.length}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="章节目录"
        onPress={() => setIsChapterSheetVisible(true)}
        style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.readerSurface }]}
      >
        <Text style={[styles.menuText, { color: colors.readerText }]}>☰</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="阅读设置"
        onPress={() => setIsSettingsVisible(true)}
        style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.readerSurface }]}
      >
        <Text style={[styles.gearText, { color: colors.readerText }]}>⚙</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <Modal animationType="fade" visible onRequestClose={onClose}>
      <View style={[styles.readerScreen, { backgroundColor: colors.readerBackground }]}>
        <StatusBar style="light" />
        {header}
        {readerMode === 'scroll' ? (
          <View
            style={styles.scrollReaderWrap}
            onTouchStart={(event) => {
              touchStart.current = {
                x: event.nativeEvent.pageX,
                y: event.nativeEvent.pageY,
                time: Date.now(),
              };
            }}
            onTouchEnd={(event) => toggleOverlayOnTap(event.nativeEvent.pageX, event.nativeEvent.pageY)}
          >
            <FlashList
              ref={scrollRef}
              data={chapter.pages}
              extraData={pageSizes}
              initialScrollIndex={restorePageIndex}
              initialScrollIndexParams={{ viewOffset: 0 }}
              keyExtractor={(item) => item}
              maintainVisibleContentPosition={{ disabled: true }}
              onLoad={() => setIsScrollListReady(true)}
              renderItem={({ item, index }) => {
                const pageHeight = getScaledPageHeight(getKnownPageSize(item));

                return (
                  <View style={[styles.scrollPage, { height: pageHeight, paddingVertical: pageGap / 2, width }]}>
                    <Image
                      source={{ uri: item }}
                      style={[
                        styles.scrollPageImage,
                        { height: pageHeight - pageGap, width },
                      ]}
                      resizeMode="contain"
                      onLoad={(event) => {
                        recordPageSize(item, event.nativeEvent.source.width, event.nativeEvent.source.height);
                      }}
                    />
                  </View>
                );
              }}
              showsVerticalScrollIndicator={false}
              onMomentumScrollEnd={commitVisibleReadingPosition}
              onScrollEndDrag={commitVisibleReadingPosition}
              viewabilityConfig={{ itemVisiblePercentThreshold: 35, minimumViewTime: 80 }}
              onViewableItemsChanged={({ viewableItems }) => {
                const firstVisibleIndex = viewableItems
                  .map((item) => item.index)
                  .filter((index): index is number => typeof index === 'number')
                  .sort((left, right) => left - right)[0];

                if (firstVisibleIndex !== undefined) {
                  updateVisibleReadingPosition(firstVisibleIndex);
                }
              }}
            />
            {isScrollReaderLoading ? (
              <View pointerEvents="none" style={styles.readerLoadingOverlay}>
                <View style={styles.readerLoadingIndicator}>
                  <ActivityIndicator color={colors.readerText} size="large" />
                  <Text style={[styles.readerLoadingText, { color: colors.readerMuted }]}>
                    {restorePageIndex + 1}/{chapter.pages.length}
                  </Text>
                </View>
              </View>
            ) : null}
            {isOverlayVisible ? (
              <View
                style={[
                  styles.sideProgressTouchArea,
                  {
                    bottom: progressTrackBottom,
                    top: progressTrackTop,
                  },
                ]}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={(event) => {
                  beginProgressScrub(event.nativeEvent.pageY);
                }}
                onResponderMove={(event) => {
                  previewJumpToPageIndex(getPageIndexFromProgressY(event.nativeEvent.pageY));
                }}
                onResponderRelease={commitDraggedPageIndex}
                onResponderTerminate={commitDraggedPageIndex}
              >
                <View style={[styles.sideProgressTrack, { backgroundColor: 'rgba(15, 23, 42, 0.72)' }]}>
                  <View
                    style={[
                      styles.sideProgressFill,
                      { backgroundColor: colors.primary, height: progressFillHeight },
                    ]}
                  />
                </View>
                <View
                  style={[
                    styles.sideProgressThumb,
                    { backgroundColor: colors.readerText, top: progressThumbTop },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel="点击右半屏下一页，左半屏上一页"
            onPress={(event) => {
              const { locationX, pageX } = event.nativeEvent;
              const tapX = locationX || pageX;
              const centerLeft = width * 0.32;
              const centerRight = width * 0.68;

              if (tapX > centerLeft && tapX < centerRight) {
                setIsOverlayVisible((visible) => !visible);
                return;
              }

              if (tapX < width / 2) {
                handleLeftPageTap();
                return;
              }

              handleRightPageTap();
            }}
            style={styles.readerImageWrap}
          >
            <Image source={{ uri: pageUri }} style={styles.readerImage} resizeMode="contain" />
          </Pressable>
        )}
        {isOverlayVisible ? (
          <View style={[styles.readerFooter, { paddingBottom: insets.bottom + 10 }]}>
            {readerMode === 'paged' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="上一页"
                onPress={onPreviousPage}
                style={({ pressed }) => [
                  styles.readerNavButton,
                  { borderColor: colors.readerBorder },
                  pressed && { backgroundColor: colors.readerSurface },
                ]}
              >
                <Text style={[styles.readerNavText, { color: colors.readerText }]}>上一页</Text>
              </Pressable>
            ) : (
              <View style={styles.readerNavSpacer} />
            )}
            <Text style={[styles.readerCount, { color: colors.readerMuted }]}>
              {visiblePageIndex + 1}/{chapter.pages.length} 页
            </Text>
            {readerMode === 'paged' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="下一页"
                onPress={onNextPage}
                style={({ pressed }) => [
                  styles.readerNavButton,
                  { borderColor: colors.readerBorder },
                  pressed && { backgroundColor: colors.readerSurface },
                ]}
              >
                <Text style={[styles.readerNavText, { color: colors.readerText }]}>下一页</Text>
              </Pressable>
            ) : (
              <View style={styles.readerNavSpacer} />
            )}
          </View>
        ) : null}
        {isSettingsVisible ? (
          <View style={styles.sheetBackdrop}>
            <Pressable style={styles.sheetScrim} onPress={() => setIsSettingsVisible(false)} />
            <View
              style={[
                styles.settingsSheet,
                { backgroundColor: colors.surface, paddingBottom: insets.bottom + 18 },
              ]}
            >
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: colors.text }]}>阅读设置</Text>
              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>阅读方式</Text>
              <SegmentedControl<ReaderMode>
                colors={colors}
                value={readerMode}
                options={[
                  { label: '滚动', value: 'scroll' },
                  { label: '翻页', value: 'paged' },
                ]}
                onChange={onReaderModeChange}
              />
              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>翻页方向</Text>
              <SegmentedControl<ReadingDirection>
                colors={colors}
                value={readingDirection}
                options={[
                  { label: '日漫', value: 'rtl' },
                  { label: '普通', value: 'ltr' },
                ]}
                onChange={onReadingDirectionChange}
              />
              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>页间距</Text>
              <SegmentedControl<PageGapMode>
                colors={colors}
                value={pageGapMode}
                options={[
                  { label: '无', value: 'none' },
                  { label: '小', value: 'small' },
                  { label: '中', value: 'medium' },
                ]}
                onChange={onPageGapModeChange}
              />
              <Text style={[styles.sheetLabel, { color: colors.textMuted }]}>主题</Text>
              <SegmentedControl<ThemeMode>
                colors={colors}
                value={themeMode}
                options={[
                  { label: '系统', value: 'system' },
                  { label: '浅色', value: 'light' },
                  { label: '深色', value: 'dark' },
                ]}
                onChange={onThemeModeChange}
              />
            </View>
          </View>
        ) : null}
        {isChapterSheetVisible ? (
          <View style={styles.sheetBackdrop}>
            <Pressable style={styles.sheetScrim} onPress={() => setIsChapterSheetVisible(false)} />
            <View
              style={[
                styles.chapterSheet,
                { backgroundColor: colors.surface, paddingBottom: insets.bottom + 18 },
              ]}
            >
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: colors.text }]}>章节目录</Text>
              <ScrollView style={styles.chapterList} showsVerticalScrollIndicator={false}>
                {reader.book.chapters.map((bookChapter, index) => {
                  const isActive = index === reader.chapterIndex;

                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={`跳转到 ${bookChapter.title}`}
                      key={bookChapter.id}
                      onPress={() => jumpToChapter(index)}
                      style={({ pressed }) => [
                        styles.chapterRow,
                        { backgroundColor: isActive ? colors.primarySoft : colors.surfaceMuted },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.chapterInfo}>
                        <Text numberOfLines={1} style={[styles.chapterTitle, { color: colors.text }]}>
                          {bookChapter.title}
                        </Text>
                        <Text style={[styles.chapterMeta, { color: colors.textSubtle }]}>
                          {bookChapter.pages.length} 页
                        </Text>
                      </View>
                      {isActive ? (
                        <Text style={[styles.chapterActiveText, { color: colors.primary }]}>当前</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  readerScreen: {
    flex: 1,
  },
  readerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 10,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 48,
    width: 48,
  },
  backText: {
    fontSize: 36,
    lineHeight: 40,
  },
  gearText: {
    fontSize: 22,
    lineHeight: 26,
  },
  menuText: {
    fontSize: 22,
    lineHeight: 26,
  },
  readerTitleBox: {
    flex: 1,
  },
  readerTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  readerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  readerImageWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  readerImage: {
    height: '100%',
    width: '100%',
  },
  scrollReaderWrap: {
    flex: 1,
  },
  scrollPage: {
    alignItems: 'center',
  },
  scrollPageImage: {
    alignSelf: 'center',
  },
  readerLoadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 8,
  },
  readerLoadingIndicator: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    position: 'absolute',
  },
  readerLoadingText: {
    fontSize: 12,
    fontWeight: '800',
  },
  sideProgressTrack: {
    borderRadius: 999,
    height: '100%',
    overflow: 'hidden',
    width: 14,
  },
  sideProgressTouchArea: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 56,
    zIndex: 12,
  },
  sideProgressFill: {
    borderRadius: 999,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sideProgressThumb: {
    borderRadius: 999,
    height: SIDE_PROGRESS_THUMB_SIZE,
    left: 11,
    position: 'absolute',
    width: SIDE_PROGRESS_THUMB_SIZE,
  },
  readerFooter: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.86)',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
  readerNavButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 14,
  },
  readerNavSpacer: {
    minWidth: 88,
  },
  readerNavText: {
    fontSize: 15,
    fontWeight: '800',
  },
  readerCount: {
    fontSize: 13,
  },
  sheetBackdrop: {
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  sheetScrim: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  settingsSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  chapterSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '72%',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  chapterList: {
    marginTop: 6,
  },
  chapterRow: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chapterInfo: {
    flex: 1,
    paddingRight: 10,
  },
  chapterTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  chapterMeta: {
    fontSize: 12,
    marginTop: 4,
  },
  chapterActiveText: {
    fontSize: 12,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#94A3B8',
    borderRadius: 999,
    height: 4,
    marginBottom: 4,
    width: 42,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  sheetLabel: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 6,
  },
});
