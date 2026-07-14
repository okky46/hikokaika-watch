// @ts-check
import { defineConfig } from 'astro/config';

// 公開サイトのURL。Cloudflare Pages のカスタムドメイン確定後に変更する。
// 環境変数 SITE_URL があればそちらを優先する。
const SITE_URL = process.env.SITE_URL || 'https://hikokaika-watch.pages.dev';

export default defineConfig({
  site: SITE_URL,
  // 公開情報は静的配信を基本とする(要件9・21)。
  // 公開ページの閲覧で Supabase へアクセスしない構成のため、SSR は使わない。
  output: 'static',
  build: {
    format: 'directory',
  },
});
