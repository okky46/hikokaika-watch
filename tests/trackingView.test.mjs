import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {setupTrackingView} from '../src/lib/trackingView.ts';

function page({narrow=false,saved=null,blocked=false}={}) {
  const dom=new JSDOM(`<div data-tracking-view-controls hidden>
    <button data-tracking-layout="list" aria-pressed="true">リスト</button>
    <button data-tracking-layout="cards" aria-pressed="false">カード</button>
    </div><div id="tracking-results" data-layout="list"><table><tbody>
    <tr data-case-id="a" hidden><td><button data-fav-toggle="a" aria-pressed="true">★</button></td></tr>
    <tr data-case-id="b"><td>確認中</td></tr></tbody></table></div>`,
    {url:'https://local.invalid/?q=確認'});
  dom.window.matchMedia=()=>({matches:narrow});
  if(saved!==null)dom.window.localStorage.setItem('tracking-list-layout',saved);
  if(blocked)Object.defineProperty(dom.window,'localStorage',{get(){throw new Error('blocked');}});
  return dom;
}
const layout=dom=>dom.window.document.querySelector('#tracking-results').dataset.layout;
const choose=(dom,value)=>dom.window.document.querySelector(`[data-tracking-layout="${value}"]`).click();

test('狭幅でもリストを選べ、広幅の再訪でも保存したカードを優先する',()=>{
  const mobile=page({narrow:true});setupTrackingView(mobile.window.document);
  assert.equal(layout(mobile),'cards');
  choose(mobile,'list');assert.equal(layout(mobile),'list');
  const saved=mobile.window.localStorage.getItem('tracking-list-layout');mobile.window.close();
  const revisit=page({narrow:true,saved});setupTrackingView(revisit.window.document);
  assert.equal(layout(revisit),'list');choose(revisit,'cards');revisit.window.close();
  const desktop=page({saved:'cards'});setupTrackingView(desktop.window.document);
  assert.equal(layout(desktop),'cards');
  assert.equal(desktop.window.document.querySelector('[data-tracking-layout=cards]').getAttribute('aria-pressed'),'true');
  assert.equal(desktop.window.document.querySelector('[data-tracking-layout=list]').getAttribute('aria-pressed'),'false');
  desktop.window.close();
});

test('切替で検索結果の非表示・並び順・お気に入りの要素を作り直さない',()=>{
  const dom=page();const doc=dom.window.document;
  const rows=[...doc.querySelectorAll('tr')],favorite=doc.querySelector('[data-fav-toggle]'),search=dom.window.location.search;
  setupTrackingView(doc);choose(dom,'cards');choose(dom,'list');
  assert.deepEqual([...doc.querySelectorAll('tr')],rows);
  assert.equal(rows[0].hidden,true);assert.equal(rows[1].hidden,false);
  assert.equal(doc.querySelector('[data-fav-toggle]'),favorite);
  assert.equal(favorite.getAttribute('aria-pressed'),'true');
  assert.equal(dom.window.location.search,search);
  assert.equal(doc.querySelector('[data-tracking-view-controls]').hidden,false);
  dom.window.close();
});

test('保存先が使えなくても切替でき、不正な保存値は初期表示へ戻す',()=>{
  for(const options of [{blocked:true},{saved:'unknown'}]){
    const dom=page(options);setupTrackingView(dom.window.document);
    assert.equal(layout(dom),'list');choose(dom,'cards');assert.equal(layout(dom),'cards');
    choose(dom,'list');assert.equal(layout(dom),'list');dom.window.close();
  }
});
