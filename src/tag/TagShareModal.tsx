import { absolutePathForTag } from '@/app/paths';
import { PhotoSetAttributes } from '../category/set';
import ShareModal from '@/share/ShareModal';
import TagOGTile from './TagOGTile';
import { shareTextForTag } from '.';

export default function TagShareModal({
  tag,
  photos,
  count,
  dateRange,
}: {
  tag: string
} & PhotoSetAttributes) {
  return (
    <ShareModal
      pathShare={absolutePathForTag(tag)}
      socialText={shareTextForTag(tag)}
    >
      <TagOGTile {...{ tag, photos, count, dateRange }} />
    </ShareModal>
  );
};
