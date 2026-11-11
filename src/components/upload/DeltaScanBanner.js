'use client';

import { useT } from '@/context/LocaleContext';

export default function DeltaScanBanner({ delta }) {
  const t = useT();
  if (!delta) return null;

  const { onDriveCount, toUploadCount } = delta;

  return (
    <div className="delta-scan-banner" role="status">
      <strong>{t('delta.scanComplete')}</strong>{' '}
      {onDriveCount > 0 && (
        <span>
          {t(onDriveCount === 1 ? 'delta.onDriveOne' : 'delta.onDriveMany', {
            count: onDriveCount,
          })}{' '}
        </span>
      )}
      {toUploadCount > 0 ? (
        <span>
          {t(toUploadCount === 1 ? 'delta.willUploadOne' : 'delta.willUploadMany', {
            count: toUploadCount,
          })}
        </span>
      ) : (
        <span>{t('delta.allDone')}</span>
      )}
    </div>
  );
}
