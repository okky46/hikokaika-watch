/** UI amounts are millions of yen; shares are millions of shares. Their ratio is yen/share. */
export function premiumPrice(base:number,premium:number):number|null {
  if(!Number.isFinite(base)||base<=0||!Number.isFinite(premium)||premium<=-100)return null;
  const n=base*(1+premium/100);return Number.isFinite(n)&&n>0?n:null;
}
export function evPrice(ebitda:number,multiple:number,debt:number,cash:number,adjustment:number,shares:number):number|null {
  if(![ebitda,multiple,debt,cash,adjustment,shares].every(Number.isFinite)||ebitda<=0||multiple<=0||debt<0||cash<0||shares<=0)return null;
  const n=(ebitda*multiple-debt+cash-adjustment)/shares;
  return Number.isFinite(n)&&n>0?n:null;
}
export function navPrice(equity:number,adjustment:number,shares:number):number|null {
  if(![equity,adjustment,shares].every(Number.isFinite)||shares<=0)return null;
  const n=(equity+adjustment)/shares;return Number.isFinite(n)&&n>0?n:null;
}
