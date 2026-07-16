export type LoadedNoteFormat = 'v1' | 'legacy';

export type StructuredNotePayload = {
  v: 1;
  scenario: string;
  targetPrice: string;
  exitCondition: string;
  nextCheckDate: string;
  freeText: string;
};

export type SaveNoteResult =
  | { ok: true; body: string; format: LoadedNoteFormat; length: number }
  | { ok: false; message: string; length: number };

export type LargeShareholdingMetadata = {
  holder_name: string;
  ratio: number;
  previous_ratio: number | null;
  filing_date: string | null;
  change_type: 'new' | 'increase' | 'decrease' | 'exit' | string | null;
  corrected?: true;
  correction_note?: string;
};

export type LargeShareholdingView = {
  holderName: string;
  ratio: number;
  previousRatio: number | null;
  filingDate: string | null;
  changeType: 'new' | 'increase' | 'decrease' | 'exit' | null;
};

export const NOTE_BODY_LIMIT = 1000;

export function textLength(value: string): number {
  return Array.from(value).length;
}

export function isStructuredNotePayload(value: unknown): value is StructuredNotePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.v === 1
    && typeof candidate.scenario === 'string'
    && typeof candidate.targetPrice === 'string'
    && typeof candidate.exitCondition === 'string'
    && typeof candidate.nextCheckDate === 'string'
    && typeof candidate.freeText === 'string';
}

export function parseStructuredNote(body: string): { note: StructuredNotePayload; format: LoadedNoteFormat } {
  try {
    const parsed = JSON.parse(body);
    if (isStructuredNotePayload(parsed)) return { note: parsed, format: 'v1' };
  } catch { /* legacy */ }
  return { note: { v: 1, scenario: '', targetPrice: '', exitCondition: '', nextCheckDate: '', freeText: body }, format: 'legacy' };
}

export function serializeStructuredNote(note: StructuredNotePayload): string {
  return JSON.stringify(note);
}

export function chooseNoteSaveBody(note: StructuredNotePayload, loadedFormat: LoadedNoteFormat): SaveNoteResult {
  const jsonBody = serializeStructuredNote(note);
  const jsonLength = textLength(jsonBody);
  if (jsonLength <= NOTE_BODY_LIMIT) return { ok: true, body: jsonBody, format: 'v1', length: jsonLength };

  const hasStructuredFields = Boolean(note.scenario || note.targetPrice || note.exitCondition || note.nextCheckDate);
  const rawLength = textLength(note.freeText);
  if (loadedFormat === 'legacy' && !hasStructuredFields && rawLength <= NOTE_BODY_LIMIT) {
    return { ok: true, body: note.freeText, format: 'legacy', length: rawLength };
  }

  return { ok: false, message: '構造化項目を含めると1,000文字を超えるため保存できません。自由メモを短くしてください', length: jsonLength };
}

export function parsePercentInput(rawValue: string, label: string, required: boolean): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) return required ? { ok: false, error: `${label}を入力してください` } : { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: `${label}は数値で入力してください` };
  if (value < 0 || value > 100) return { ok: false, error: `${label}は0以上100以下で入力してください` };
  return { ok: true, value };
}

export function buildLargeShareholdingMetadata(input: {
  holderName: string;
  ratio: string;
  previousRatio: string;
  filingDate: string;
  changeType: string;
  corrected: boolean;
  correctionNote: string;
}): { ok: true; metadata: LargeShareholdingMetadata } | { ok: false; error: string } {
  const holderName = input.holderName.trim();
  if (!holderName) return { ok: false, error: '保有者名を入力してください' };
  const ratio = parsePercentInput(input.ratio, '保有割合', true);
  if (!ratio.ok) return ratio;
  const previousRatio = parsePercentInput(input.previousRatio, '前回割合', false);
  if (!previousRatio.ok) return previousRatio;
  if (ratio.value === null) return { ok: false, error: '保有割合を入力してください' };
  return {
    ok: true,
    metadata: {
      holder_name: holderName,
      ratio: ratio.value,
      previous_ratio: previousRatio.value,
      filing_date: input.filingDate || null,
      change_type: input.changeType,
      ...(input.corrected ? { corrected: true, correction_note: input.correctionNote.trim() } : {}),
    },
  };
}

export function isValidPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function sanitizeLargeShareholdingMetadata(eventType: string, metadata: Record<string, unknown> | null | undefined): LargeShareholdingView | null {
  if (eventType !== 'large_shareholding_report') return null;
  const holderName = typeof metadata?.holder_name === 'string' ? metadata.holder_name.trim() : '';
  const ratio = metadata?.ratio;
  if (!holderName || !isValidPercent(ratio)) return null;
  const previousRatio = isValidPercent(metadata?.previous_ratio) ? metadata.previous_ratio : null;
  const changeType = metadata?.change_type;
  return {
    holderName,
    ratio,
    previousRatio,
    filingDate: typeof metadata?.filing_date === 'string' && metadata.filing_date ? metadata.filing_date : null,
    changeType: changeType === 'new' || changeType === 'increase' || changeType === 'decrease' || changeType === 'exit' ? changeType : null,
  };
}
