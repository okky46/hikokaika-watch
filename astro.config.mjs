// @ts-check
import { defineConfig } from 'astro/config';

// 公開サイトのURL。Cloudflare Pages のカスタムドメイン確定後に変更する。
// 環境変数 SITE_URL があればそちらを優先する。
const SITE_URL = process.env.SITE_URL || 'https://hikokaika.com';

export default defineConfig({
  site: SITE_URL,
  // 公開情報は静的配信を基本とする(要件9・21)。
  // 公開ページの閲覧で Supabase へアクセスしない構成のため、SSR は使わない。
  output: 'static',
  security: {
    csp: {
      directives: ["object-src 'none'", "base-uri 'none'", "form-action 'self'"],
      scriptDirective: {
        resources: ["'self'", 'https://static.cloudflareinsights.com', 'https://pagead2.googlesyndication.com', 'https://www.googletagservices.com', 'https://tpc.googlesyndication.com'],
      },
      // Preserve existing inline layout styles without permitting inline scripts.
      styleDirective: { resources: [{ resource: "'self'", kind: 'element' }, { resource: "'unsafe-inline'", kind: 'attribute' }] },
    },
  },
  build: {
    format: 'directory',
  },
});
