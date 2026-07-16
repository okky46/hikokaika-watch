export interface SparklinePoint { date: string; price: number }
export interface SparklineMarker { date: string; kind: 'report' | 'comment' | 'announce' }
export interface SparklineInput {
  points: SparklinePoint[];
  markers: SparklineMarker[];
  offerPrice?: number;
  width: number;
  height: number;
}

const MARKER_COLORS: Record<SparklineMarker['kind'], string> = {
  report: 'var(--heat-3-fg)',
  comment: 'var(--heat-1-fg)',
  announce: 'var(--post-announced-fg)',
};

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

export function renderSparkline(input: SparklineInput): string {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const points = input.points
    .filter((p) => Number.isFinite(p.price) && Number.isFinite(Date.parse(p.date)))
    .slice()
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const title = `株価推移: ${points.length}点${input.offerPrice !== undefined ? '、公開買付価格線あり' : ''}`;
  if (points.length === 0) {
    return `<svg role="img" aria-label="${escapeAttr(title)}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><title>${escapeAttr(title)}</title></svg>`;
  }

  const times = points.map((p) => Date.parse(p.date));
  const values = points.map((p) => p.price);
  if (input.offerPrice !== undefined && Number.isFinite(input.offerPrice)) values.push(input.offerPrice);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...values);
  const maxPrice = Math.max(...values);
  const pad = Math.min(6, Math.floor(height / 4));
  const chartHeight = Math.max(1, height - pad * 2);
  const x = (date: string) => {
    const t = Date.parse(date);
    return maxTime === minTime ? width / 2 : ((t - minTime) / (maxTime - minTime)) * width;
  };
  const y = (price: number) => {
    return maxPrice === minPrice ? height / 2 : pad + ((maxPrice - price) / (maxPrice - minPrice)) * chartHeight;
  };
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(2)} ${y(p.price).toFixed(2)}`).join(' ');
  const markers = input.markers
    .filter((m) => MARKER_COLORS[m.kind] && Number.isFinite(Date.parse(m.date)))
    .map((m) => `<line x1="${x(m.date).toFixed(2)}" x2="${x(m.date).toFixed(2)}" y1="0" y2="${height}" stroke="${MARKER_COLORS[m.kind]}" stroke-width="1" />`)
    .join('');
  const offer = input.offerPrice !== undefined && Number.isFinite(input.offerPrice)
    ? `<line x1="0" x2="${width}" y1="${y(input.offerPrice).toFixed(2)}" y2="${y(input.offerPrice).toFixed(2)}" stroke="var(--post-announced-fg)" stroke-width="1" stroke-dasharray="3 3" />`
    : '';
  return `<svg role="img" aria-label="${escapeAttr(title)}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><title>${escapeAttr(title)}</title>${offer}${markers}<path d="${d}" fill="none" stroke="var(--color-primary)" stroke-width="1.6" vector-effect="non-scaling-stroke" /></svg>`;
}
