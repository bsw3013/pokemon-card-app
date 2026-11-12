import { useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { getWatchlist, subscribeWatchlist } from './useWatchlist';
import { syncMarketTargets } from '../utils/cafeMarket';

// 관리자가 로그인해 있으면, 관심 카드 목록을 MVP 카페 자동 수집 대상(settings/marketTargets)으로 옮겨 적는다.
// 관심 카드를 더하거나 빼거나 검색어(별명)를 바꾸면 다시 옮겨 적는다(바뀐 게 없으면 쓰지 않음).
export function useCafeTargetSync() {
  const { user, isAdmin } = useAuth();
  const uid = isAdmin ? user?.uid : null;
  useEffect(() => {
    if (!uid) return undefined;
    let timer = null;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        getWatchlist(uid)
          .then((list) => syncMarketTargets(list))
          .catch((err) => console.error('카페 수집 대상 저장 실패', err));
      }, 800);
    };
    run();
    const off = subscribeWatchlist(run);
    return () => { clearTimeout(timer); off(); };
  }, [uid]);
}
