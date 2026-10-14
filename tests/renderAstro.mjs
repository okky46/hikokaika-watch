import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler-rs';
import {transform as stripTypes} from 'esbuild';
import {experimental_AstroContainer} from 'astro/container';
const cache=new Map();
export async function renderAstro(filename,props){
 if(!cache.has(filename)){
  const file=path.resolve(filename);
  let code=(await transform(fs.readFileSync(file,'utf8'),{filename:pathToFileURL(file).href,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:s=>s})).code;
  code=code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime'));
  for(const match of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]){const spec=match[1];if(spec.startsWith('.'))code=code.replaceAll(spec,pathToFileURL(path.resolve(path.dirname(file),spec+'.ts')).href);}
  code=(await stripTypes(code,{loader:'ts',format:'esm'})).code;
  cache.set(filename,(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default);
 }
 const container=await experimental_AstroContainer.create();
 return container.renderToString(cache.get(filename),{props});
}
