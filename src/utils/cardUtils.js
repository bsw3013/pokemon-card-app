import { normalizePokedexNumber } from './numberUtils';
import { normalizeStatus } from './statusUtils';

export function formatCardPayload(payload) {
  return {
    cardName: String(payload.cardName || '').trim(),
    series: String(payload.series || '').trim(),
    cardNumber: String(payload.cardNumber || '').trim(),
    pokedexNumber: normalizePokedexNumber(payload.pokedexNumber || ''),
    rarity: String(payload.rarity || '').trim(),
    type: String(payload.type || '').trim(),
    status: normalizeStatus(payload.status || '미보유'),
    language: String(payload.language || '한국').trim(),
    price: Number(payload.price) || 0,
    imageUrl: String(payload.imageUrl || '').trim(),
    possessions: Array.isArray(payload.possessions) ? payload.possessions : [],
  };
}
