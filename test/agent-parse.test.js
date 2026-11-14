const Module = require('module'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const ROOT = process.argv[2];
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? {} : orig.call(this, r, ...a); };
const { parseToolCalls, findMatch } = require(path.join(ROOT, 'out/agent.js'));

const reply = [
  'Vou ler os arquivos:',
  '@ler: assets/css/style.css',
  '`@ler: ./index.html`',
  '@listar: assets/js',
  '```js',
  '@ler: dentro-de-codigo.js',
  '```',
  '```editar assets/css/style.css',
  '<<<<<<< BUSCAR',
  ':root {',
  '  --delp-red: #CC0F10;',
  '=======',
  ':root {',
  '  --delp-red: #e11d2a;',
  '>>>>>>> SUBSTITUIR',
  '<<<<<<< BUSCAR',
  '.velho { }',
  '=======',
  '>>>>>>> SUBSTITUIR',
  '```',
  '````criar docs/novo.md',
  '# Título',
  '```js',
  'x()',
  '```',
  '````',
].join('\n');
const c = parseToolCalls(reply);
assert.deepStrictEqual(c.reads, ['assets/css/style.css', 'index.html']);
assert.deepStrictEqual(c.lists, ['assets/js']);
assert.strictEqual(c.edits.length, 2);
assert.strictEqual(c.edits[0].path, 'assets/css/style.css');
assert.deepStrictEqual(c.edits[0].blocks, [
  { search: ':root {\n  --delp-red: #CC0F10;', replace: ':root {\n  --delp-red: #e11d2a;' },
  { search: '.velho { }', replace: '' },
]);
assert.strictEqual(c.edits[1].kind, 'create');
assert.ok(c.edits[1].content.includes('```js'), 'cerca de 4 crases preserva conteúdo');

// findMatch: exato, indentação errada, CRLF
const css = ':root {\n    --delp-red: #CC0F10;\n    --done: green;\n}\n';
assert.deepStrictEqual(findMatch(css, '--done: green;'), { start: css.indexOf('--done'), end: css.indexOf('--done') + 14 });
const fz = findMatch(css, ':root {\n  --delp-red: #CC0F10;  ');
assert.strictEqual(css.slice(fz.start, fz.end), ':root {\n    --delp-red: #CC0F10;');
const crlf = css.replace(/\n/g, '\r\n');
const fc = findMatch(crlf, ':root {\n--delp-red: #CC0F10;');
assert.strictEqual(crlf.slice(fc.start, fc.end), ':root {\r\n    --delp-red: #CC0F10;');
assert.strictEqual(findMatch(css, 'nao existe'), undefined);

// renderizador do webview
const src = fs.readFileSync(path.join(ROOT, 'media/chat.js'), 'utf8');
const block = src.slice(src.indexOf('// ---------- Markdown'), src.indexOf('// ---------- Mensagens'));
const render = new Function(block + '\nreturn render;')();
const html = render(reply);
assert.ok(html.includes('📂 Lendo <code>assets/css/style.css</code>'));
assert.ok(html.includes('📁 Listando <code>assets/js</code>'));
assert.ok(html.includes('data-lang="editar assets/css/style.css"'));
assert.ok(html.includes('<span class="del">-   --delp-red: #CC0F10;</span>'));
assert.ok(html.includes('<span class="add">+   --delp-red: #e11d2a;</span>'));
assert.ok(html.includes('data-lang="criar docs/novo.md"'));
assert.ok(html.includes('<pre class="raw" hidden>'));
console.log('TODOS OS TESTES PASSARAM');
