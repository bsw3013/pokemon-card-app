import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from './useOwnedCards';
import { formatCardPayload } from '../utils/cardUtils';
import { parseHash, setHashParams } from '../utils/hashRoute';
import { buildCardKey } from '../utils/cardKey';
import CardDetailModal from '../components/CardDetailModal';
import MarketDrawer from '../components/MarketDrawer';

// 어느 화면에서든 카드 상세 창을 띄우기 위한 훅.
// 주소 뒤 ?cardId=<카드ID> 와 연결돼 있어서, 링크로 바로 열거나 뒤로가기로 닫을 수 있다.
// [시세 보기]를 누르면 페이지를 옮기지 않고 카드 상세 위에 오른쪽 시세 창을 띄운다.
// (onViewMarket 은 시세 창 안의 "시세 페이지에서 보기" 버튼에서만 쓴다)
export function useCardDetail({ appConfig, onViewMarket } = {}) {
  const { isAdmin } = useAuth();
  const { cards, saveCard, createCard, duplicateCard, deleteCard } = useOwnedCards();
  const [cardId, setCardId] = useState(() => parseHash().params.cardId || null);
  const [marketCard, setMarketCard] = useState(null); // 시세 창에 띄운 카드
  const [marketVersion, setMarketVersion] = useState(0); // 시세가 바뀌면 카드 상세의 시세 요약을 다시 읽게 하는 숫자

  useEffect(() => {
    const sync = () => setCardId(parseHash().params.cardId || null);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const openCard = useCallback((card) => {
    const id = typeof card === 'string' ? card : card?.id;
    if (id) setHashParams({ cardId: id });
  }, []);
  const openNew = useCallback(() => setHashParams({ cardId: 'new' }), []);
  const close = useCallback(() => setHashParams({ cardId: null }, { replace: true }), []);

  const card = cardId === 'new' ? (isAdmin ? { isNew: true } : null) : (cards.find((c) => c.id === cardId) || null);

  const openMarket = useCallback((c) => {
    const cardKey = c ? buildCardKey(c) : '';
    if (!cardKey) return;
    setMarketCard({
      id: c.id, cardKey, cardName: c.cardName || '', series: c.series || '', cardNumber: c.cardNumber || '',
      imageUrl: c.imageUrl || '', price: Number(c.price) || 0,
    });
  }, []);
  // 카드 상세를 닫거나 다른 카드로 넘어가면 시세 창도 같이 닫힌 것으로 본다.
  const showMarket = !!(marketCard && card && !card.isNew && marketCard.id === card.id);

  const handleSave = async (payload) => {
    const data = formatCardPayload(payload);
    try {
      if (card?.isNew) {
        const created = await createCard(data);
        setHashParams({ cardId: created.id }, { replace: true });
      } else if (card?.id) {
        await saveCard(card.id, data);
      }
    } catch (err) {
      console.error(err);
      alert('저장 중 오류가 발생했습니다.');
      throw err;
    }
  };

  const handleDuplicate = async (payload) => {
    try {
      const created = await duplicateCard(formatCardPayload(payload));
      setHashParams({ cardId: created.id }, { replace: true });
    } catch (err) {
      console.error(err);
      alert('복제 중 오류가 발생했습니다.');
    }
  };

  const handleDelete = async () => {
    if (!card?.id) return;
    await deleteCard(card.id);
    close();
  };

  const modal = appConfig ? (<>
    <CardDetailModal
      isOpen={!!card}
      card={card}
      appConfig={appConfig}
      isAdmin={isAdmin}
      onClose={close}
      onSave={handleSave}
      onDelete={isAdmin && card && !card.isNew ? handleDelete : undefined}
      onDuplicate={isAdmin && card && !card.isNew ? handleDuplicate : undefined}
      onViewMarket={openMarket}
      marketVersion={marketVersion}
      suspendKeys={showMarket}
      onOpenCard={openCard}
    />
    {showMarket && (
      <MarketDrawer
        key={marketCard.cardKey}
        card={marketCard}
        appConfig={appConfig}
        overModal
        onClose={() => setMarketCard(null)}
        onChanged={() => setMarketVersion((v) => v + 1)}
        onOpenMarketPage={onViewMarket ? () => { const c = card; setMarketCard(null); close(); onViewMarket({ ...c }); } : undefined}
      />
    )}
  </>) : null;

  return { openCard, openNew, close, modal };
}
