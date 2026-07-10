import {
  cacheDirectory,
  copyAsync,
  deleteAsync,
  getFreeDiskStorageAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { getUncompressedSize, isPasswordProtected, unzip } from 'react-native-zip-archive';

const ARCHIVE_CACHE_FOLDER = 'local-manga-reader/archives';
const ARCHIVE_COMPLETE_MARKER = '.complete';
const ARCHIVE_COPY_FILE_NAME = 'source.zip';
const ARCHIVE_CONTENT_FOLDER = 'content';
const MINIMUM_FREE_SPACE_BYTES = 256 * 1024 * 1024;
const HASH_OFFSET_BASIS = 2166136261;
const HASH_PRIME = 16777619;

type ArchiveSourceInfo = {
  size: number;
  modificationTime: number;
  md5?: string;
};

type PreparedArchive = {
  contentUri: string;
  signature: string;
};

let archiveExtractionQueue: Promise<void> = Promise.resolve();

const hashString = (value: string) => {
  let hash = HASH_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
};

const ensureTrailingSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

const getArchiveCacheRoot = () => {
  if (!cacheDirectory) {
    throw new Error('无法访问 App 缓存目录');
  }

  return `${ensureTrailingSlash(cacheDirectory)}${ARCHIVE_CACHE_FOLDER}/`;
};

const getArchiveSourceCacheUri = (archiveUri: string) =>
  `${getArchiveCacheRoot()}${hashString(archiveUri)}/`;

const getArchiveSignature = (archiveUri: string, sourceInfo: ArchiveSourceInfo) =>
  hashString(`${archiveUri}:${sourceInfo.size}:${sourceInfo.modificationTime}:${sourceInfo.md5 ?? ''}`);

const getArchiveCachePaths = (archiveUri: string, signature: string) => {
  const sourceCacheUri = getArchiveSourceCacheUri(archiveUri);
  const versionCacheUri = `${sourceCacheUri}${signature}/`;

  return {
    sourceCacheUri,
    versionCacheUri,
    archiveCopyUri: `${versionCacheUri}${ARCHIVE_COPY_FILE_NAME}`,
    contentUri: `${versionCacheUri}${ARCHIVE_CONTENT_FOLDER}/`,
    completeMarkerUri: `${versionCacheUri}${ARCHIVE_COMPLETE_MARKER}`,
  };
};

const hasCompleteArchiveCache = async (contentUri: string, completeMarkerUri: string) => {
  const [contentInfo, markerInfo] = await Promise.all([
    getInfoAsync(contentUri),
    getInfoAsync(completeMarkerUri),
  ]);

  return contentInfo.exists && contentInfo.isDirectory && markerInfo.exists;
};

const trimTrailingSlash = (uri: string) => (uri.endsWith('/') ? uri.slice(0, -1) : uri);

// 入参：归档缓存根目录与当前版本目录。副作用：成功解压后删除旧版本缓存。
const pruneStaleArchiveVersions = async (sourceCacheUri: string, activeVersionCacheUri: string) => {
  const activeVersionUri = trimTrailingSlash(activeVersionCacheUri);
  const cachedVersionUris = await readDirectoryAsync(sourceCacheUri);
  const staleVersionUris = cachedVersionUris.filter(
    (uri) => trimTrailingSlash(uri) !== activeVersionUri,
  );

  await Promise.all(
    staleVersionUris.map((uri) => deleteAsync(uri, { idempotent: true })),
  );
};

const runInArchiveQueue = async <Result>(operation: () => Promise<Result>) => {
  const queuedOperation = archiveExtractionQueue
    .catch(() => undefined)
    .then(operation);

  archiveExtractionQueue = queuedOperation.then(() => undefined, () => undefined);

  return queuedOperation;
};

const assertEnoughSpace = async (requiredBytes: number, action: string) => {
  const freeBytes = await getFreeDiskStorageAsync();

  if (requiredBytes + MINIMUM_FREE_SPACE_BYTES > freeBytes) {
    const requiredMegabytes = Math.ceil(requiredBytes / 1024 / 1024);

    throw new Error(`${action}需要约 ${requiredMegabytes} MB 空间，当前可用空间不足`);
  }
};

// 入参：ZIP/CBZ URI 及文件元数据。返回：可直接扫描的解压缓存目录与版本签名。
export const prepareArchive = async (
  archiveUri: string,
  sourceInfo: ArchiveSourceInfo,
): Promise<PreparedArchive> => {
  const signature = getArchiveSignature(archiveUri, sourceInfo);
  const paths = getArchiveCachePaths(archiveUri, signature);

  if (await hasCompleteArchiveCache(paths.contentUri, paths.completeMarkerUri)) {
    return { contentUri: paths.contentUri, signature };
  }

  return runInArchiveQueue(async () => {
    if (await hasCompleteArchiveCache(paths.contentUri, paths.completeMarkerUri)) {
      return { contentUri: paths.contentUri, signature };
    }

    await assertEnoughSpace(sourceInfo.size, '复制归档');
    await deleteAsync(paths.versionCacheUri, { idempotent: true });
    await makeDirectoryAsync(paths.versionCacheUri, { intermediates: true });

    try {
      await copyAsync({ from: archiveUri, to: paths.archiveCopyUri });

      if (await isPasswordProtected(paths.archiveCopyUri)) {
        throw new Error('暂不支持带密码的 ZIP/CBZ');
      }

      const uncompressedSize = await getUncompressedSize(paths.archiveCopyUri, 'UTF-8');
      await assertEnoughSpace(uncompressedSize, '解压归档');
      await makeDirectoryAsync(paths.contentUri, { intermediates: true });
      await unzip(paths.archiveCopyUri, paths.contentUri, 'UTF-8');
      await writeAsStringAsync(paths.completeMarkerUri, signature);
      await pruneStaleArchiveVersions(paths.sourceCacheUri, paths.versionCacheUri);

      return { contentUri: paths.contentUri, signature };
    } catch (error) {
      await deleteAsync(paths.versionCacheUri, { idempotent: true });
      const reason = error instanceof Error ? error.message : '未知错误';
      const conciseReason = reason.split('\n')[0].slice(0, 240);

      throw new Error(`解压《${decodeURIComponent(archiveUri).split('/').pop() ?? archiveUri}》失败：${conciseReason}`);
    } finally {
      await deleteAsync(paths.archiveCopyUri, { idempotent: true });
    }
  });
};

// 入参：归档源 URI。副作用：删除该归档的所有解压缓存。
export const clearArchiveCache = async (archiveUri: string) => {
  await deleteAsync(getArchiveSourceCacheUri(archiveUri), { idempotent: true });
};
