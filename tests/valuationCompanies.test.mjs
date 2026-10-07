import {test} from 'node:test';
import assert from 'node:assert/strict';
import {valuationCompanies} from '../src/lib/valuationCompanies.ts';
test('公開財務だけの銘柄にもページを生成し、既存銘柄の案件・記事用IDは保持する',()=>{
 const company={id:'real-company',securityCode:'0001',nameJa:'追跡会社',market:'東証',industry:'サービス業',cases:[{id:'existing-case'}],lastUpdatedAt:null};
 const financials=[{code:'0001',name:'財務の会社名',industry:'サービス業',checkedOn:'2026-10-07'},{code:'0002',name:'公開TOB会社',industry:'機械',checkedOn:'2026-10-07'}];
 const before=structuredClone([company,financials]),pages=valuationCompanies([company],financials);
 assert.equal(pages.length,2);assert.equal(pages[0],company);assert.equal(pages[1].securityCode,'0002');assert.deepEqual(pages[1].cases,[]);assert.deepEqual([company,financials],before);
});
