import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {comparableStats} from '../src/lib/comparableStats.ts';
import {parseValuation} from '../src/lib/valuation.ts';
const [,base]=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8'));
function record(code,value,changes={}){return parseValuation({...base,code,industry:'情報・通信業',offerPrice:value*100,multiples:{per:{...base.multiples.per,value,method:'calculated',period:'2023年12月期'}},research:{dealId:code+'-20231108',buyer:'架空買付者',transactionType:'parent_subsidiary',status:'completed',priceBasis:'final',scope:'consolidated',statisticsEligible:true,definitions:{per:'TOB価格÷通期実績EPS'},denominators:{eps:{value:100,period:'2023年12月期',basis:'actual',scope:'consolidated',sourceName:'架空決算',sourceUrl:'https://example.com/results.pdf',note:'テスト専用'}},valuations:[],...changes}});}
test('同業の成立・最終価格だけを集計し、平均・偶数中央値・範囲と母数を返す',()=>{
 const a=record('0001',10),b=record('0002',30),c=record('0003',20,{status:'announced'}),d=record('0004',90,{priceBasis:'initial'});
 const [s]=comparableStats([a,b,c,d,{...a,industry:'別業種'}],'情報・通信業');
 assert.deepEqual([s.count,s.mean,s.median,s.min,s.max],[2,20,20,10,30]);
 assert.equal(comparableStats([a,b],'情報・通信業',{excludeCode:'0001'})[0].mean,30);
 assert.equal(comparableStats([a,b],'情報・通信業',{fromYear:2099}).length,0);
});
test('同一案件の重複は除外し、定義・範囲・実績/予想を混ぜない',()=>{
 const a=record('0001',10),b=record('0002',30),c=record('0003',20,{definitions:{per:'異なる定義'}});
 assert.equal(comparableStats([a,structuredClone(a),b],'情報・通信業')[0].mean,30);
 assert.equal(comparableStats([a,b,c],'情報・通信業').length,2);
 const forecast=record('0004',40);forecast.multiples.per.basis='company_forecast';forecast.research.denominators.eps.basis='company_forecast';
 assert.equal(comparableStats([a,parseValuation(forecast)],'情報・通信業').length,2);
});
test('取引倍率を算定レンジで代用せず、計算と根拠の不一致を拒否する',()=>{
 const a=record('0001',10);a.multiples.per.value=12;assert.throws(()=>parseValuation(a),/一致/);
 const researchOnly=record('0002',20);researchOnly.multiples={};researchOnly.research.statisticsEligible=false;
 researchOnly.research.valuations=[{advisor:'架空証券',role:'対象会社',date:'2023-11-07',method:'dcf',low:1000,high:3000,sourceUrl:'https://example.com/report.pdf',page:'10頁',inputs:[{name:'割引率',unit:'%',period:'算定基準日',low:5,high:6,basis:'valuation_assumption',definition:'架空前提'}],peers:[],notes:'テスト専用'}];
 assert.equal(comparableStats([parseValuation(researchOnly)],'情報・通信業').length,0);
 researchOnly.research.valuations[0].sourceUrl='https://example.com/?api_key=secret';assert.throws(()=>parseValuation(researchOnly),/認証情報/);
});


test('20期DCFの年別前提を省略せず保持し、過大配列や末尾の不正値は拒否する',()=>{
 const r=record('0008',20);r.multiples={};r.research.statisticsEligible=false;
 const inputs=[];for(let y=2026;y<=2045;y++)for(const name of ['売上高','営業利益','EBITDA','FCF'])inputs.push({name,unit:'百万円',period:`${y}年3月期`,low:100,high:100,basis:'company_forecast',definition:'架空の20期計画'});
 inputs.push({name:'WACC',unit:'%',period:'評価期間',low:11.3,high:12.3,basis:'valuation_assumption',definition:'テスト割引率'});
 r.research.valuations=[{advisor:'架空証券',role:'対象会社',date:'2023-11-07',method:'dcf',low:1000,high:3000,sourceUrl:'https://example.com/report.pdf',page:'10頁',inputs,peers:[],notes:'テスト専用'}];
 assert.deepEqual(parseValuation(r).research.valuations[0].inputs,inputs);
 while(inputs.length<120)inputs.push(structuredClone(inputs[0]));assert.equal(parseValuation(r).research.valuations[0].inputs.length,120);
 inputs[119].low=Infinity;assert.throws(()=>parseValuation(r),/有限/);inputs[119].low=100;
 inputs.push(structuredClone(inputs[0]));assert.throws(()=>parseValuation(r),/120件/);inputs.pop();
 r.research.valuations[0].peers=Array(61).fill('架空会社');assert.throws(()=>parseValuation(r),/比較会社.*60件/);
});

 test('未確認日付・範囲・投資口単位と原調査の欠損を保持し、集計しない',()=>{
 const r=record('0008',20);r.multiples={};r.research.statisticsEligible=false;r.research.scope='unknown';r.priceUnit='円/口';
 r.research.valuations=[{advisor:'架空証券',role:'対象投資法人',date:'',method:'other',methodName:'DDM法',unit:'円/口',low:1000,high:3000,sourceUrl:'https://example.com/report.pdf',page:'10頁',inputs:[],peers:[],notes:'割引率は未確認'}];
 r.research.sourceReview={packageId:'test-review-v1',sha256:'a'.repeat(64),caseData:{security_code:r.code,statisticsEligible:false,wacc:null,notes:'原典の矛盾を保持'}};
 const parsed=parseValuation(r);assert.deepEqual(parsed,r);const ranges=structuredClone(r);ranges.research.valuations=Array.from({length:60},()=>structuredClone(r.research.valuations[0]));assert.equal(parseValuation(ranges).research.valuations.length,60);ranges.research.valuations.push(structuredClone(r.research.valuations[0]));assert.throws(()=>parseValuation(ranges),/60件/);assert.deepEqual(comparableStats([parsed],r.industry),[]);
 for(const change of [r=>r.research.statisticsEligible=true,r=>r.research.sourceReview.caseData.security_code='9999',r=>r.research.sourceReview.caseData.statisticsEligible=true,r=>r.research.sourceReview.caseData.large='x'.repeat(200001),r=>r.research.valuations[0].date='2026-02-30',r=>r.priceUnit='USD']){const bad=structuredClone(r);change(bad);assert.throws(()=>parseValuation(bad));}
 });
