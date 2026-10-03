import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const cacheRoot = '/app/.next/cache/images';
const maxBytes = Number(
  process.env.NEXT_IMAGE_CACHE_MAX_BYTES || 2 * 1024 * 1024 * 1024,
);

if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
  throw new Error('NEXT_IMAGE_CACHE_MAX_BYTES must be a non-negative integer');
}

const listFiles = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') { return []; }
    throw error;
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) { return listFiles(entryPath); }
    if (!entry.isFile()) { return []; }
    const details = await stat(entryPath);
    return [{ path: entryPath, size: details.size, modified: details.mtimeMs }];
  }));
  return nested.flat();
};

const files = await listFiles(cacheRoot);
let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
const initialBytes = totalBytes;

for (const file of files.sort((a, b) => a.modified - b.modified)) {
  if (totalBytes <= maxBytes) { break; }
  await unlink(file.path);
  totalBytes -= file.size;
}

const removedBytes = initialBytes - totalBytes;
console.log(JSON.stringify({
  fileCount: files.length,
  initialBytes,
  maxBytes,
  removedBytes,
  remainingBytes: totalBytes,
}));
