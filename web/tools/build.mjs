// Bundles the game and assembles web/dist (also used as the Android assets).
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, minify: !process.argv.includes('--dev'), sourcemap: process.argv.includes('--dev') ? 'inline' : false,
  format: 'iife', target: ['chrome90'], outfile: path.join(dist, 'game.js'), logLevel: 'warning' });
const copy = (src, dst) => fs.cpSync(src, dst, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'public'))) copy(path.join(root, 'public', f), path.join(dist, f));
const fsrc = path.join(root, 'node_modules/@fontsource/saira-semi-condensed/files');
for (const w of [300, 500, 700]) copy(path.join(fsrc, `saira-semi-condensed-latin-${w}-normal.woff2`), path.join(dist, 'fonts', `saira-${w}.woff2`));
console.log('built', dist);
