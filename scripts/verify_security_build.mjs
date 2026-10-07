import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function verifySecurityBuild(directory='dist',env=process.env){
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 const files=walk(directory);
 const secrets=['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_DEPLOY_TOKEN','CF_ANALYTICS_API_TOKEN','EDINET_API_KEY'].map(k=>env[k]).filter(v=>v?.length>=12);
 let pages=0;
 for(const file of files.filter(f=>/\.(html|json|xml|js)$/.test(f))){
  const text=fs.readFileSync(file,'utf8');
  assert.ok(secrets.every(secret=>!text.includes(secret)),`${file}: private credential in public build`);
  for(const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)){
   try{assert.notEqual(JSON.parse(Buffer.from(match[0].split('.')[1],'base64url')).role,'service_role',`${file}: service role in public build`);}catch(error){if(error.code==='ERR_ASSERTION')throw error;}
  }
  if(!file.endsWith('.html'))continue;
  pages++;
  const policy=text.match(/<meta\s+http-equiv="content-security-policy"\s+content="([^"]*)"/i)?.[1];
  assert.ok(policy,`${file}: missing CSP`);
  const scriptPolicy=policy.split(';').find(s=>/^\s*script-src\s/.test(s));
  assert.ok(scriptPolicy&&!/unsafe-inline|unsafe-eval/.test(scriptPolicy),`${file}: weak script CSP`);
  assert.match(policy,/object-src 'none'/);
  assert.match(policy,/base-uri 'none'/);
  assert.doesNotMatch(text,/<[^>]+\son(?:submit|click|load|error)\s*=/i,`${file}: inline event handler`);
  for(const script of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   const attrs=script[1];
   if(/\bsrc=/.test(attrs)||/type="application\/json"/.test(attrs))continue;
   const hash=createHash('sha256').update(script[2]).digest('base64');
   assert.ok(scriptPolicy.includes(`'sha256-${hash}'`),`${file}: inline script without matching hash`);
  }
 }
 assert.ok(pages>0,'No HTML pages found');
 return pages;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 console.log(`公開成果物の保護確認: ${verifySecurityBuild()}ページのCSP・スクリプトハッシュ・秘密非出力を確認`);
}
