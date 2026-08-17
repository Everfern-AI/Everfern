export function take<T>(array: readonly T[], n: number): T[] {
  return array.slice(0, Math.max(0, n));
}

export function pct(value: number): string {
  const bounded = Math.max(0, Math.min(1, value));
  return `${Math.round(bounded * 100)}%`;
}
