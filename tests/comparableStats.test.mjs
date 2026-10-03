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
