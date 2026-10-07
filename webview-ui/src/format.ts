import type { Encoded, Num, SpaceDesc } from './types';

export function toNumber(v: Num | null | undefined): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  return NaN;
}

export function isBad(v: Num | null | undefined): boolean {
  return typeof v === 'string';
}

export function fmt(v: Num | null | undefined, digits = 4): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === 'Infinity' ? '+∞' : v === '-Infinity' ? '−∞' : 'NaN';
  if (Number.isInteger(v) && Math.abs(v) < 1e9) return v.toString();
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return v.toExponential(2);
  const s = v.toFixed(digits);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function fmtSigned(v: Num | null | undefined, digits = 3): string {
  const n = toNumber(v as Num);
  if (Number.isFinite(n) && n > 0) return `+${fmt(v, digits)}`;
  return fmt(v, digits);
}

export interface FlatValue {
  label: string;
  value: Num;
  index: number;
}

/** Flatten a vector/scalar observation into labelled values. Returns null for structured or large values. */
export function flatten(enc: Encoded | undefined | null, labels: string[] = []): FlatValue[] | null {
  if (!enc) return null;
  if (enc.kind === 'scalar') return [{ label: labels[0] ?? 'value', value: enc.value, index: 0 }];
  if (enc.kind === 'vector') {
    return enc.values.map((value, i) => ({ label: labels[i] ?? `obs[${i}]`, value, index: i }));
  }
  if (enc.kind === 'tuple' && enc.items.every((i) => i.kind === 'scalar')) {
    return enc.items.map((item, i) => ({
      label: labels[i] ?? `obs[${i}]`,
      value: (item as { value: Num }).value,
      index: i,
    }));
  }
  return null;
}

export function boundsOf(space: SpaceDesc | undefined, index: number): [number, number] | null {
  if (!space || space.type !== 'Box' || !Array.isArray(space.low) || !Array.isArray(space.high)) return null;
  const lo = toNumber(space.low[index]);
  const hi = toNumber(space.high[index]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo <= 0 || hi - lo > 1e4) return null;
  return [lo, hi];
}

export function actionLabel(labels: string[], index: number, start = 0): string {
  return labels[index] ?? `Action ${index + start}`;
}

export function describeEncoded(enc: Encoded | undefined | null, actionLabels: string[] = [], start = 0): string {
  if (!enc) return '—';
  switch (enc.kind) {
    case 'scalar':
      if (enc.integer && typeof enc.value === 'number' && actionLabels.length) {
        return `${actionLabels[enc.value - start] ?? enc.value} (${enc.value})`;
      }
      return fmt(enc.value);
    case 'vector':
      return `[${enc.values.map((v) => fmt(v, 3)).join(', ')}]`;
    case 'tensor':
      return `tensor ${enc.shape.join('×')} ${enc.dtype}`;
    case 'dict':
      return `{${Object.keys(enc.items).join(', ')}}`;
    case 'tuple':
      return `(${enc.items.map((i) => describeEncoded(i)).join(', ')})`;
    default:
      return enc.repr;
  }
}

export function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}
