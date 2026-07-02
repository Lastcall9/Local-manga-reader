import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppSettings, LibraryState, ProgressMap } from '../types/library';

const LIBRARY_STORAGE_KEY = 'local-manga-reader:library';
const PROGRESS_STORAGE_KEY = 'local-manga-reader:progress';
const SETTINGS_STORAGE_KEY = 'local-manga-reader:settings';

export const DEFAULT_SETTINGS: AppSettings = {
  readerMode: 'scroll',
  themeMode: 'system',
  readingDirection: 'rtl',
  imageFitMode: 'width',
  pageGapMode: 'none',
  librarySortMode: 'recent',
};

export const loadStoredLibrary = async (): Promise<LibraryState> => {
  const rawLibrary = await AsyncStorage.getItem(LIBRARY_STORAGE_KEY);

  if (!rawLibrary) {
    return { rootUri: null, books: [] };
  }

  return JSON.parse(rawLibrary) as LibraryState;
};

export const saveLibrary = async (state: LibraryState) => {
  await AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state));
};

export const loadProgress = async (): Promise<ProgressMap> => {
  const rawProgress = await AsyncStorage.getItem(PROGRESS_STORAGE_KEY);

  return rawProgress ? (JSON.parse(rawProgress) as ProgressMap) : {};
};

export const saveProgress = async (progress: ProgressMap) => {
  await AsyncStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
};

export const loadSettings = async (): Promise<AppSettings> => {
  const rawSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);

  return rawSettings ? { ...DEFAULT_SETTINGS, ...(JSON.parse(rawSettings) as Partial<AppSettings>) } : DEFAULT_SETTINGS;
};

export const saveSettings = async (settings: AppSettings) => {
  await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};
