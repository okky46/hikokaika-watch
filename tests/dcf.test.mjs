import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dcf,dcfSensitivity} from '../src/lib/dcf.ts';
const base={fcff:[100,100,100,100,100],wacc:10,terminal:{method:'growth',growth:0,normalizedFcff:100},equityBridge:20,shares:1_000_000};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('DCF：定常FCFFの永久価値と一致し、株主価値へ調整して百万円を円へ換算する',()=>{
 const r=dcf(base);near(r.enterpriseValue,1000);near(r.equityValue,1020);near(r.price,1020);
 near(r.presentTerminal,1000/1.1**5);near(r.presentForecast,1000-r.presentTerminal);
 near(r.terminalShare,r.presentTerminal/1000*100);
 near(dcf({...base,equityBridge:-20}).price,980);
 near(dcf({...base,shares:2_000_000}).price,510);
});
test('DCF：正常化FCFFから翌期を求め、継続価値だけを5年後から割り引く',()=>{
 const r=dcf({...base,terminal:{method:'growth',growth:2,normalizedFcff:200}});
 near(r.presentTerminal,(200*1.02/.08)/1.1**5);
 near(r.presentForecast,dcf(base).presentForecast);
});
test('DCF：終期EBITDA倍率方式に成長率の継続価値を重ねない',()=>{
 const r=dcf({...base,terminal:{method:'multiple',ebitda:200,multiple:5}});
 near(r.enterpriseValue,1000);near(r.presentTerminal,1000/1.1**5);
});
test('DCF：途中の赤字FCFFも期末の時点で控除する',()=>{
 const r=dcf({...base,fcff:[-100,0,100,100,100]});
 near(r.presentForecast,dcf(base).presentForecast-200/1.1-100/1.1**2);
});
test('DCF：欠損・無限値・不正な期間数・正でない株式数と割引率を拒否する',()=>{
 for(const fcff of [[100,100],[100,100,NaN,100,100],[100,100,Infinity,100,100]])assert.equal(dcf({...base,fcff}),null);
 for(const shares of [0,-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(dcf({...base,shares}),null);
 for(const wacc of [0,-1,101,NaN,Infinity])assert.equal(dcf({...base,wacc}),null);
 assert.equal(dcf({...base,equityBridge:NaN}),null);
});
test('DCF：WACC以下の成長率差、負の継続条件、正でない株主価値では株価を表示しない',()=>{
 for(const growth of [10,11,-100,NaN])assert.equal(dcf({...base,terminal:{...base.terminal,growth}}),null);
 assert.equal(dcf({...base,terminal:{...base.terminal,normalizedFcff:0}}),null);
 assert.equal(dcf({...base,terminal:{method:'multiple',ebitda:200,multiple:0}}),null);
 assert.equal(dcf({...base,terminal:{method:'multiple',ebitda:0,multiple:5}}),null);
 assert.equal(dcf({...base,equityBridge:-2000}),null);
});
test('DCF：感応度の中央が基準値と一致し、WACC上昇・成長率低下で価格が下がる',()=>{
 const s=dcfSensitivity(base);assert.deepEqual(s.waccs,[9.5,10,10.5]);assert.deepEqual(s.terminals,[-.5,0,.5]);
 near(s.rows[1][1],dcf(base).price);assert.ok(s.rows[0][1]>s.rows[1][1]&&s.rows[1][1]>s.rows[2][1]);assert.ok(s.rows[1][0]<s.rows[1][1]&&s.rows[1][1]<s.rows[1][2]);
 const boundary=dcfSensitivity({...base,wacc:.6,terminal:{...base.terminal,growth:.5}});assert.equal(boundary.rows[0][2],null);
});
test('DCF：終期倍率の感応度は±0.5倍とし、正でない倍率のセルは表示しない',()=>{
 const input={...base,terminal:{method:'multiple',ebitda:200,multiple:.3}},s=dcfSensitivity(input);
 assert.deepEqual(s.terminals,[-.2,.3,.8]);assert.ok(s.rows.every(row=>row[0]===null));near(s.rows[1][1],dcf(input).price);
});
