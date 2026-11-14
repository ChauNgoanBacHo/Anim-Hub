export function toAssetUrl(absolutePath, baseUrl = 'spine-asset://asset') {
  const normalized = absolutePath.replace(/\\/g, '/');
  const trimmed = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const segments = trimmed.split('/');
  const encoded = segments
    .map((segment, index) => {
      if (index === 0 && /^[A-Za-z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join('/');

  return `${baseUrl}/${encoded}`;
}
