import { getPhotosCached } from '@/photo/cache';
import {
  IMAGE_OG_DIMENSION_SMALL,
  PHOTO_PREVIEW_QUERY_OPTIONS,
} from '@/image-response';
import RecentsImageResponse from
  '@/recents/RecentsImageResponse';
import { getIBMPlexMono } from '@/app/font';
import { getImageResponseCacheControlHeaders } from '@/image-response/cache';
import { getAppText } from '@/i18n/state/server';
import { SHOW_RECENTS } from '@/app/config';
import { ImageResponse } from 'next/og';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [
    photos,
    { fontFamily, fonts },
    headers,
  ] = await Promise.all([
    SHOW_RECENTS
      ? getPhotosCached({
        ...PHOTO_PREVIEW_QUERY_OPTIONS,
        recent: true,
      }).catch(() => [])
      : [],
    getIBMPlexMono(),
    getImageResponseCacheControlHeaders(),
  ]);

  const appText = await getAppText();

  const title = appText.category.recentPlural.toLocaleUpperCase();

  const { width, height } = IMAGE_OG_DIMENSION_SMALL;

  return new ImageResponse(
    <RecentsImageResponse {...{
      title,
      photos,
      width,
      height,
      fontFamily,
    }}/>,
    { width, height, fonts, headers },
  );
}
