import { createContext } from 'react';

// 카드 목록을 앱 전체에서 함께 쓰기 위한 통로. 값은 CardsProvider(src/CardsContext.jsx)가 채운다.
export const CardsContext = createContext(null);
