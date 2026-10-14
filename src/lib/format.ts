export const EUR = (n: number) => '€' + Math.round(n).toLocaleString('en-GB');

export const EURExact = (n: number) =>
  '€' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PCT = (n: number) => `${Number(n.toFixed(2))}%`;

export const PAL = [
  '#3b6cff', '#f0a020', '#8b5cf6', '#12a594', '#e93d82', '#f76b15', '#5b5bd6',
  '#978365', '#0091ff', '#2a7e3b', '#9333ea', '#0d9488',
];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
