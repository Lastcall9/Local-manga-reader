import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, type ColorScheme } from '../styles/theme';
import type { Book, ReadingProgress } from '../types/library';

const DELETE_BUTTON_BACKGROUND = '#DC2626';
const DELETE_BUTTON_TEXT = '#FFFFFF';

type BookDetailModalProps = {
  colors: ColorScheme;
  book: Book | null;
  progress: ReadingProgress | null;
  onClose: () => void;
  onOpenReader: (book: Book, chapterIndex?: number, pageIndex?: number) => void;
  onDeleteBook: (book: Book) => void;
};

export const BookDetailModal = ({ colors, book, progress, onClose, onOpenReader, onDeleteBook }: BookDetailModalProps) => {
  const insets = useSafeAreaInsets();

  if (!book) {
    return null;
  }

  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <View style={[styles.detailScreen, { backgroundColor: colors.background }]}>
        <View style={[styles.detailHeader, { backgroundColor: colors.header, paddingTop: insets.top + 10 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭详情"
            onPress={onClose}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Text style={[styles.iconButtonText, { color: colors.readerText }]}>‹</Text>
          </Pressable>
          <Text numberOfLines={1} style={[styles.detailTitle, { color: colors.readerText }]}>
            {book.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`删除 ${book.title}`}
            onPress={() => onDeleteBook(book)}
            style={({ pressed }) => [
              styles.headerDeleteButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.headerDeleteText}>删除</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 28 }]}>
          <View style={styles.heroRow}>
            <Image
              source={{ uri: book.coverUri }}
              style={[styles.detailCover, { backgroundColor: colors.coverPlaceholder }]}
              resizeMode="cover"
            />
            <View style={styles.heroMeta}>
              <Text numberOfLines={3} style={[styles.heroTitle, { color: colors.text }]}>
                {book.title}
              </Text>
              <Text style={[styles.detailMeta, { color: colors.textMuted }]}>
                {book.chapters.length} 章 / {book.pageCount} 页
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`继续阅读 ${book.title}`}
            onPress={() => onOpenReader(book)}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}
          >
            <Text style={[styles.primaryButtonText, { color: colors.readerText }]}>
              {progress ? `继续第 ${progress.pageIndex + 1} 页` : '开始阅读'}
            </Text>
          </Pressable>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>章节</Text>
          {book.chapters.map((chapter, index) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`打开章节 ${chapter.title}`}
              key={chapter.id}
              onPress={() => onOpenReader(book, index, 0)}
                style={({ pressed }) => [
                  styles.chapterRow,
                  { backgroundColor: colors.surface },
                  pressed && styles.pressed,
                ]}
            >
              <View>
                  <Text style={[styles.chapterTitle, { color: colors.text }]}>{chapter.title}</Text>
                  <Text style={[styles.chapterPages, { color: colors.textSubtle }]}>{chapter.pages.length} 页</Text>
              </View>
              <Text style={[styles.chevron, { color: colors.textSubtle }]}>›</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  detailScreen: {
    flex: 1,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 48,
    width: 48,
  },
  iconButtonText: {
    fontSize: 36,
    lineHeight: 40,
  },
  detailTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
  },
  headerDeleteButton: {
    alignItems: 'center',
    backgroundColor: DELETE_BUTTON_BACKGROUND,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  headerDeleteText: {
    color: DELETE_BUTTON_TEXT,
    fontSize: 14,
    fontWeight: '900',
  },
  detailContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    marginBottom: 18,
  },
  detailCover: {
    borderRadius: radii.md,
    height: 188,
    width: 132,
  },
  heroMeta: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
  },
  detailMeta: {
    fontSize: 14,
    marginTop: 10,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
    marginTop: 24,
  },
  chapterRow: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chapterTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  chapterPages: {
    fontSize: 13,
    marginTop: 4,
  },
  chevron: {
    fontSize: 28,
  },
  pressed: {
    opacity: 0.72,
  },
});
