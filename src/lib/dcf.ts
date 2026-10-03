export type DcfInput = {
  fcff: number[];
  wacc: number;
  terminal: {method:'growth'; growth:number; normalizedFcff:number} | {method:'multiple'; multiple:number; ebitda:number};
  equityBridge: number;
  shares: number;
};
export type DcfResult = {presentForecast:number; presentTerminal:number; enterpriseValue:number; equityValue:number; price:number; terminalShare:number|null};

// Money inputs are million yen; WACC and growth inputs are percentage points.
// Five full years from the valuation date, each discounted at year end.
export function dcf(input:DcfInput):DcfResult|null {
  if(input.fcff.length!==5||!input.fcff.every(Number.isFinite)||!Number.isFinite(input.wacc)||input.wacc<=0||input.wacc>100||!Number.isFinite(input.equityBridge)||!Number.isSafeInteger(input.shares)||input.shares<=0) return null;
  const rate=input.wacc/100;
  let terminal:number;
  if(input.terminal.method==='growth'){
    const {growth,normalizedFcff}=input.terminal;
    if(!Number.isFinite(growth)||growth<=-100||growth>=input.wacc||!Number.isFinite(normalizedFcff)||normalizedFcff<=0)return null;
    terminal=normalizedFcff*(1+growth/100)/(rate-growth/100);
  } else {
    const {multiple,ebitda}=input.terminal;
    if(!Number.isFinite(multiple)||multiple<=0||!Number.isFinite(ebitda)||ebitda<=0)return null;
    terminal=multiple*ebitda;
  }
  const presentForecast=input.fcff.reduce((n,value,i)=>n+value/(1+rate)**(i+1),0);
  const presentTerminal=terminal/(1+rate)**5;
  const enterpriseValue=presentForecast+presentTerminal;
  const equityValue=enterpriseValue+input.equityBridge;
  const price=equityValue*1_000_000/input.shares;
  if(![presentForecast,presentTerminal,enterpriseValue,equityValue,price].every(Number.isFinite)||equityValue<=0)return null;
  const terminalShare=enterpriseValue>0?presentTerminal/enterpriseValue*100:null;
  return {presentForecast,presentTerminal,enterpriseValue,equityValue,price,terminalShare:terminalShare!==null&&Number.isFinite(terminalShare)?terminalShare:null};
}

export function dcfSensitivity(input:DcfInput){
  const offsets=[-0.5,0,0.5];
  const waccs=offsets.map(n=>input.wacc+n);
  const centers=input.terminal.method==='growth'?input.terminal.growth:input.terminal.multiple;
  const terminals=offsets.map(n=>centers+n);
  return {waccs,terminals,rows:waccs.map(wacc=>terminals.map(value=>dcf({...input,wacc,terminal:input.terminal.method==='growth'?{...input.terminal,growth:value}:{...input.terminal,multiple:value}})?.price??null))};
}
