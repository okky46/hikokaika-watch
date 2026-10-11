/** Rotate only when the reader is not interacting with the recent-movements section. */
export function setupRecentTicker(root:HTMLElement) {
 const items=[...root.querySelectorAll<HTMLElement>('[data-recent-item]')];
 const button=root.querySelector<HTMLButtonElement>('[data-recent-pause]');
 if(items.length<2||!button)return;
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const details=root.querySelector('details');
 const position=root.querySelector<HTMLElement>('[data-recent-position]');
 let index=0,paused=false,hovered=false;
 const updateButton=()=>{const action=paused?'自動切り替えを再開':'自動切り替えを一時停止';button.hidden=motion.matches;button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',action);button.title=action;};
 updateButton();motion.addEventListener('change',updateButton);
 button.addEventListener('click',()=>{paused=!paused;updateButton();});
 root.addEventListener('mouseenter',()=>{hovered=true;});root.addEventListener('mouseleave',()=>{hovered=false;});
 const timer=window.setInterval(()=>{
  if(paused||hovered||motion.matches||document.hidden||details?.open||root.contains(document.activeElement))return;
  items[index].hidden=true;items[index].classList.remove('recent-ticker__item--enter');
  index=(index+1)%items.length;items[index].hidden=false;items[index].classList.add('recent-ticker__item--enter');
  if(position)position.textContent=`${index+1} / ${items.length}`;
 },6000);
 return ()=>{window.clearInterval(timer);motion.removeEventListener('change',updateButton);};
}
