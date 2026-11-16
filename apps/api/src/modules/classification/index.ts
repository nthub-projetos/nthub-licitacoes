export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[‐‑–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function classify(text: string, terms: string[]) {
  const normalized = normalize(text);
  const matches = terms.filter((term) => {
    const t = normalize(term);
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return t.length <= 5
      ? new RegExp('(?<![a-z0-9])' + escaped + '(?![a-z0-9])', 'i').test(
          normalized,
        )
      : normalized.includes(t);
  });
  return {
    matches,
    score: Math.min(95, matches.length * 20 + (matches.length ? 25 : 0)),
  };
}
