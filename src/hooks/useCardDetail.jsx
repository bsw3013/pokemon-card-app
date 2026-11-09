import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from './useOwnedCards';
import { formatCardPayload } from '../utils/cardUtils';
import { parseHash, setHashParams } from '../utils/hashRoute';
import CardDetailModal from '../components/CardDetailModal';

// 어느 화면에서든 카드 상세 창을 띄우기 위한 훅.
// 주소 뒤 ?cardId=<카드ID> 와 연결돼 있어서, 링크로 바로 열거나 뒤로가기로 닫을 수 있다.
export function useCardDetail({ appConfig, onViewMarket } = {}) {
  const { isAdmin } = useAuth();
  const { cards, saveCard, createCard, duplicateCard, deleteCard } = useOwnedCards();
  const [cardId, setCardId] = useState(() => parseHash().params.cardId || null);

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

  const modal = appConfig ? (
    <CardDetailModal
      isOpen={!!card}
      card={card}
      appConfig={appConfig}
      isAdmin={isAdmin}
      onClose={close}
      onSave={handleSave}
      onDelete={isAdmin && card && !card.isNew ? handleDelete : undefined}
      onDuplicate={isAdmin && card && !card.isNew ? handleDuplicate : undefined}
      onViewMarket={onViewMarket}
      onOpenCard={openCard}
    />
  ) : null;

  return { openCard, openNew, close, modal };
}
