export const padTo4 = (num) => String(num).padStart(4, '0');

export const normalizePokedexNumber = (raw) => {
  if (raw === undefined || raw === null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  return s.replace(/\d+/g, (m) => padTo4(m));
};

export const displayPokedexNumber = (raw) => normalizePokedexNumber(raw);
