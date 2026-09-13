import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
for (const k of ['HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy']) delete process.env[k];
const B='http://127.0.0.1:8787';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport:{width:1280,height:900} });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(B+'/portfolio', {waitUntil:'networkidle'}); await page.waitForTimeout(1100);

console.log('status empty at rest:', JSON.stringify(await page.textContent('#page-status')));
await page.click('[data-filter-status]');
await page.waitForTimeout(600);
console.log('after toggle  →', JSON.stringify(await page.textContent('#page-status')), '| rows', await page.$$eval('#document-list li', n=>n.length));
await page.selectOption('select[data-filter="phase"]', 'plan');
await page.waitForTimeout(600);
console.log('plus stage    →', JSON.stringify(await page.textContent('#page-status')), '| rows', await page.$$eval('#document-list li', n=>n.length));
await page.click('[data-filter-clear]');
await page.waitForTimeout(600);
console.log('after clear   →', JSON.stringify(await page.textContent('#page-status')), '| rows', await page.$$eval('#document-list li', n=>n.length));
await page.fill('#doc-search', 'recording');
await page.waitForTimeout(700);
console.log('search        →', JSON.stringify(await page.textContent('#page-status')));

// The strip scrolls on a phone rather than wrapping.
const m = await browser.newPage({ viewport:{width:390,height:800} });
await m.goto(B+'/portfolio', {waitUntil:'networkidle'}); await m.waitForTimeout(1100);
console.log('filter strip scrollable:', await m.$eval('#filter-bar', e => e.scrollWidth > e.clientWidth));
console.log('page overflow:', await m.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth));
await browser.close();
