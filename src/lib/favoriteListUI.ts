import type {SupabaseClient} from '@supabase/supabase-js';
import {createPersonalWatch,LOCAL_WATCH_KEY} from './personalWatch.ts';

/** List, detail and My Page share one store, including the existing anonymous browser store. */
export async function setupFavoriteList(db:SupabaseClient|null,onChange:(rows:Map<string,number>)=>void,storage:Pick<Storage,'getItem'|'setItem'>={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)}){
 const repo=createPersonalWatch(db,storage);
 const status=document.querySelector<HTMLElement>('[data-favorite-status]');
 let busy=false,identityChanged=false;
 function message(text:string){if(status){status.textContent=text;status.hidden=!text;}}
 function render(){
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-fav-toggle]')){
   const on=!identityChanged&&!!repo.rows[button.dataset.favToggle!]?.watching;
   const label=on?'お気に入りから外す':'お気に入りに追加';
   const name=button.closest('.tracking-company')?.querySelector('.case-link')?.textContent??'この銘柄';
   button.textContent=on?'★':'☆';button.title=label;button.setAttribute('aria-label',`${name}を${label}`);button.setAttribute('aria-pressed',String(on));button.disabled=busy||!repo.ready||identityChanged;
  }
  document.querySelectorAll<HTMLElement>('[data-login-only]').forEach(el=>el.hidden=!repo.ready||identityChanged);
  onChange(new Map(identityChanged?[]:Object.entries(repo.rows).filter(([,r])=>r.watching).map(([id,r])=>[id,r.intensity])));
 }
 async function load(){
  if(busy||identityChanged)return;busy=true;render();
  try{await repo.load();message('');}catch(e){message(e instanceof Error?e.message:'お気に入りを読み込めません。再読み込みしてください。');}
  finally{busy=false;render();}
 }
 document.addEventListener('click',async event=>{
  const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-fav-toggle]');
  if(!button||busy||!repo.ready||identityChanged)return;
  const id=button.dataset.favToggle!,on=!repo.rows[id]?.watching;
  busy=true;render();
  try{await repo.follow(id,on);message(on?(repo.account?'お気に入りに追加しました。':'お気に入りに追加しました。このブラウザーに保存します。'):'お気に入りから外しました。メモは残ります。');}
  catch(e){message(e instanceof Error?e.message:'お気に入りを保存できません。もう一度お試しください。');}
  finally{busy=false;render();}
 });
 window.addEventListener('storage',event=>{if(event.key===LOCAL_WATCH_KEY&&!repo.account)void load();});
 window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
 await load();
 db?.auth.onAuthStateChange((event,session)=>{
  if((event==='SIGNED_IN'||event==='SIGNED_OUT')&&(session?.user.id??null)!==repo.identity){identityChanged=true;render();message('ログイン状態が変わりました。再読み込みすると、その保存先のお気に入りを表示します。');}
 });
}
