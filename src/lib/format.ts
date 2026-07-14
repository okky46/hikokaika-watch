// 日付・価格の表示整形(タイムゾーンは日本時間で固定)
const TZ = 'Asia/Tokyo';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return '—';
  return `${price.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}円`;
}

/** 経過日数(a から b まで)。負値や不正日付は null */
export function daysBetween(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.floor((b - a) / 86_400_000);
}

/** 報道年(絞り込み用) */
export function reportYear(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Number(
    new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, year: 'numeric' })
      .format(d)
      .replace(/[^0-9]/g, ''),
  );
}
