// ============================================================
// ブラウザ用 Supabase クライアント(anon key + RLS)
// ログインユーザー機能(認証・お気に入り・メモ)と管理画面でのみ使用する。
// 公開ページの通常閲覧では import されず、Supabase への接続は発生しない。
// ============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** 環境変数が未設定(ログイン機能無効)の場合は null を返す */
export function getSupabase(): SupabaseClient | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key);
  }
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.PUBLIC_SUPABASE_URL && import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
  );
}
