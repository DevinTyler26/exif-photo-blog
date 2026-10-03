type StoredPhotoVariant = 'small' | 'medium' | 'large';

const SUFFIX_BY_VARIANT: Record<StoredPhotoVariant, string> = {
  small: 'sm',
  medium: 'md',
  large: 'lg',
};

/**
 * Return the photo derivative created alongside the original upload.
 * The full original remains untouched and is used as a fallback when an
 * older photo does not have its derivative yet.
 */
export const getStoredOptimizedPhotoUrl = (
  sourceUrl: string,
  variant: StoredPhotoVariant,
) => {
  try {
    const url = new URL(sourceUrl);
    const slashIndex = url.pathname.lastIndexOf('/');
    const filename = url.pathname.slice(slashIndex + 1);
    const extensionIndex = filename.lastIndexOf('.');

    if (extensionIndex <= 0) {
      return sourceUrl;
    }

    const filenameBase = filename.slice(0, extensionIndex);
    const optimizedFilename =
      `${filenameBase}-${SUFFIX_BY_VARIANT[variant]}.jpg`;
    url.pathname =
      `${url.pathname.slice(0, slashIndex + 1)}${optimizedFilename}`;
    url.search = '';
    url.hash = '';

    return url.toString();
  } catch {
    return sourceUrl;
  }
};
