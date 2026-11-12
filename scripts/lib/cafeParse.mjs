// 네이버 카페 검색 결과(제목 + 본문 요약)에서 시세 정보를 읽어 내는 함수들.
// scripts/collect-cafe-market.mjs 가 쓴다. 읽은 값은 "후보"일 뿐이고, 앱에서 사람이 확인한 뒤 저장한다.

export function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const HANGUL = /[가-힣]/;

// "님피아 GX" → 띄어쓰기·대소문자를 무시하고 찾는 정규식. 바로 앞이 한글이면(메가리자몽 ↔ 리자몽) 다른 카드로 본다.
export function nameRegex(name) {
  const chars = [...String(name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')];
  if (chars.length === 0) return null;
  const body = chars.map((c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('\\s*');
  return new RegExp(body, 'gi');
}

// 텍스트 안에서 이름이 나오는 위치들 (앞 글자가 한글이면 제외)
export function findName(text, name) {
  const re = nameRegex(name);
  if (!re) return [];
  const t = String(text || '').normalize('NFKC');
  const out = [];
  let m;
  while ((m = re.exec(t))) {
    const prev = t[m.index - 1];
    if (!(prev && HANGUL.test(prev))) out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

// ── 가격 ──
// 가격이 아닌 숫자(등급, 카드번호, 배송비, 날짜, 수량 등)를 먼저 지운다.
function scrubNonPrice(s) {
  return s
    .replace(/(psa|brg|bgs|cgc|ace|tag|kgs|등급)\s*[-:]?\s*\d+(?:\.5)?/gi, ' ')
    .replace(/\d+\s*\/\s*\d+/g, ' ')                                   // 110/063, 11/12
    .replace(/(반택|일택|편택|준등기|등기|택배비?|배송비|gs|cu)\s*[:：]?\s*\d+(?:[.,]\d+)?\s*(만\s*)?원?/gi, ' ')
    .replace(/\d+\s*(장|팩|박스|종|주년|세대|%|p\b)/g, ' ')
    .replace(/\d+\s*(개|매|번|회|차|월|일|시|분|명|등|위)(?![가-힣])/g, ' ')
    .replace(/\d+\s*(st|nd|rd|th)\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b[a-z]{1,4}\d+[a-z]?\b/gi, ' ')                           // sv8a, m1l, s4a 같은 세트 코드
    .replace(/\d+\s*(?=sar|sr|ar|ur|hr|chr|csr|ssr|rrr|rr)/gi, ' ');
}

// "24만", "28만원", "855,000원", "85.5" 같은 가격 표현을 원 단위 숫자로
const PRICE_RE = /(\d+(?:\.\d+)?)\s*만\s*(\d{1,4})?\s*원?|(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원?|(\d+(?:\.\d+)?)/g;
export function priceTokens(s) {
  const out = [];
  const t = scrubNonPrice(String(s || '').normalize('NFKC'));
  let m;
  PRICE_RE.lastIndex = 0;
  while ((m = PRICE_RE.exec(t))) {
    let v = null; let sure = true;
    if (m[1]) v = Math.round(parseFloat(m[1]) * 10000 + (m[2] ? parseInt(m[2], 10) * 1000 : 0));
    else if (m[3]) v = parseInt(m[3].replace(/,/g, ''), 10);
    else if (m[4]) { const n = parseFloat(m[4]); if (n >= 0.3 && n < 1000) { v = Math.round(n * 10000); sure = false; } }
    if (v && v >= 1000 && v <= 100000000) out.push({ value: v, index: m.index, sure });
  }
  return out;
}

// ── 언어 / 등급 ──
export function detectLanguage(s) {
  const t = String(s || '').toLowerCase();
  if (/일판|일본판|일어판|japanese|\bjp\b|일본어/.test(t)) return '일본';
  if (/한판|한글판|한국판|한글|\bkr\b|국내판/.test(t)) return '한국';
  if (/영판|북미|미판|영문판|english|\ben\b|미국판/.test(t)) return '미국';
  if (/중판|중국판|중문|번체|간체|chinese/.test(t)) return '중국';
  return '';
}

export function detectGrade(s) {
  const m = String(s || '').match(/\b(psa|brg|bgs|cgc|ace|tag|kgs)\s*[-:]?\s*(10|9\.5|[1-9](?:\.5)?)(?![\d.])/i);
  if (m) return { conditionType: 'graded', gradingCompany: m[1].toUpperCase(), grade: m[2] };
  if (/등급카드|등카|슬랩/.test(String(s || ''))) return { conditionType: 'graded', gradingCompany: '', grade: '' };
  return { conditionType: 'raw', gradingCompany: '', grade: '' };
}

// ── 글 종류 ──
const BUY_RE = /구합니다|구해요|구해봅니다|구함|삽니다|사요\b|매입|구매합니다|구매해요|구매원합니다|구매희망|^\s*\[?구매|\(구매\)|구매\s*[-:)\]]|구매\s*$|교환\s*원/;
// MVP 카페 거래 게시판 글에 자동으로 들어가는 양식 문구
const TRADE_TEMPLATE_RE = /판매글 게시물 작성시|거래는 댓글 우선제/;
const OTHER_RE = /나눔|후기|질문|문의|궁금|도와주세요|개봉|인증|결과|자랑|추천|어떤가요|맞나요|일까요|가품|정품|사기|이벤트|당첨|공지/;
const AUCTION_RE = /마감|경매|입찰|시작가|낙찰/;
const SALE_RE = /판매|팝니다|팔아요|팔아봅니다|처분|정리|양도|택포|가격|만원|원\b|일괄|급처|내놓|매물/;
export const SOLD_RE = /판매\s*완료|거래\s*완료|완판|판완|판매완|sold/i;

export function classify(title, snippet) {
  const t = String(title || '');
  const all = `${t} ${snippet || ''}`;
  if (BUY_RE.test(t) || (/구매/.test(t) && !/판매|팝니다|팔아요/.test(t))) return 'buy';
  if (AUCTION_RE.test(t) || /시작가|입찰단위|낙찰/.test(snippet || '')) return 'auction';
  if (OTHER_RE.test(t) && !SALE_RE.test(t)) return 'other';
  if (SALE_RE.test(t) || TRADE_TEMPLATE_RE.test(snippet || '')) return 'sale';
  if (/판매|팝니다|팔아요|택포/.test(all) && priceTokens(all).length > 0) return 'sale';
  return 'other';
}

// ── 경매 마감 시간 ──
// "(11/12 마감)", "[11월 12일 마감]", "11/13 당일마감", "(11/14 토요일)" → 그 날 23:00(한국 시간)
export function parseDeadline(title, snippet, foundAtIso) {
  const t = String(title || '');
  let m = t.match(/(\d{1,2})\s*(?:\/|월|\.)\s*(\d{1,2})\s*일?/);
  if (!m) m = String(snippet || '').match(/기간\s*[:：]?\s*(\d{1,2})\s*(?:\/|월|\.)\s*(\d{1,2})/);
  if (!m) return null;
  const month = parseInt(m[1], 10); const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let hh = 23; let mm = 0;
  const tm = String(snippet || '').match(/(\d{1,2})\s*:\s*(\d{2})\s*(?:부터|에|까지)?\s*(?:경매\s*)?(?:종료|마감)/) || String(snippet || '').match(/기간\s*[:：]?\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (tm) { hh = Math.min(23, parseInt(tm[1], 10)); mm = parseInt(tm[2], 10); if (hh === 22 && mm === 59) { hh = 23; mm = 0; } }
  const found = new Date(foundAtIso || Date.now());
  // 한국 시간 기준 연도를 고른다: 발견한 날과 가장 가까운 날짜
  const kstYear = new Date(found.getTime() + 9 * 3600e3).getUTCFullYear();
  let best = null;
  for (const y of [kstYear - 1, kstYear, kstYear + 1]) {
    const d = new Date(Date.UTC(y, month - 1, day, hh - 9, mm));
    if (!best || Math.abs(d - found) < Math.abs(best - found)) best = d;
  }
  return best.toISOString();
}

export function parseStartPrice(snippet) {
  const m = String(snippet || '').normalize('NFKC').match(/시작\s*가\s*[:：]?\s*(\d+(?:[.,]\d+)*)\s*(만)?\s*원?/);
  if (!m) return null;
  const raw = m[1].replace(/,/g, '');
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return null;
  if (m[2] || (n < 1000 && !/,/.test(m[1]))) return Math.round(n * (n < 1000 ? 10000 : 1));
  return Math.round(n);
}

// ── 이 카드의 가격 ──
// 여러 장 파는 글이면 그 카드 이름 바로 뒤에 나오는 가격을 고른다.
// 제목과 본문 요약은 따로 본다(제목 끝의 카드 이름 뒤로 본문 숫자를 잘못 붙이지 않게).
export function priceForCard(title, snippet, names) {
  const parts = [String(snippet || '').normalize('NFKC'), String(title || '').normalize('NFKC')];
  const whole = parts.join(' ');
  const all = priceTokens(whole);
  const sureAll = all.filter((p) => p.sure);
  const multi = /일괄|여러|각\s*종|모음|정리|\d+\s*종|개별/.test(whole) || new Set(all.map((p) => p.value)).size >= 3;
  for (const t of parts) {
    const hits = names.flatMap((n) => findName(t, n)).sort((a, b) => a.start - b.start);
    for (const h of hits) {
      const win = t.slice(h.end, h.end + 45);
      const near = priceTokens(win);
      if (near.length) {
        const upto = win.slice(0, near[0].index + 12);
        return { price: near[0].value, multi, sure: near[0].sure, itemSold: /판매\s*완료|완료/.test(upto) };
      }
    }
  }
  const tp = [...whole.matchAll(/택포\s*(\d+(?:\.\d+)?)\s*(만)?\s*원?/g)].map((m) => { const n = parseFloat(m[1]); return Math.round(m[2] || n < 1000 ? n * 10000 : n); });
  if (tp.length === 1) return { price: tp[0], multi, sure: true };
  if (!multi && sureAll.length >= 1 && new Set(sureAll.map((p) => p.value)).size === 1) return { price: sureAll[0].value, multi, sure: true };
  return { price: null, multi };
}

// 검색 결과 1건 + 카드 정보 → 후보 정보
export function analyzePost({ title, snippet, foundAt }, names) {
  const text = `${title} ${snippet}`;
  const kind = classify(title, snippet);
  const grade = detectGrade(text);
  const out = {
    kind,
    language: detectLanguage(text),
    ...grade,
    price: null,
    startPrice: null,
    endsAt: null,
    flags: [],
    soldMark: SOLD_RE.test(title),
  };
  if (kind === 'auction') {
    out.startPrice = parseStartPrice(snippet);
    out.endsAt = parseDeadline(title, snippet, foundAt);
    if (!out.endsAt) out.kind = 'sale';
  }
  if (out.kind === 'sale') {
    const p = priceForCard(title, snippet, names);
    out.price = p.price;
    if (p.multi) out.flags.push('bundle');
    if (!p.price) out.flags.push('noprice');
    if (p.itemSold) out.flags.push('itemSold');
  }
  return out;
}

export function articleIdFromLink(link) {
  const m = String(link || '').match(/\/(\d+)(?:[?#].*)?$/) || String(link || '').match(/articleid=(\d+)/i);
  return m ? m[1] : '';
}
