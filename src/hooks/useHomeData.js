import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useOwnedCards } from './useOwnedCards';

// 홈 대시보드 전용 데이터 로드 훅.
// - 카드는 다른 화면과 완전히 동일한 useOwnedCards()를 그대로 쓴다.
// - 앨범(album_plans)과 시세(marketListings)는 로그인한 사용자에게만 필요해서,
//   로그인했을 때만 Promise.all로 병렬 로드한다. 하나가 실패해도 다른 하나는 그대로 쓸 수 있게
//   각 요청을 개별적으로 catch해서 묶는다. (useOwnedCards.js의 fetchCards 패턴과 동일하게
//   fetch 로직을 useCallback으로 분리하고, effect는 그 함수를 호출만 한다.)
export function useHomeData() {
  const { user } = useAuth();
  const { cards, loading: cardsLoading } = useOwnedCards();

  const [albums, setAlbums] = useState([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState(false);

  const [marketListings, setMarketListings] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState(false);

  const fetchHomeExtras = useCallback(async () => {
    if (!user) return;

    setAlbumsLoading(true);
    setMarketLoading(true);
    setAlbumsError(false);
    setMarketError(false);

    const albumsPromise = getDocs(query(collection(db, 'album_plans'), where('ownerId', '==', user.uid)))
      .then((snap) => ({ ok: true, docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }))
      .catch((err) => ({ ok: false, err }));

    const marketPromise = getDocs(collection(db, 'marketListings'))
      .then((snap) => ({ ok: true, docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }))
      .catch((err) => ({ ok: false, err }));

    const [albumsResult, marketResult] = await Promise.all([albumsPromise, marketPromise]);

    if (albumsResult.ok) {
      setAlbums(albumsResult.docs);
    } else {
      console.error('홈 대시보드: 앨범 로드 실패', albumsResult.err);
      setAlbumsError(true);
    }
    setAlbumsLoading(false);

    if (marketResult.ok) {
      setMarketListings(marketResult.docs);
    } else {
      console.error('홈 대시보드: 시세 로드 실패', marketResult.err);
      setMarketError(true);
    }
    setMarketLoading(false);
  }, [user]);

  useEffect(() => {
    fetchHomeExtras();
  }, [fetchHomeExtras]);

  return {
    cards,
    cardsLoading,
    albums: user ? albums : [],
    albumsLoading: user ? albumsLoading : false,
    albumsError: user ? albumsError : false,
    marketListings: user ? marketListings : [],
    marketLoading: user ? marketLoading : false,
    marketError: user ? marketError : false,
  };
}
