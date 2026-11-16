// 기기에서 고른 사진을 브라우저에서 작게 줄여 "data:" 주소(사진 자체를 글자로 바꾼 것)로 돌려준다.
// 사진 저장소(Firebase Storage)를 쓰지 않고, 줄인 사진을 카드·앨범 정보에 바로 저장하기 위한 것.
// - 휴대폰 사진의 회전 정보(EXIF)는 브라우저가 그릴 때 반영해서 바로 세운다.
// - WebP로 줄이고, WebP를 못 만드는 브라우저는 JPEG로 만든다.
// - 너무 크면 화질·크기를 조금씩 더 줄여서 maxBytes 안에 맞춘다(데이터베이스 문서 한 개는 1MB까지).

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
      reject(new Error(heic
        ? '아이폰 HEIC 사진은 이 브라우저에서 열 수 없어요. 사진 앱에서 JPG로 저장(또는 스크린샷)한 뒤 올려 주세요.'
        : '사진을 열 수 없어요. JPG·PNG·WebP 사진인지 확인해 주세요.'));
    };
    img.src = url;
  });
}

function draw(img, maxW, maxH, type, quality) {
  const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(type, quality);
}

// 글자 길이 → 실제 바이트(대략)
export function dataUrlBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  return Math.round((b64.length * 3) / 4);
}

export async function shrinkToDataUrl(file, { maxW = 600, maxH = 840, quality = 0.82, maxBytes = 300 * 1024 } = {}) {
  if (!file) throw new Error('사진이 없어요');
  const img = await loadImage(file);
  let type = 'image/webp';
  let q = quality;
  let w = maxW;
  let h = maxH;
  let url = draw(img, w, h, type, q);
  if (!url.startsWith('data:image/webp')) { type = 'image/jpeg'; url = draw(img, w, h, type, q); }
  for (let i = 0; i < 6 && dataUrlBytes(url) > maxBytes; i += 1) {
    if (q > 0.6) q -= 0.08;
    else { w = Math.round(w * 0.85); h = Math.round(h * 0.85); }
    url = draw(img, w, h, type, q);
  }
  if (dataUrlBytes(url) > maxBytes) throw new Error('사진이 너무 커서 줄이지 못했어요. 다른 사진으로 해 주세요.');
  return url;
}
