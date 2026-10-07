export type WatchManifest = Record<string,string>;
export interface ReadState { at:string; entries:WatchManifest }
const KEY='hikokaika:checked:v1';
export function changedEntries(current:WatchManifest,prior:WatchManifest):string[]{
  return [...new Set([...Object.keys(current),...Object.keys(prior)])].filter(k=>current[k]!==prior[k]);
}
export function readChecked(storage:Pick<Storage,'getItem'>):Record<string,ReadState>{
  try{const x=JSON.parse(storage.getItem(KEY)??'{}');if(!x||typeof x!=='object'||Array.isArray(x))return {};
    const result:Record<string,ReadState>={};
    for(const [id,row] of Object.entries(x).slice(-300)){
      const r=row as ReadState;if(!r||!Number.isFinite(Date.parse(r.at))||!r.entries||typeof r.entries!=='object'||Array.isArray(r.entries))continue;
      if(Object.entries(r.entries).length>600||Object.values(r.entries).some(v=>typeof v!=='string'||!/^[a-f0-9]{16}$/.test(v)))continue;
      if(/^[a-z0-9-]{1,80}$/i.test(id))result[id]=r;
    }return result;
  }catch{return {};}
}
export function saveChecked(storage:Pick<Storage,'getItem'|'setItem'>,id:string,entries:WatchManifest,at=new Date().toISOString()):void{
  const map=readChecked(storage);delete map[id];map[id]={at,entries};
  storage.setItem(KEY,JSON.stringify(Object.fromEntries(Object.entries(map).slice(-300))));
}
export function setupWatchReadState(){
  const list=[...document.querySelectorAll<HTMLElement>('[data-watch-case]')];
  const filter=document.querySelector<HTMLInputElement>('[data-watch-updates-only]');
  function refresh(){
    let saved:Record<string,ReadState>={};try{saved=readChecked(localStorage);}catch{}
    for(const root of list){
      const id=root.dataset.watchCase!,manifest=JSON.parse(root.dataset.watchManifest??'{}') as WatchManifest,previous=saved[id];
      const changes=previous?changedEntries(manifest,previous.entries):[];
      root.dataset.watchChanged=String(changes.length>0);
      const badge=root.querySelector<HTMLElement>('[data-watch-badge]');
      if(badge){badge.hidden=!previous;badge.textContent=changes.length?'確認後に更新あり':'ここまで確認済み';badge.classList.toggle('watch-badge--changed',changes.length>0);}
      const message=root.querySelector<HTMLElement>('[data-watch-message]');
      if(message)message.textContent=previous?`${new Date(previous.at).toLocaleString('ja-JP')}に確認。${changes.length?`${changes.length}項目に追加・修正・取り下げがあります。`:'確認した内容から変更はありません。'}`:'読み終えたら「ここまで確認済みにする」で記録できます。';
      root.querySelectorAll<HTMLElement>('[data-watch-item]').forEach(item=>{
        const changed=!!previous&&changes.includes(item.dataset.watchItem!);item.classList.toggle('watch-item--changed',changed);
        item.querySelector<HTMLElement>('[data-item-change]')?.remove();
        if(changed){const b=document.createElement('span');b.dataset.itemChange='';b.className='watch-badge watch-badge--changed';b.textContent='確認後に追加・修正';item.prepend(b);}
      });
      const links=root.querySelector<HTMLElement>('[data-watch-change-links]');
      if(links){links.replaceChildren();for(const item of root.querySelectorAll<HTMLElement>('.watch-item--changed')){
        const anchor=document.createElement('a');anchor.href=`#${item.id||'case-overview'}`;
        anchor.textContent=item.querySelector('h2,h3,h1')?.textContent?.trim()||'経過の更新';
        links.append(anchor);
      }}
      // Only the dedicated revisit list is hidden here; the main list keeps its own filters.
      if(root.hasAttribute('data-revisit-row'))root.hidden=!previous||(!!filter?.checked&&!changes.length);
    }
    const empty=document.querySelector<HTMLElement>('[data-revisit-empty]');if(empty){
      empty.hidden=list.some(el=>el.hasAttribute('data-revisit-row')&&!el.hidden);
      empty.replaceChildren(filter?.checked?'確認後に更新があった銘柄はありません。':'確認済みにした銘柄はまだありません。');
      if(!filter?.checked){const link=document.createElement('a');link.href='/';link.textContent='銘柄一覧';empty.append(link,'から経過を読み、確認済みにするとここで追えます。');}
    }
    document.dispatchEvent(new Event('watch-state-updated'));
  }
  for(const root of list)root.querySelector('[data-watch-mark]')?.addEventListener('click',()=>{
    try{saveChecked(localStorage,root.dataset.watchCase!,JSON.parse(root.dataset.watchManifest??'{}'));refresh();}
    catch{const message=root.querySelector('[data-watch-message]');if(message)message.textContent='確認状態を保存できませんでした。ブラウザーの保存設定を確認して、もう一度お試しください。';}
  });
  filter?.addEventListener('change',refresh);window.addEventListener('storage',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('watch-baseline-saved',refresh);refresh();
}
