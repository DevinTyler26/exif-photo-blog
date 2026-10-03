import { IS_PRODUCTION } from '@/app/config';

export const getImageResponseCacheControlHeaders = (
  shouldCache = IS_PRODUCTION,
) => {
  return {
    'Cache-Control': shouldCache
      ? 's-maxage=3600, stale-while-revalidate=31536000'
      : 's-maxage=1, stale-while-revalidate=59',
  };
};
