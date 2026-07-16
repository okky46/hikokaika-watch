import type { PricePoint, RawPrice } from './types';

type DailyCloseWarning = (message: string) => void;

function timeValue(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function compareDailyClosePreference(a: RawPrice, b: RawPrice): number {
  const updatedDiff = timeValue(a.updated_at) - timeValue(b.updated_at);
  if (updatedDiff !== 0) return updatedDiff;
  const createdDiff = timeValue(a.created_at) - timeValue(b.created_at);
  if (createdDiff !== 0) return createdDiff;
  return a.id.localeCompare(b.id);
}

export function normalizeDailyCloses(prices: RawPrice[], warn: DailyCloseWarning = console.warn): PricePoint[] {
  const byDate = new Map<string, RawPrice>();
  for (const price of prices.filter((p) => p.price_type === 'daily_close')) {
    const numericPrice = Number(price.price);
    if (!Number.isFinite(numericPrice)) {
      warn(`[publicData] 案件 ${price.case_id} の ${price.price_date} のdaily_closeが不正な価格のためスキップ`);
      continue;
    }

    const existing = byDate.get(price.price_date);
    if (!existing) {
      byDate.set(price.price_date, price);
      continue;
    }

    const chosen = compareDailyClosePreference(price, existing) >= 0 ? price : existing;
    byDate.set(price.price_date, chosen);
    warn(`[publicData] 案件 ${price.case_id} の ${price.price_date} のdaily_closeが重複しているため最新更新行を採用`);
  }

  return [...byDate.values()]
    .sort((a, b) => a.price_date.localeCompare(b.price_date) || a.id.localeCompare(b.id))
    .map((p) => ({ price: Number(p.price), priceDate: p.price_date, sourceName: p.source_name }));
}

export function hasDailyCloseConflict(existingRows: { id: string }[], editingId: string | null | undefined): boolean {
  return existingRows.some((row) => row.id !== editingId);
}
