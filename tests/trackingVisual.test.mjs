import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyTrackingProfile, parseTrackingProfile } from '../src/lib/trackingProfile.ts';
import { trackingVisual, trackingActivity, quietDays, firstReportLabel } from '../src/lib/trackingVisual.ts';
import { publicEventDate } from '../src/lib/trackingDates.ts';

const event='30000000-0000-4000-8000-000000000001';
const report={outlet_id:'nikkei',event_id:event,source_name:'確認用',source_url:'https://example.com/report',method:'direct',access:'partial',checked_on:'2026-09-29',reported_on:'2026-01-01',scope_note:'公開部分で確認'};
const profile=()=>({...emptyTrackingProfile(),title:'検証',short_reason:'検証',last_checked_on:'2026-09-29',report_state:'reported',reports:[report]});

test('噂・正式発表・否定中止・完了を別の配色にし、古い入札情報で否定や完了を強調しない',()=>{
  assert.equal(trackingVisual({...profile(),report_state:'none',reports:[]}).tone,'rumor');
  assert.equal(trackingVisual(profile()).tone,'reported');
  for(const public_status of ['announced','offer_open','offer_succeeded']) {
    assert.equal(trackingVisual({...profile(),public_status}).tone,'announced');
  }
  for(const [statuses,tone] of [
    [['consideration_denied','report_denied','consideration_ended','withdrawn','failed'],'stopped'],
    [['delisted','privatized'],'complete'],
  ]) {
    for(const public_status of statuses) {
      assert.equal(trackingVisual({...profile(),public_status,bidding:{stage:'final_round',event_id:event}}).tone,tone);
    }
  }
  assert.equal(trackingVisual({...profile(),public_status:'comment'}).tone,'reported');
  assert.equal(trackingVisual({...profile(),public_status:'comment',report_state:'none',reports:[]}).tone,'neutral');
  assert.equal(trackingVisual({...profile(),public_status:'consideration',status_note:'決定した事実はない'}).tone,'process');
  assert.equal(trackingVisual(null).tone,'neutral');
});

test('180日を超えたときだけ淡色。更新日・確認日は経過期間をリセットしない',()=>{
  const p=profile();const activity={latestOn:'2026-01-01',undated:false};
  assert.equal(trackingVisual(p,activity,'2026-06-30').stale,false);
  assert.equal(trackingVisual(p,activity,'2026-07-01').stale,true);
  assert.equal(trackingVisual({...p,last_checked_on:'2026-07-01'},activity,'2026-07-01').staleLabel,'続報未確認・181日');
  assert.equal(quietDays({...activity,latestOn:'2026-12-01'},true,'2026-07-01'),null);
  assert.equal(quietDays(activity,true,'2026-02-30'),null);
  assert.equal(trackingVisual(p,{latestOn:'2026-06-30',undated:false},'2026-07-01').stale,false);
});

test('日付不明・号数・月のみの出来事から沈静化を推測せず、登録日にも置換しない',()=>{
  const precise=publicEventDate({occurred_at:'2026-01-01T12:00:00+09:00'});
  for(const override of [{precision:'unknown',value:''},{precision:'issue',value:'2026-01',issue_label:'1月号'},{precision:'month',value:'2026-01'}]){
    const activity=trackingActivity([precise,publicEventDate({occurred_at:null},override)]);
    assert.equal(activity.undated,true);assert.equal(trackingVisual(profile(),activity,'2026-09-29').stale,false);
  }
  assert.equal(trackingVisual(profile(),trackingActivity([]),'2026-09-29').stale,false);
});

test('正式発表・完了・否定・終了は時間だけで淡くならない',()=>{
  for(const public_status of ['consideration_denied','report_denied','announced','offer_open','offer_succeeded','delisted','privatized','consideration_ended','withdrawn','failed']){
    assert.equal(trackingVisual({...profile(),public_status},{latestOn:'2020-01-01',undated:false},'2026-09-29').stale,false);
  }
});

test('入札段階は明示入力と媒体の根拠が必要。文言や報道回数から推定しない',()=>{
  assert.equal(trackingVisual({...profile(),short_reason:'最終入札の噂'}).tone,'reported');
  for(const stage of ['first_round','second_round','final_round']) {
    const p=parseTrackingProfile({...profile(),bidding:{stage,event_id:event}},true);
    assert.equal(trackingVisual(p).tone,`reported_${stage}`);
    assert.equal(trackingVisual(p).label,'観測報道あり');
    assert.match(trackingVisual(p).processLabel,/入札の報道/);
    assert.match(trackingVisual({...p,public_status:'proposal'}).processLabel,/入札の報道/);
    assert.equal(trackingVisual({...p,public_status:'proposal'}).label,'提案受領');
  }
  for(const change of [{bidding:{stage:'guessed',event_id:event}},{reports:[{...report,event_id:''}]},{public_status:'consideration_denied'},{report_state:'none',reports:[]},{bidding:{stage:'final_round',event_id:''}}]) {
    assert.throws(()=>parseTrackingProfile({...profile(),bidding:{stage:'final_round',event_id:event},...change},true));
  }
});

test('噂の3段階は管理者設定だけを使い、公開ラベルは同じ。旧データは未評価',()=>{
  const p={...profile(),report_state:'none',reports:[],report_note:'伝聞・未確認'};
  assert.equal(parseTrackingProfile(p,true).rumor_strength,undefined);
  for(const [rumor_strength,tone] of [['weak','rumor'],['medium','rumor_medium'],['strong','rumor_strong']]){
    const saved=parseTrackingProfile({...p,rumor_strength},true);
    assert.equal(saved.rumor_strength,rumor_strength);
    assert.equal(trackingVisual(saved).tone,tone);
    assert.equal(trackingVisual(saved).label,'噂段階');
    assert.equal(trackingVisual({...profile(),rumor_strength}).tone,'reported');
    assert.equal(trackingVisual({...profile(),public_status:'consideration_denied',rumor_strength}).tone,'stopped');
  }
  for(const rumor_strength of ['',null,3,' strong ','guessed',{},['strong']])assert.throws(()=>parseTrackingProfile({...p,rumor_strength}));
});

test('会社の検討・協議への言及だけがオレンジ。入札の続報でも色系統と主タグを保つ',()=>{
  for(const public_status of ['rumor','proposal','comment','consideration','discussions']) {
    const p={...profile(),public_status};
    const acknowledged=['consideration','discussions'].includes(public_status);
    assert.equal(trackingVisual(p).tone,acknowledged?'process':'reported');
    for(const stage of ['first_round','second_round','final_round']){
      const visual=trackingVisual({...p,bidding:{stage,event_id:event}});
      assert.equal(visual.tone,acknowledged?stage:`reported_${stage}`);
      assert.equal(visual.label,trackingVisual(p).label);
      assert.match(visual.processLabel,/入札の報道/);
    }
  }
  for(const public_status of ['announced','delisted','withdrawn']){
    const p={...profile(),public_status};
    assert.deepEqual(trackingVisual({...p,bidding:{stage:'final_round',event_id:event}}),trackingVisual(p));
  }
  assert.equal(trackingVisual({...profile(),public_status:'consideration',status_note:'続報3件'}).tone,'process');
});

test('各配色・180日超の淡色でも文字コントラスト4.5以上、強度・入札段階を塗り分ける',()=>{
  const css=fs.readFileSync('src/styles/global.css','utf8');
  const luminance=hex=>{const rgb=hex.slice(1).length===3?hex.slice(1).split('').map(x=>x+x):hex.slice(1).match(/../g);return rgb.map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);};
  const colors=tone=>Object.fromEntries([...css.match(new RegExp(`\\.tracking-badge--${tone} \\{([^}]+)`))[1].matchAll(/--([\w-]+):\s*(#[\da-f]+);/g)].map(m=>[m[1],m[2]]));
  const groups=[['rumor','rumor_medium','rumor_strong'],['reported','reported_first_round','reported_second_round','reported_final_round'],['process','first_round','second_round','final_round']];
  for(const tones of [...groups,['neutral','announced','stopped','complete']]) {
    for(const tone of tones) {
      const c=colors(tone);
      for(const prefix of ['status','quiet'])if(c[`${prefix}-bg`]){
        const a=luminance(c[`${prefix}-bg`]),b=luminance(c[`${prefix}-fg`]);
        assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${tone} ${prefix}`);
      }
    }
  }
  for(const tones of groups)for(const prefix of ['status','quiet']){
    const values=tones.map(t=>luminance(colors(t)[`${prefix}-bg`]));
    assert.ok(values.every((v,i)=>i===0||v<values[i-1]),`${tones} ${prefix} monotonic`);
  }
});

test('初報は概要で根拠の日付を優先。不明な先行報道や報道なしを隠さない',()=>{
  assert.deepEqual(firstReportLabel(profile(),'2026-02-01T00:00:00Z'),{label:'初報',date:'2026-01-01',uncertain:false});
  const p={...profile(),reports:[report,{...report,reported_on:''}]};
  assert.equal(firstReportLabel(p,null).label,'日付確認済みの最初の報道');
  assert.equal(firstReportLabel({...p,reports:[{...report,reported_on:''}]},null).date,null);
  assert.equal(firstReportLabel({...p,report_state:'none',reports:[]},'2026-01-01T00:00:00Z').date,null);
  assert.equal(firstReportLabel(null,null).label,'初報：確認中');
  const dated=publicEventDate({occurred_at:'2026-01-01T00:00:00+09:00'});
  assert.deepEqual(firstReportLabel({...p,reports:[{...report,reported_on:''}]},'2026-01-01T00:00:00+09:00',[{id:event,date:dated}]),{label:'初報',date:'2026-01-01',uncertain:false});
  assert.equal(firstReportLabel({...p,reports:[{...report,reported_on:''}]},'not-a-date').date,null);
});
