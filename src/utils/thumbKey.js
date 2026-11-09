// 원본 이미지 주소 → 우리 사이트에 올려 둔 썸네일 경로(/thumbs/...webp).
// 주소만으로 파일 이름이 정해지므로 DB에 썸네일 필드를 따로 저장할 필요가 없다.
// scripts/make-thumbnails.mjs 도 이 함수를 그대로 써서 같은 이름으로 파일을 만든다.

export function normalizeImageUrl(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url) return '';
  if (/^(https?:\/\/|data:|blob:|\/)/.test(url)) return url;
  return `https://${url}`;
}

export function thumbFileName(imageUrl) {
  const url = normalizeImageUrl(imageUrl);
  if (!/^https?:\/\//.test(url)) return '';
  const withoutProtocol = url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  const withoutExt = withoutProtocol.replace(/\.(png|jpe?g|webp|gif)$/i, '');
  return `${withoutExt.replace(/[^A-Za-z0-9._-]+/g, '_')}.webp`;
}

export function thumbUrlFor(imageUrl) {
  const name = thumbFileName(imageUrl);
  return name ? `/thumbs/${name}` : '';
}
