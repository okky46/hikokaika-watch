import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {marketMetrics} from '../src/lib/marketMetrics.ts';
import {tobTermsFor} from '../src/lib/tobTerms.ts';
import {renderAstro} from './renderAstro.mjs';
const financials=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8')).find(v=>v.kind==='financials'&&v.code==='0001');
const offer={price:3000,priceDate:'2026-06-01',shareBasisOn:'2026-03-31',sourceName:'開示'};
const c={tracking:{public_status:'delisted'},formalOfferPrice:offer,dailyCloses:[{...offer,price:2700,priceDate:'2026-10-09'}],preRumorClose:null};

test('上場廃止・非公開化完了だけがTOB価格を使用し、終値や初期価格で代用しない',()=>{
 for(const status of ['delisted','privatized']){
  const m=marketMetrics({...c,tracking:{public_status:status}},financials,'2026-10-14');
  assert.equal(m.price.price,3000);assert.equal(m.multiple,(3000*financials.facts.shares.value+financials.facts.debt.value-financials.facts.cash.value+financials.facts.adjustments.value)/financials.facts.ebitda.value);
  assert.equal(m.listMultiple,m.multiple);assert.equal(m.listBasis,'実績');assert.equal(m.forecastMultiple,null);
 }
 for(const status of ['announced','offer_open','offer_succeeded','withdrawn','failed','consideration_ended']){
  const m=marketMetrics({...c,tracking:{public_status:status}},financials,'2026-10-14');assert.equal(m.reference,false);assert.equal(m.price.price,2700);
 }
 for(const price of [null,{...offer,price:0},{...offer,price:NaN},{...offer,priceDate:'2026-10-15'},{...offer,priceDate:'2026-02-30'}]){
  const m=marketMetrics({...c,formalOfferPrice:price},financials,'2026-10-14');assert.equal(m.price,null);assert.equal(m.multiple,null);
 }
 for(const shareBasisOn of [null,'2025-03-31'])assert.equal(marketMetrics({...c,formalOfferPrice:{...offer,shareBasisOn}},financials).multiple,null);
});

test('確認済み条件は案件と状況文が一致するときだけ使い、登録価格の変更を上書きしない',()=>{
 const r=JSON.parse(fs.readFileSync('data/tob-terms.json','utf8')).find(r=>r.code==='3593');
 const item={...c,formalOfferPrice:null,slug:r.slug,securityCode:r.code,tracking:{public_status:'delisted',status_note:r.sourceStatusNote}};
 assert.equal(tobTermsFor(item).price,6700);assert.equal(marketMetrics(item).price.price,6700);
 assert.equal(tobTermsFor({...item,slug:'another-deal'}),null);
 assert.equal(tobTermsFor({...item,tracking:{...item.tracking,status_note:'価格変更'}}),null);
 const changed=marketMetrics({...item,formalOfferPrice:{...offer,price:6800,shareBasisOn:undefined}});
 assert.equal(changed.price.price,6800);assert.equal(changed.price.shareBasisOn,undefined);
 const identical=marketMetrics({...item,formalOfferPrice:{price:6700,priceDate:r.priceDate}});
 assert.equal(identical.price.shareBasisOn,r.shareBasisOn);
});

test('トップと詳細の実描画で同じ参考価格・実績倍率を表示し、4指標と根拠を維持する',async()=>{
 const props={caseData:c,financials,detail:true};
 const detail=new JSDOM(await renderAstro('src/components/MarketQuote.astro',props)).window.document;
 const list=new JSDOM('<table><tr>'+await renderAstro('src/components/MarketCells.astro',props)+'</tr></table>').window.document;
 assert.equal(detail.querySelectorAll('.market-quote__item').length,4);
 assert.ok(detail.querySelector('.market-quote--reference'));
 assert.equal(detail.querySelector('.market-quote__item strong').textContent,list.querySelector('.tracking-price .tracking-value').textContent);
 assert.equal(detail.querySelector('.market-quote__ev strong').textContent,list.querySelector('.tracking-multiple .tracking-value').textContent);
 assert.match(list.querySelector('td').textContent,/実績倍率（参考）/);
 assert.match(detail.querySelector('details').textContent,/TOB価格 ×/);
 assert.match(detail.querySelector('details').textContent,/会社予想/);
 detail.defaultView.close();list.defaultView.close();
});

test('TOB条件は未確認を未確認のまま表示し、将来日や期日通過で成立と推定しない',async()=>{
 const r=JSON.parse(fs.readFileSync('data/tob-terms.json','utf8')).find(r=>r.code==='3989');
 const caseData={...c,formalOfferPrice:null,slug:r.slug,securityCode:r.code,tracking:{public_status:'offer_open',status_note:r.sourceStatusNote}};
 const html=await renderAstro('src/components/TobTerms.astro',{caseData});
 assert.match(html,/1,550円/);assert.match(html,/10\/27（終了予定）/);assert.match(html,/未確認/);assert.doesNotMatch(html,/確認済み/);
 const hidden=await renderAstro('src/components/TobTerms.astro',{caseData:{...caseData,tracking:{public_status:'rumor'}}});assert.doesNotMatch(hidden,/TOB条件/);
});
