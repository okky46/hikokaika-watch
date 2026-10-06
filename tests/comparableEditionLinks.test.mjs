import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler';
import {transform as stripTypes} from 'esbuild';
import {experimental_AstroContainer as AstroContainer} from 'astro/container';
import {JSDOM} from 'jsdom';
import {parseValuation} from '../src/lib/valuation.ts';

test('同じ案件の価格版リンクと平均の根拠が各版へ到達し、旧リンクも保持する',async()=>{
  const sample=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8')).find(r=>r.kind==='comparable');
  const eps={value:100,period:'2025年12月期',basis:'actual',scope:'consolidated',sourceName:'架空決算',sourceUrl:'https://example.com/results.pdf',note:'テスト専用'};
  const edition=(stage,price)=>parseValuation({...sample,code:'0001',name:'価格版確認用デモ企業',industry:'情報・通信業',offerPrice:price,priceStage:stage,multiples:{per:{value:price/100,basis:'actual',period:eps.period,method:'calculated',sourceUrl:eps.sourceUrl,calculation:'架空の通期EPSによるテスト'}},research:{dealId:'0001-20260101',buyer:'架空買付者',transactionType:'third_party',status:'completed',priceBasis:stage,scope:'consolidated',statisticsEligible:stage==='final',definitions:{per:'TOB価格÷連結通期実績EPS'},denominators:{eps},valuations:[]}});
  const records=[edition('initial',1000),edition('revised',1200),edition('final',1500),parseValuation({...sample,code:'0002',name:'旧形式デモ企業',research:undefined})];
  const original=JSON.stringify(records),compiled=new Map();
  const dataUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
  const fixtures=dataUrl('export const comparables='+JSON.stringify(records)+';export function loadValuations(){return {comparables};}');
  async function component(file){
    if(compiled.has(file))return compiled.get(file);
    let code=(await transform(fs.readFileSync(file,'utf8'),{filename:pathToFileURL(file).href,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:async s=>s})).code;
    code=code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime')).replace(/^import ["'].*(?:\?astro&type=style|\.css).*?["'];$/gm,'').replaceAll('import.meta.env',"({DEPLOY_ENV:'preview'})");
    for(const match of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]){
      const spec=match[1];if(!spec.startsWith('.'))continue;
      let target=path.resolve(path.dirname(file),spec),url;
      if(spec.endsWith('/valuationData'))url=fixtures;
      else if(spec.endsWith('/publicData'))url=dataUrl('export function loadPublicData(){return {isSampleData:true};}');
      else if(spec.endsWith('.astro'))url=await component(target);
      else {if(!fs.existsSync(target))target+='.ts';url=pathToFileURL(target).href;}
      code=code.replaceAll("'"+spec+"'","'"+url+"'").replaceAll('"'+spec+'"','"'+url+'"');
    }
    const url=dataUrl((await stripTypes(code,{loader:'ts',format:'esm'})).code);compiled.set(file,url);return url;
  }
  const Page=(await import(await component(path.resolve('src/pages/tob-comparables.astro')))).default;
  const container=await AstroContainer.create();
  const doc=new JSDOM(await container.renderToString(Page,{request:new Request('https://hikokaika.com/tob-comparables/')})).window.document;
  const ids=[...doc.querySelectorAll('[id]')].map(x=>x.id);assert.equal(new Set(ids).size,ids.length);
  const links=[...doc.querySelectorAll('[data-tob-row] th a')];
  assert.deepEqual(links.map(a=>a.getAttribute('href')),['#deal-0001-20260101-initial','#deal-0001-20260101-revised','#deal-0001-20260101-final','#legacy-3']);
  for(const [index,a] of links.entries())assert.equal(doc.getElementById(a.hash.slice(1)).querySelector('h2').textContent,`${records[index].name}（${records[index].code}）`);
  assert.equal(doc.getElementById('deal-0001-20260101').closest('article').id,'deal-0001-20260101-initial');
  const statistics=doc.querySelector('a[href="/tob-comparables/#deal-0001-20260101-final"]');assert(statistics);assert(statistics.parentElement.textContent.includes('15.0倍'));
  const References=(await import(await component(path.resolve('src/components/ValuationReferences.astro')))).default;
  const references=new JSDOM(await container.renderToString(References,{props:{financials:{kind:'financials',code:'0009',industry:'情報・通信業',facts:{eps}},comparables:records,industry:'情報・通信業'}})).window.document;
  assert.equal(references.querySelector('.reference-sources a').getAttribute('href'),'/tob-comparables/#deal-0001-20260101-final');
  const Calculator=(await import(await component(path.resolve('src/components/ValuationCalculator.astro')))).default;
  const calculator=new JSDOM(await container.renderToString(Calculator,{props:{financials:{kind:'financials',code:'0009',industry:'情報・通信業',facts:{eps}},comparables:records,industry:'情報・通信業'}})).window.document;
  assert.deepEqual([...calculator.querySelectorAll('.peer-details article>a')].map(a=>a.getAttribute('href')).filter(h=>h.includes('0001-')),['/tob-comparables/#deal-0001-20260101-initial','/tob-comparables/#deal-0001-20260101-revised','/tob-comparables/#deal-0001-20260101-final']);
  assert.equal(JSON.stringify((await import(fixtures)).comparables),original);
});
