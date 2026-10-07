// 静的成果物を検査する。npm run buildの後に実行。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk('dist');
for(const file of files.filter(f=>/\.(html|json|xml|js)$/.test(f))){
  const text=fs.readFileSync(file,'utf8');
  if(process.env.EDINET_API_KEY)assert.ok(!text.includes(process.env.EDINET_API_KEY),`${file}: EDINET credential leak`);
  assert.doesNotMatch(text,/SECRET_UNAPPROVED_ARTICLE|SECRET_DRAFT_ONLY|unpublished-secret/,`${file}: draft leak`);
  if(file.endsWith('.html')&&!file.includes(`${path.sep}admin${path.sep}`))assert.doesNotMatch(text,/第0報|aria-label="株価推移/);
}
const read=file=>fs.readFileSync(`dist/${file}`,'utf8');
assert.doesNotMatch(read('index.html'),/data-watch-desk/);
assert.match(read('mypage/index.html'),/data-watch-desk/);
assert.match(read('mypage/index.html'),/id="mp-auth"/);
assert.match(read('mypage/index.html'),/id="mp-global-note"/);
assert.match(read('index.html'),/id="filter-form"/);
assert.match(read('stocks/index.html'),/追跡銘柄一覧はトップページに移りました/);
assert.doesNotMatch(read('sitemap.xml'),/\/stocks\//);
assert.match(read('cases/0001-toyo-demo-seiki/index.html'),/data-notebook=/);
assert.match(read('cases/0001-toyo-demo-seiki/index.html'),/観察と報道の経過/);
assert.match(read('cases/0001-toyo-demo-seiki/index.html'),/data-valuation-tool/);
assert.match(read('cases/0001-toyo-demo-seiki/index.html'),/価格の試算/);
assert.match(read('companies/0001/index.html'),/試算に使う登録値と出典/);
assert.match(read('tob-comparables/index.html'),/過去TOBデータの掲載は終了しました/);
assert.doesNotMatch(read('sitemap.xml'),/tob-comparables/);
assert.match(read('tob-comparables/index.html'),/noindex, nofollow/);
for(const file of ['index.html','cases/0001-toyo-demo-seiki/index.html','companies/0001/index.html','tob-comparables/index.html']) {
  assert.doesNotMatch(read(file),/価格のアテ|data-valuation(?: |>)|data-tob-row|data-metric-kind="(?:per|pbr)"|href="\/tob-comparables\//);
}
assert.ok(!fs.existsSync('dist/articles/unpublished-secret'));
assert.match(read('cases/999z-tracking/index.html'),/この銘柄の出来事はまだ掲載していません/);
assert.match(read('cases/999z-tracking/index.html'),/噂段階/);
assert.match(read('cases/999z-tracking/index.html'),/報道なし/);
assert.ok(!files.some(f=>/local-admin-check|__adminCheckClient/.test(f)), 'local test harness must not ship');
const trackingDescription=read('cases/999z-tracking/index.html').match(/<meta name="description" content="([^"]*)"/)?.[1];
assert.match(trackingDescription,/追跡開始から現在まで/);
assert.doesNotMatch(trackingDescription,/観測報道から/);
assert.match(read('cases/130a-kakuu-networks/index.html'),/https:\/\/kabutan.jp\/stock\/finance\?code=130A/);
assert.match(read('sitemap.xml'),/https:\/\/hikokaika.com\/articles\/demo-capital-policy\//);
assert.match(read('articles/demo-capital-policy/index.html'),/確認できた事実/);
assert.match(read('articles/demo-capital-policy/index.html'),/\/companies\/0001\//);
assert.match(read('articles/demo-capital-policy/index.html'),/\/companies\/0002\//);
for(const file of ['index.html','articles/index.html','articles/demo-capital-policy/index.html','mypage/index.html','admin/index.html']) assert.match(read(file),/noindex, nofollow/);
const source=fs.readFileSync('src/styles/global.css','utf8');
assert.match(source,/--font-sans: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN",\s*"Hiragino Sans", "BIZ UDPGothic", Meiryo, sans-serif;/);
assert.match(source,/--font-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;/);
assert.doesNotMatch(source,/@font-face/);
console.log('静的成果物: 下書き隔離、記事なし銘柄、関連記事、リンク、noindex、フォントを確認済み');
