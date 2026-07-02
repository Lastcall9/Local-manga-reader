import { StorageAccessFramework } from 'expo-file-system/legacy';

const NOMEDIA_FILE_NAME = '.nomedia';

const getNomediaUri = async (rootUri: string) => {
  const entries = await StorageAccessFramework.readDirectoryAsync(rootUri);

  return entries.find((entry) => decodeURIComponent(entry).endsWith(`/${NOMEDIA_FILE_NAME}`)) ?? null;
};

// 入参：用户授权的漫画根目录 URI。返回：该目录是否已通过 .nomedia 对系统相册隐藏。
export const getPrivacyModeEnabled = async (rootUri: string) => {
  const nomediaUri = await getNomediaUri(rootUri);

  return Boolean(nomediaUri);
};

// 入参：用户授权的漫画根目录 URI。副作用：创建 .nomedia，阻止相册继续索引该目录。
export const enablePrivacyMode = async (rootUri: string) => {
  const existingNomediaUri = await getNomediaUri(rootUri);

  if (existingNomediaUri) {
    return true;
  }

  await StorageAccessFramework.createFileAsync(rootUri, NOMEDIA_FILE_NAME, 'application/octet-stream');

  return true;
};

// 入参：用户授权的漫画根目录 URI。副作用：删除 .nomedia，让相册后续可重新索引。
export const disablePrivacyMode = async (rootUri: string) => {
  const existingNomediaUri = await getNomediaUri(rootUri);

  if (!existingNomediaUri) {
    return false;
  }

  await StorageAccessFramework.deleteAsync(existingNomediaUri, { idempotent: true });

  return false;
};
