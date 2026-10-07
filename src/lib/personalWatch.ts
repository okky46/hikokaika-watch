import type { SupabaseClient } from '@supabase/supabase-js';
import { parseStructuredNote,chooseNoteSaveBody,type StructuredNotePayload } from './noteMetadataHelpers.ts';

export interface PersonalRecord { watching:boolean; intensity:number; body:string }
export const LOCAL_WATCH_KEY='hikokaika:personal-watch:v1';
export function readLocalWatch(storage:Pick<Storage,'getItem'>):Record<string,PersonalRecord>{
  let value:unknown;
  try{const raw=storage.getItem(LOCAL_WATCH_KEY);if(!raw)return {};value=JSON.parse(raw);}
  catch{throw Error('保存済みの記録を読み込めません。データを消さず、ブラウザーの保存設定を確認してください。');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('保存済みの記録を読み込めません。データを消さず、保存設定を確認してください。');
  const result:Record<string,PersonalRecord>={};
  for(const [id,r] of Object.entries(value)){
    const row=r as PersonalRecord;
    if(!/^[a-z0-9-]{1,80}$/i.test(id)||!row||typeof row.body!=='string'||row.body.length>10000||typeof row.watching!=='boolean')throw Error('保存済みの記録の形式を確認できません。データを消さず、管理者へお問い合わせください。');
    result[id]={watching:row.watching,intensity:[1,2,3].includes(row.intensity)?row.intensity:1,body:row.body};
  }return result;
}
export const emptyRecord=():PersonalRecord=>({watching:false,intensity:1,body:''});

/** Existing account tables are authoritative. Never silently fall back to another identity on a read/write failure. */
export function createPersonalWatch(db:SupabaseClient|null,storage:Pick<Storage,'getItem'|'setItem'>){
  let rows:Record<string,PersonalRecord>={},userId:string|null=null,ready=false;
  async function load(){
    ready=false;rows={};userId=null;
    if(db){
      const session=await db.auth.getSession();if(session.error)throw Error('ログイン状態を確認できません。通信を確認して再読み込みしてください。');
      userId=session.data.session?.user.id??null;
    }
    if(userId&&db){
      const [f,n]=await Promise.all([db.from('user_case_favorites').select('case_id,intensity'),db.from('user_case_notes').select('case_id,body')]);
      if(f.error||n.error)throw Error('監視中の銘柄とメモを読み込めません。通信を確認して再読み込みしてください。');
      for(const x of f.data??[])rows[x.case_id]={...emptyRecord(),watching:true,intensity:x.intensity};
      for(const x of n.data??[])rows[x.case_id]={...(rows[x.case_id]??emptyRecord()),body:x.body};
    }else rows=readLocalWatch(storage);
    ready=true;return rows;
  }
  async function currentIdentity(){
    if(!ready)throw Error('記録の読み込みが完了していません。再読み込みしてから保存してください。');
    if(db){const s=await db.auth.getSession();if(s.error||(s.data.session?.user.id??null)!==userId){ready=false;throw Error('ログイン状態が変わりました。入力を控え、再読み込みしてから保存してください。');}}
  }
  function localSave(id:string,r:PersonalRecord,editing=false){
    // Read at write-time so changes made in another tab are not lost.
    const current=readLocalWatch(storage);
    if(editing&&(current[id]?.body??'')!==(rows[id]?.body??''))throw Error('別のタブで記録が変わりました。入力を控え、再読み込みしてから保存してください。');
    current[id]=editing?r:{...(current[id]??r),watching:r.watching};
    try{storage.setItem(LOCAL_WATCH_KEY,JSON.stringify(current));}
    catch{throw Error('このブラウザーに保存できません。入力を控え、空き容量や保存設定を確認してからもう一度保存してください。');}
    rows=current;
  }
  async function follow(id:string,watching:boolean){
    await currentIdentity();const r=rows[id]??emptyRecord();
    if(db&&userId){
      const result=watching?await db.from('user_case_favorites').upsert({user_id:userId,case_id:id,intensity:r.intensity}):await db.from('user_case_favorites').delete().eq('user_id',userId).eq('case_id',id);
      if(result.error)throw Error('監視の設定を保存できません。通信を確認し、もう一度お試しください。');
      rows[id]={...r,watching};
    }else localSave(id,{...r,watching});
  }
  async function save(id:string,note:StructuredNotePayload){
    await currentIdentity();const prior=rows[id]??emptyRecord();
    const result=chooseNoteSaveBody(note,parseStructuredNote(prior.body).format);
    if(!result.ok)throw Error(result.message);
    if(db&&userId){
      const saved=await db.from('user_case_notes').upsert({user_id:userId,case_id:id,body:result.body});
      if(saved.error)throw Error('記録を保存できません。入力を控え、通信を確認してもう一度保存してください。');
      rows[id]={...prior,body:result.body};
      try{await follow(id,true);}catch{throw Error('メモは保存しましたが、監視への追加ができませんでした。「監視する」をもう一度押してください。');}
    }else localSave(id,{...prior,watching:true,body:result.body},true);
  }
  return {load,follow,save,get rows(){return rows;},get account(){return !!userId;},get identity(){return userId;},get ready(){return ready;}};
}
