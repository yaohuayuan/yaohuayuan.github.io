import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist');
async function files(dir){const result=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())result.push(...await files(file));else result.push(file);}return result;}
const htmlFiles=(await files(root)).filter(file=>file.endsWith('.html'));let links=0;
for(const file of htmlFiles){
const html=await fs.readFile(file,'utf8');
assert.match(html,/<html[^>]+lang="zh-CN"/,file+' language');
assert.match(html,/<meta name="description" content="[^"]+"/,file+' description');
assert.match(html,/<link rel="canonical" href="https:\/\/yaohuayuan.github.io/,file+' canonical');
assert.match(html,/<meta property="og:image" content="https:\/\/yaohuayuan.github.io\/social-card.png"/,file+' social');
for(const tag of html.matchAll(/<(?:a|link|img|script)\b[^>]*?\s(?:href|src)="([^"]+)"[^>]*>/g)){
  const href=tag[1];const pageURL=new URL(path.relative(root,file).replaceAll(path.sep,'/').replace(/index\.html$/, ''),'https://local.test/');
  const resourceURL=new URL(href,pageURL);if(resourceURL.origin!=='https://local.test')continue;
  const pathname=decodeURIComponent(resourceURL.pathname);let target=path.resolve(root,'.'+pathname);
  assert.ok(target.startsWith(root+path.sep)||target===root,'Path remains in build');
  if(!path.extname(target))target=path.join(target,'index.html');
  await fs.access(target).catch(()=>{throw new Error(file+' links to missing '+href);});links++;
}
}
const sitemap=await fs.readFile(path.join(root,'sitemap-0.xml'),'utf8');assert.ok(!sitemap.includes('/search/'));assert.ok(!sitemap.includes('/404'));
assert.ok(!sitemap.includes('/labs/'));
assert.ok(!htmlFiles.some(file=>path.relative(root,file).split(path.sep).includes('labs')));
for(const file of htmlFiles)assert.doesNotMatch(await fs.readFile(file,'utf8'), /\/labs\/|\bLabs\b|实验室/, file+' removed navigation');
assert.ok(!sitemap.includes('2024-a-bench-dragon'));await fs.access(path.join(root,'pagefind/pagefind.js'));
const png=await fs.readFile(path.join(root,'social-card.png'));assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
console.log(JSON.stringify({htmlPages:htmlFiles.length,internalResourcesChecked:links,sitemap:true,draftExcluded:true,socialImage:'1200 × 630'},null,2));
