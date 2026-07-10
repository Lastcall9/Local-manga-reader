import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { radii, type ColorScheme } from '../styles/theme';
import type { Book, LibrarySortMode, ProgressMap, ReadingProgress } from '../types/library';

type LibraryViewProps = {
  colors: ColorScheme;
  books: Book[];
  progress: ProgressMap;
  searchQuery: string;
  sortMode: LibrarySortMode;
  continueBook: Book | null;
  continueProgress: ReadingProgress | null;
  isLoading: boolean;
  isScanning: boolean;
  bottomInset: number;
  onChooseRootDirectory: () => void;
  onSelectBook: (book: Book) => void;
  onContinueReading: () => void;
  onSearchQueryChange: (query: string) => void;
  onSortModeChange: (mode: LibrarySortMode) => void;
};

export const LibraryView = ({
  colors,
  books,
  progress,
  searchQuery,
  sortMode,
  continueBook,
  continueProgress,
  isLoading,
  isScanning,
  bottomInset,
  onChooseRootDirectory,
  onSelectBook,
  onContinueReading,
  onSearchQueryChange,
  onSortModeChange,
}: LibraryViewProps) => {
  if (isLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.stateText, { color: colors.textMuted }]}>正在读取书架</Text>
      </View>
    );
  }

  if (books.length === 0) {
    return (
      <View style={[styles.emptyState, { paddingBottom: bottomInset + 20 }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>选择漫画目录</Text>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          支持“漫画名/章节/图片”、“漫画名/图片”，也可将 ZIP/CBZ 放在根目录。隐私模式会阻止相册索引。
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="选择漫画根目录"
          onPress={onChooseRootDirectory}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.readerText }]}>选择目录</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.libraryShell}>
      {isScanning ? (
        <View style={[styles.scanBar, { backgroundColor: colors.primarySoft }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.scanText, { color: colors.primary }]}>正在刷新书架，首次读取 ZIP/CBZ 可能较慢</Text>
        </View>
      ) : null}
      {continueBook && continueProgress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`继续阅读 ${continueBook.title}`}
          onPress={onContinueReading}
          style={({ pressed }) => [
            styles.continueBar,
            { backgroundColor: colors.surface },
            pressed && styles.pressed,
          ]}
        >
          <Image source={{ uri: continueBook.coverUri }} style={styles.continueCover} resizeMode="cover" />
          <View style={styles.continueInfo}>
            <Text style={[styles.continueLabel, { color: colors.primary }]}>继续阅读</Text>
            <Text numberOfLines={1} style={[styles.continueTitle, { color: colors.text }]}>
              {continueBook.title}
            </Text>
            <Text numberOfLines={1} style={[styles.continueMeta, { color: colors.textSubtle }]}>
              {continueBook.chapters[continueProgress.chapterIndex]?.title ?? '正文'} · 第 {continueProgress.pageIndex + 1} 页
            </Text>
          </View>
          <Text style={[styles.continueAction, { color: colors.primary }]}>打开</Text>
        </Pressable>
      ) : null}
      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="搜索漫画"
          value={searchQuery}
          onChangeText={onSearchQueryChange}
          placeholder="搜索漫画"
          placeholderTextColor={colors.textSubtle}
          style={[styles.searchInput, { backgroundColor: colors.surface, color: colors.text }]}
        />
        <View style={styles.sortRow}>
          {[
            { label: '最近', value: 'recent' },
            { label: '名称', value: 'name' },
            { label: '页数', value: 'pages' },
          ].map((option) => {
            const isActive = sortMode === option.value;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                key={option.value}
                onPress={() => onSortModeChange(option.value as LibrarySortMode)}
                style={({ pressed }) => [
                  styles.sortButton,
                  { backgroundColor: isActive ? colors.primary : colors.surface },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.sortButtonText, { color: isActive ? colors.readerText : colors.textMuted }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <FlatList
        data={books}
        ListEmptyComponent={
          <View style={styles.noResultState}>
            <Text style={[styles.noResultText, { color: colors.textMuted }]}>没有匹配的漫画</Text>
          </View>
        }
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => {
          const saved = progress[item.id];
          const chapterTitle = saved ? item.chapters[saved.chapterIndex]?.title : null;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`打开 ${item.title}`}
              onPress={() => onSelectBook(item)}
              style={({ pressed }) => [styles.bookTile, pressed && styles.pressed]}
            >
              <View style={[styles.coverWrap, { backgroundColor: colors.coverPlaceholder }]}>
                <Image source={{ uri: item.coverUri }} style={styles.cover} resizeMode="cover" />
                <View style={styles.coverBadge}>
                  <Text style={[styles.coverBadgeText, { color: colors.readerText }]}>{item.chapters.length}章</Text>
                </View>
              </View>
              <Text numberOfLines={2} style={[styles.bookTitle, { color: colors.text }]}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={[styles.bookProgress, { color: colors.textSubtle }]}>
                {chapterTitle && saved ? `读到 ${saved.pageIndex + 1} 页` : `${item.pageCount} 页`}
              </Text>
            </Pressable>
          );
        }}
        contentContainerStyle={[styles.bookList, { paddingBottom: bottomInset + 24 }]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateText: {
    fontSize: 16,
    marginTop: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 34,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 22,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
  libraryShell: {
    flex: 1,
  },
  scanBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  scanText: {
    fontSize: 13,
    fontWeight: '700',
  },
  continueBar: {
    alignItems: 'center',
    borderRadius: radii.md,
    elevation: 1,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    minHeight: 82,
    padding: 10,
  },
  continueCover: {
    borderRadius: radii.sm,
    height: 62,
    width: 44,
  },
  continueInfo: {
    flex: 1,
  },
  continueLabel: {
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 3,
  },
  continueTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  continueMeta: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  continueAction: {
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 4,
  },
  toolbar: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchInput: {
    borderRadius: radii.md,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 14,
  },
  sortRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sortButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '900',
  },
  bookList: {
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  noResultState: {
    alignItems: 'center',
    paddingTop: 48,
  },
  noResultText: {
    fontSize: 15,
    fontWeight: '700',
  },
  gridRow: {
    gap: 12,
    marginBottom: 18,
  },
  bookTile: {
    flex: 1,
    maxWidth: '31.8%',
  },
  coverWrap: {
    borderRadius: radii.md,
    elevation: 2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
  },
  cover: {
    aspectRatio: 0.72,
    width: '100%',
  },
  coverBadge: {
    backgroundColor: 'rgba(17, 24, 39, 0.78)',
    borderRadius: radii.sm,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
    right: 6,
  },
  coverBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 8,
  },
  bookProgress: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
});
