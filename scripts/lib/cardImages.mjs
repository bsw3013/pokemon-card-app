// 사이트에서 "기기에서 파일 선택"으로 넣은 카드 사진은 작게 줄인 data: 주소로 데이터베이스에 저장된다.
// 백업(카드 목록 파일·CSV)을 만들 때 그 사진을 public/card-images/<내용 해시>.webp 파일로 빼고 주소만 남긴다.
// 그래서 카드 목록 파일과 CSV 백업이 커지지 않고, 사진은 사이트 파일로 함께 배포된다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_URL = /^data:image\/(webp|jpe?g|png|gif);base64,([A-Za-z0-9+/=\s]+)$/;
const SITE_PREFIX = '/card-images/';

// rows: 카드 목록(imageUrl 칸을 바꾼다). dir: 사진을 둘 폴더. 반환: { written, kept, removed }
export function extractCardImages(rows, dir) {
  const keep = new Set();
  let written = 0;
  for (const row of rows) {
    const url = String(row.imageUrl || '');
    if (url.startsWith(SITE_PREFIX)) { keep.add(url.slice(SITE_PREFIX.length)); continue; }
    const m = url.match(DATA_URL);
    if (!m) continue;
    const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    if (!buf.length) continue;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { fs.writeFileSync(file, buf); written += 1; }
    keep.add(name);
    row.imageUrl = `${SITE_PREFIX}${name}`;
  }
  // 어느 카드도 쓰지 않는 사진 파일은 지운다
  let removed = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('.') || keep.has(f)) continue;
      fs.unlinkSync(path.join(dir, f));
      removed += 1;
    }
  }
  return { written, kept: keep.size, removed };
}
