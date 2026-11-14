const Module = require('module'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const ROOT = process.argv[2];
let clipboard = ''; const opened = []; let focusListener;
class EventEmitter { constructor(){this.l=[]; this.event=(f)=>{this.l.push(f); return {dispose(){}}};} fire(v){this.l.forEach(f=>f(v));} dispose(){} }
const stub = {
  EventEmitter,
  Uri: { parse: (u) => ({ toString: () => u }) },
  env: { clipboard: { writeText: async (t) => { clipboard = t; }, readText: async () => clipboard }, openExternal: async (u) => { opened.push(u.toString()); return true; } },
  window: { onDidChangeWindowState: (f) => { focusListener = f; return { dispose() { focusListener = undefined; } }; }, showInformationMessage: () => {}, setStatusBarMessage: () => {} },
  workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? stub : orig.call(this, r, ...a); };

const { CopilotWebProvider, normalizeReply } = require(path.join(ROOT, 'out/providers/copilotWebProvider.js'));
const { locateSnippet } = require(path.join(ROOT, 'out/apply.js'));
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  const token = { onCancellationRequested: () => ({ dispose() {} }) };
  const p = new CopilotWebProvider();
  const shown = [];
  const pr = p.send({ prompt: 'Refatore', context: [{ label: 'a.ts', text: 'let x = 1', language: 'typescript' }], expectsCode: true }, (t) => shown.push(t), token);
  await tick();
  assert.ok(clipboard.includes('Refatore') && clipboard.includes('let x = 1'), 'pedido copiado');
  assert.deepStrictEqual(opened, ['https://m365.cloud.microsoft/chat']);
  assert.ok(shown[0].includes('Ctrl+V'));
  // voltar o foco sem copiar a resposta: continua esperando
  focusListener({ focused: true }); await tick();
  assert.ok(p.isWaiting, 'ainda esperando');
  // usuário copia só o bloco de código (sem cercas) e volta
  clipboard = 'const x = 1;';
  focusListener({ focused: true });
  const reply = await pr;
  assert.strictEqual(reply, '```typescript\nconst x = 1;\n```', 'embrulha código sem cercas');
  assert.ok(!p.isWaiting);
  // segunda mensagem não abre outra aba
  const pr2 = p.send({ prompt: 'Explique', context: [] }, () => {}, token); await tick();
  assert.strictEqual(opened.length, 1);
  clipboard = 'Resposta **markdown**'; await p.pasteFromClipboard();
  assert.strictEqual(await pr2, 'Resposta **markdown**', 'explicação fica como markdown');
  assert.strictEqual(normalizeReply('texto\n```js\nx\n```', 'js'), 'texto\n```js\nx\n```');

  // ---- localizar trecho ----
  const doc = fs.readFileSync(path.join(ROOT, 'sandbox/exemplo.ts'), 'utf8');
  const lines = doc.split(/\r?\n/);
  const show = (r) => lines.slice(r.startLine, r.endLine + 1).join('\n');
  // 1) assinatura idêntica
  let r = locateSnippet(doc, 'export function totalPedido(pedido: Pedido) {\n  return 0;\n}');
  console.log('1)\n' + show(r)); assert.ok(lines[r.startLine].includes('totalPedido') && lines[r.endLine].trim() === '}');
  assert.ok(!show(r).includes('filtrarPorCliente'));
  // 2) assinatura alterada (tipo de retorno) -> acha pelo nome
  r = locateSnippet(doc, 'export function totalPedido(pedido: Pedido): number {\n  return 0;\n}');
  assert.ok(lines[r.startLine].includes('totalPedido'), 'por nome');
  // 3) com JSDoc na frente -> âncora na declaração
  r = locateSnippet(doc, '/**\n * Filtra pedidos.\n */\nexport function filtrarPorCliente(pedidos: Pedido[], cliente: string): Pedido[] {\n  return pedidos.filter((p) => p.cliente === cliente);\n}');
  console.log('3)\n' + show(r)); assert.ok(lines[r.startLine].includes('filtrarPorCliente') && lines[r.endLine].trim() === '}');
  // 4) python
  const py = 'import os\n\ndef soma(a, b):\n    x = a + b\n    return x\n\ndef outra():\n    pass\n';
  r = locateSnippet(py, 'def soma(a: int, b: int) -> int:\n    return a + b');
  assert.deepStrictEqual(r, { startLine: 2, endLine: 4 }, 'python por indentação');
  // 5) sem correspondência
  assert.strictEqual(locateSnippet(doc, 'function naoExiste() {}'), undefined);
  console.log('\nTODOS OS TESTES PASSARAM');
})().catch((e) => { console.error(e); process.exit(1); });
