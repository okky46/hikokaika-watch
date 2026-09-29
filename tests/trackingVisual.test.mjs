import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTrackingProfile, parseTrackingProfile } from '../src/lib/trackingProfile.ts';
import { trackingVisual, trackingActivity, quietDays, firstReportLabel } from '../src/lib/trackingVisual.ts';
import { publicEventDate } from '../src/lib/trackingDates.ts';

const event='30000000-0000-4000-8000-000000000001';
const report={outlet_id:'nikkei',event_id:event,source_name:'確認用',source_url:'https://example.com/report',method:'direct',access:'partial',checked_on:'2026-09-29',reported_on:'2026-01-01',scope_note:'公開部分で確認'};
const profile=()=>({...emptyTrackingProfile(),title:'検証',short_reason:'検証',last_checked_on:'2026-09-29',report_state:'reported',reports:[report]});

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
    assert.equal(trackingVisual(p).tone,stage);
    assert.match(trackingVisual(p).label,/入札の報道/);
    assert.match(trackingVisual({...p,public_status:'proposal'}).processLabel,/入札の報道/);
    assert.equal(trackingVisual({...p,public_status:'proposal'}).label,'提案受領');
  }
  for(const change of [{bidding:{stage:'guessed',event_id:event}},{reports:[{...report,event_id:''}]},{public_status:'consideration_denied'},{report_state:'none',reports:[]},{bidding:{stage:'final_round',event_id:''}}]) {
    assert.throws(()=>parseTrackingProfile({...profile(),bidding:{stage:'final_round',event_id:event},...change},true));
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
