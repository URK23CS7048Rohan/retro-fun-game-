import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, url, out, w = 1280, h = 720] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await p.goto(url);
try { await p.waitForFunction(() => window.__done === true || window.__err, null, { timeout: +(process.env.TO || 400000), polling: 1000 }); }
catch (e) { console.log('TIMEOUT'); console.log(errs.join('\n')); await b.close(); process.exit(1); }
const er = await p.evaluate(() => window.__err); if (er) console.log('ERR', er);
const data = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
(await import('fs')).writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
if (errs.length) console.log(errs.slice(0, 8).join('\n'));
await b.close();
