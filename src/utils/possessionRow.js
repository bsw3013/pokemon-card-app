// 보유 기록 한 줄(한 장 또는 같은 조건 묶음)의 기본 모양
export const POSSESSION_LANGS = ['한국', '일본', '미국', '중국'];

export function newPossessionRow(defaultLanguage, company = '', count = 1) {
  return {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    count,
    condition: company ? '' : '민트',
    language: defaultLanguage || '한국',
    company,
    grade: '',
    serial: '',
    purchasePrice: '',
    purchaseDate: '',
    location: '',
    source: 'buy', // 얻은 방법: buy(구매) / pull(직뽑 = 팩을 직접 까서 나온 카드)
    forTrade: false,
    askPrice: '',
    notes: '',
  };
}
