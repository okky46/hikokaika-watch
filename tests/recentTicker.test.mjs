import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {setupRecentTicker} from '../src/lib/recentTicker.ts';
test('最近の動き：自動切替・停止・読書中の停止・動きの低減を守る',()=>{
 const dom=new JSDOM('<section><button data-recent-pause hidden></button><div><a href="#a" data-recent-item>最初</a><a href="#b" data-recent-item hidden>次</a><a href="#c" data-recent-item hidden>最後</a></div><span data-recent-position>1 / 3</span><details></details></section>',{pretendToBeVisual:true});
 const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window=dom.window;globalThis.document=dom.window.document;
 let tick,cleared=false;dom.window.setInterval=(fn)=>{tick=fn;return 1;};dom.window.clearInterval=()=>{cleared=true;};const motion=new dom.window.EventTarget();motion.matches=false;dom.window.matchMedia=()=>motion;
 try{
  const root=document.querySelector('section'),items=[...root.querySelectorAll('a')],button=root.querySelector('button'),details=root.querySelector('details');const cleanup=setupRecentTicker(root);
  const active=()=>items.findIndex(x=>!x.hidden);assert.equal(button.hidden,false);tick();assert.equal(active(),1);assert.equal(root.querySelector('[data-recent-position]').textContent,'2 / 3');
  button.click();tick();assert.equal(active(),1);assert.equal(button.getAttribute('aria-pressed'),'true');button.click();
  root.dispatchEvent(new dom.window.Event('mouseenter'));tick();assert.equal(active(),1);root.dispatchEvent(new dom.window.Event('mouseleave'));
  details.open=true;tick();assert.equal(active(),1);details.open=false;
  items[1].focus();tick();assert.equal(active(),1);items[1].blur();
  motion.matches=true;motion.dispatchEvent(new dom.window.Event('change'));tick();assert.equal(active(),1);assert.equal(button.hidden,true);
  motion.matches=false;motion.dispatchEvent(new dom.window.Event('change'));tick();assert.equal(active(),2);tick();assert.equal(active(),0);
  cleanup();assert.equal(cleared,true);
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;dom.window.close();}
});
test('最近の動き：0件・1件では動きも停止ボタンも追加しない',()=>{
 for(const count of [0,1]){const dom=new JSDOM(`<section><button data-recent-pause hidden></button>${count?'<a data-recent-item>1件</a>':''}</section>`);const root=dom.window.document.querySelector('section');assert.equal(setupRecentTicker(root),undefined);assert.equal(root.querySelector('button').hidden,true);dom.window.close();}
});
