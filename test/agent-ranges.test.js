const Module = require('module'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const ROOT = process.argv[2];
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? {} : orig.call(this, r, ...a); };
const { parseToolCalls, parseRange, sliceForModel } = require(path.join(ROOT, 'out/agent.js'));

const c = parseToolCalls('Vou procurar:\n@buscar: function setTheme\n@buscar: `btnTheme`\n@ler: assets/js/app.js#L800-1200\n');
assert.deepStrictEqual(c.searches, ['function setTheme', 'btnTheme']);
assert.deepStrictEqual(c.reads, ['assets/js/app.js#L800-1200']);
assert.deepStrictEqual(parseRange('assets/js/app.js#L800-1200'), { rel: 'assets/js/app.js', from: 800, to: 1200 });
assert.deepStrictEqual(parseRange('a.js:10-20'), { rel: 'a.js', from: 10, to: 20 });
assert.deepStrictEqual(parseRange('a.js#L5'), { rel: 'a.js', from: 5, to: 5 });
assert.deepStrictEqual(parseRange('assets/js/app.js'), { rel: 'assets/js/app.js' });

const big = Array.from({ length: 2000 }, (_, i) => `linha ${i + 1} ` + 'x'.repeat(40)).join('\n');
const p1 = sliceForModel(big, 'app.js', 20000);
console.log(p1.label);
assert.ok(p1.text.length <= 20000 && p1.text.startsWith('linha 1 '));
assert.ok(/linhas 1–\d+ de 2000 \(parcial\)/.test(p1.label) && p1.label.includes('@ler: app.js#L'));
const next = Number(/#L(\d+)-/.exec(p1.label)[1]);
const p2 = sliceForModel(big, 'app.js', 20000, next, 2000);
assert.ok(p2.text.startsWith(`linha ${next} `), 'continua de onde parou');
const small = sliceForModel('a\nb', 'x.js', 20000);
assert.strictEqual(small.label, 'Conteúdo completo de x.js (2 linhas)');
const r = sliceForModel(big, 'app.js', 20000, 10, 12);
assert.strictEqual(r.text.split('\n').length, 3);

const src = fs.readFileSync(path.join(ROOT, 'media/chat.js'), 'utf8');
const block = src.slice(src.indexOf('// ---------- Markdown'), src.indexOf('// ---------- Mensagens'));
const render = new Function(block + '\nreturn render;')();
assert.ok(render('@buscar: function setTheme').includes('🔎 Buscando <code>function setTheme</code>'));
console.log('TODOS OS TESTES PASSARAM');
