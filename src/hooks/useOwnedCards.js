import { useContext } from 'react';
import { CardsContext } from '../cardsContextObject';

// 카드 목록(공용 카드 정보 + 내 보유 현황)과 세트·레어도 표를 쓰는 화면들이 부르는 훅.
// 실제 데이터는 CardsProvider(src/CardsContext.jsx)가 앱 전체에서 한 번만 불러와 함께 쓴다.
export function useOwnedCards() {
  const ctx = useContext(CardsContext);
  if (!ctx) throw new Error('useOwnedCards는 CardsProvider 안에서만 쓸 수 있습니다.');
  return ctx;
}
