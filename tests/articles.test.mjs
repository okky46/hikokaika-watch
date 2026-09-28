import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assembleArticles, formatArticleSources, parseArticleSources, parseArticleContent, parseResearchDraft } from '../src/lib/articles.ts';
import { eventDateLabel, eventSortKey, externalStockLinks } from '../src/lib/tracking.ts';
import { assemble } from '../src/lib/publicData.ts';
const sample=name=>JSON.parse(fs.readFileSync(`data/sample/${name}.json`,'utf8'));
const rows=sample('articles');
const companies=sample('companies').map(c=>({id:c.id,securityCode:c.security_code,nameJa:c.name_ja}));

test('出典の区切り文字・改行・バックスラッシュをJSON取込後も再保存できる',()=>{
  const content={...rows[0].published,sources:[{name:'会社IR | 決算説明資料\n追補\\notes\r\n確認',url:'https://example.com/ir?category=a|b',published_on:'',checked_on:'2026-09-29'},rows[0].published.sources[0]]};
  const imported=parseResearchDraft({version:1,kind:'article',slug:'source-escapes',company_codes:[],content}).content;
  const editor=formatArticleSources(imported.sources);
  assert.equal(editor.split('\n').length,2);
  const saved=parseArticleContent({...imported,sources:parseArticleSources(editor)},true);
  assert.deepEqual(saved.sources,imported.sources);
  assert.deepEqual(parseArticleSources(formatArticleSources(saved.sources)),saved.sources);
});

test('従来の出典入力・空の公表日・手動エスケープを読み、余分な区切りを拒否する',()=>{
  const source={name:'会社IR',url:'https://example.com/ir',published_on:'',checked_on:'2026-09-29'};
  assert.deepEqual(parseArticleSources('会社IR | https://example.com/ir | | 2026-09-29\r\n'),[source]);
  assert.equal(parseArticleSources(String.raw`会社IR \| 追補\\notes | https://example.com/ir | | 2026-09-29`)[0].name,'会社IR | 追補\\notes');
  assert.throws(()=>parseArticleSources('会社IR | 追補 | https://example.com/ir | | 2026-09-29'),/1行4項目/);
  assert.deepEqual(parseArticleSources('  \n'),[]);
});
test('未公開記事・公開記事の編集中本文と関連付けは公開モデルに含まれない',()=>{
  const links=[...sample('article_companies'),{article_id:rows[0].id,company_id:companies[2].id,edition:'draft'}];
  const result=assembleArticles(rows,links,companies);
  assert.equal(result.length,1);assert.equal(result[0].title,rows[0].published.title);
  assert.equal(result[0].companies.length,2);
  assert.doesNotMatch(JSON.stringify(result),/SECRET_|unpublished-secret|"draft"/);
  assert.deepEqual(assembleArticles([{...rows[0],published:null}],links,companies),[]);
});
test('公開条件・日付・出典URLとドラフト取込を検証する',()=>{
  const content=rows[0].published;
  assert.throws(()=>parseArticleContent({...content,sources:[]},true));
  assert.throws(()=>parseArticleContent({...content,checked_on:'2026-02-30'},true));
  for(const url of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.com/'])assert.throws(()=>parseArticleContent({...content,sources:[{...content.sources[0],url}]},true));
  const draft=parseResearchDraft({version:1,kind:'article',slug:'sample-article',company_codes:['130A','130A'],content});
  assert.deepEqual(draft.company_codes,['130A']);assert.throws(()=>parseResearchDraft({...draft,company_codes:[130]}));
  assert.equal(parseArticleContent({...content,private_note:'secret'}).private_note,undefined);
});
test('報道も記事もない銘柄を保持し、株価更新を経過の更新にしない',()=>{
  const raw={companies:sample('companies'),cases:sample('cases'),events:sample('case_events'),prices:sample('price_snapshots'),articles:rows,articleLinks:sample('article_companies'),isSampleData:true};
  const data=assemble(raw);const tracking=data.details.find(c=>c.securityCode==='999Z');
  assert.equal(tracking.events.length,0);assert.equal(tracking.firstReportedAt,null);assert.equal(tracking.latestEvent,null);assert.equal(tracking.sparklineSvg,null);
  const before=data.details.find(c=>c.id===raw.prices[0].case_id).lastUpdatedAt;
  raw.prices[0].updated_at='2099-01-01T00:00:00Z';
  assert.equal(assemble(raw).details.find(c=>c.id===raw.prices[0].case_id).lastUpdatedAt,before);
  const hidden=raw.cases.find(c=>!c.is_visible);if(hidden)assert.ok(!data.cases.some(c=>c.id===hidden.id));
});
test('PR8の日付不明・号数を登録日で置き換えない。英字コードを維持',()=>{
  const e={date_precision:'issue',issue_label:'2026年9月号',occurred_at:null,sort_at:'2026-09-01T00:00:00Z'};
  assert.equal(eventDateLabel(e),'2026年9月号');assert.equal(eventSortKey(e),e.sort_at);
  assert.equal(eventDateLabel({...e,date_precision:'unknown'}),'日付未確認');
  assert.ok(externalStockLinks('130A').every(l=>l.url.includes('130A')));
});
