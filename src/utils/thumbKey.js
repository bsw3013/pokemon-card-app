// 원본 이미지 주소 → 우리 사이트에 올려 둔 썸네일 경로(/thumbs/...webp).
// 주소만으로 파일 이름이 정해지므로 DB에 썸네일 필드를 따로 저장할 필요가 없다.
// scripts/make-thumbnails.mjs 도 이 함수를 그대로 써서 같은 이름으로 파일을 만든다.

// 포켓몬코리아 공식 사진 서버는 2026-11-11부터 .png 주소를 없애고 .webp 만 준다 (같은 사진). 예전에 저장한 .png 주소도 .webp 로 바꿔서 쓴다.
const KR_OFFICIAL_PNG = /^(https?:\/\/cards\.image\.pokemonkorea\.co\.kr\/.*)\.png(\?.*)?$/i;

export function normalizeImageUrl(imageUrl) {
  let url = String(imageUrl || '').trim();
  if (!url) return '';
  if (!/^(https?:\/\/|data:|blob:|\/)/.test(url)) url = `https://${url}`;
  return url.replace(KR_OFFICIAL_PNG, (_, head, q) => `${head}.webp${q || ''}`);
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
  // ?v=2: 썸네일이 아직 없을 때 받은 빈 페이지를 브라우저가 오래 기억하고 있던 문제를 피하려고 주소를 바꿈
  return name ? `/thumbs/${name}?v=2` : '';
}
