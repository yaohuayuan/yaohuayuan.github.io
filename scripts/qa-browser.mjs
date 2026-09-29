// Optional QA: provide Playwright via PLAYWRIGHT_MODULE or install it locally without saving.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.QA_OUTPUT||'./.qa/series');await fs.mkdir(out,{recursive:true});
const origin=process.env.QA_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={pages:[],interactions:[],errors,screenshots:out};
try{
await page.goto(origin,{waitUntil:'networkidle'});
await page.screenshot({path:out+'/home-desktop.png',fullPage:true});
await page.locator('#theme-toggle').click();await page.screenshot({path:out+'/home-dark.png',fullPage:true});
await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');report.interactions.push('Theme persists across reload');
await page.setViewportSize({width:390,height:844});await page.locator('#theme-toggle').click();await page.screenshot({path:out+'/home-mobile.png',fullPage:true});
const routes=['/','/articles/','/knowledge/','/projects/','/projects/dbms-c/','/projects/ai-native-dbms/','/projects/aster/','/series/math-modeling/','/series/dbms-c-from-zero/','/series/leetcode-daily/','/articles/engineering/dbms-c-series/02-file-and-page/','/about/','/articles/math-test/','/articles/test-article/','/knowledge/dbms/buffer-pool/','/search/','/archive/','/categories/','/tags/','/series/','/404.html'];
for(const width of [360,768,1440]){
await page.setViewportSize({width,height:900});
for(const route of routes){
await page.goto(origin+route,{waitUntil:'networkidle'});
const data=await page.evaluate(()=>({title:document.title,description:document.querySelector('meta[name="description"]')?.content,canonical:document.querySelector('link[rel="canonical"]')?.href,h1:document.querySelectorAll('h1').length,overflow:document.documentElement.scrollWidth>innerWidth+1,brokenImages:[...document.images].filter(i=>i.getAttribute('src')&&!i.complete||i.getAttribute('src')&&i.naturalWidth===0).map(i=>i.src),schema:!!JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)}));
assert.ok(data.title&&data.description&&data.canonical&&data.schema,route+' SEO');assert.equal(data.h1,1,route+' h1');assert.equal(data.overflow,false,route+' overflow at '+width);assert.deepEqual(data.brokenImages,[],route+' broken images');report.pages.push({route,width,passed:true});
}}
await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/series/');
assert.equal(await page.locator('.series-card').count(),8);
await page.screenshot({path:out+'/series-desktop.png',fullPage:true});
await page.locator('#theme-toggle').click();await page.screenshot({path:out+'/series-dark.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/series-mobile.png',fullPage:true});
await page.goto(origin+'/series/dbms-c-from-zero/');assert.equal(await page.locator('.article-list__item').count(),14);
await page.screenshot({path:out+'/series-detail-mobile.png',fullPage:true});
await page.locator('.article-list__item').nth(2).locator('a').click();
assert.ok(page.url().endsWith('/02-file-and-page/'));
await page.locator('.series-directory summary').click();assert.equal(await page.locator('.series-directory a[aria-current="page"]').count(),1);
await page.locator('a[rel="next"]').click();assert.ok(page.url().endsWith('/03-buffer-pool/'));
await page.locator('a[rel="prev"]').click();assert.ok(page.url().endsWith('/02-file-and-page/'));
report.interactions.push('Series cards, ordered directory, current article, previous and next');
await page.goto(origin+'/articles/test-article/');
await page.locator('.copy-code').first().click();await page.waitForFunction(()=>document.querySelector('.copy-code')?.textContent==='已复制');assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Astro Markdown/);
await page.locator('.image-expand').first().click();assert.equal(await page.locator('.image-dialog').evaluate(e=>e.open),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.image-dialog').evaluate(e=>e.open),false);report.interactions.push('Code clipboard and image dialog with Escape');
await page.goto(origin+'/articles/math-test/');await page.screenshot({path:out+'/article-dark.png',fullPage:true});await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(600);assert.ok(await page.locator('.reading-progress').evaluate(e=>e.value)>90);assert.ok(await page.locator('mjx-container').count()>0);report.interactions.push('MathJax formulas and reading progress');
await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/article-mobile-dark.png',fullPage:true});
await page.goto(origin+'/search/',{waitUntil:'networkidle'});await page.getByRole('searchbox').fill('Markdown');await page.locator('pagefind-results a').first().waitFor();report.interactions.push('Pagefind search returns results');await page.screenshot({path:out+'/search-dark.png',fullPage:true});
assert.deepEqual(errors,[]);await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.pages.length,interactions:report.interactions,errors,screenshots:out},null,2));
}finally{await fs.writeFile(out+'/browser-report.json',JSON.stringify(report,null,2));await browser.close();}
