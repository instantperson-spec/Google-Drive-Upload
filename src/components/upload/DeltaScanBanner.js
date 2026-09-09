export default function DeltaScanBanner({ delta }) {
  if (!delta) return null;

  const { onDriveCount, toUploadCount } = delta;

  return (
    <div className="delta-scan-banner" role="status">
      <strong>Scan complete.</strong>{' '}
      {onDriveCount > 0 && (
        <span>
          {onDriveCount} file{onDriveCount !== 1 ? 's' : ''} already on Drive (will be skipped).{' '}
        </span>
      )}
      {toUploadCount > 0 ? (
        <span>
          {toUploadCount} file{toUploadCount !== 1 ? 's' : ''} will be uploaded.
        </span>
      ) : (
        <span>Everything is already uploaded — nothing left to send.</span>
      )}
    </div>
  );
}
