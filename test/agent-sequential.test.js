const Module = require('module'); const path = require('path'); const assert = require('assert');
const ROOT = process.argv[2];
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? {} : orig.call(this, r, ...a); };
const { applyBlocksToText, parseToolCalls } = require(path.join(ROOT, 'out/agent.js'));

const js = [
  'function renderDashboardTab(tab) {',
  "  if (tab === 'pizza') return drawPie();",
  "  if (tab === 'curva') return drawCurve();",
  '}',
  '',
  'const PANELS = { pizza: "p1", curva: "p2" };',
].join('\n');

// resposta parecida com a que deu problema: versão intermediária com </parameter>, repetição e versão final
const reply = [
  '```editar assets/js/app.js',
  '<<<<<<< BUSCAR',
  "  if (tab === 'curva') return drawCurve();",
  '}',
  '=======',
  "  if (tab === 'curva') return drawCurve();",
  "  if (tab === 'rosca') return drawDonut();",
  '}',
  '</parameter>',
  '>>>>>>> SUBSTITUIR',
  '```',
  '```editar assets/js/app.js',
  '<<<<<<< BUSCAR',
  "  if (tab === 'curva') return drawCurve();",
  '}',
  '=======',
  "  if (tab === 'curva') return drawCurve();",
  "  if (tab === 'rosca') return drawDonut();",
  '}',
  '>>>>>>> SUBSTITUIR',
  '<<<<<<< BUSCAR',
  "  if (tab === 'rosca') return drawDonut();",
  '=======',
  "  if (tab === 'rosca') return drawDonut();",
  "  if (tab === 'gauge') return drawGauge();",
  '>>>>>>> SUBSTITUIR',
  '<<<<<<< BUSCAR',
  'const PANELS = { pizza: "p1", curva: "p2" };',
  '=======',
  'const PANELS = { pizza: "p1", curva: "p2", rosca: "p3", gauge: "p4" };',
  '>>>>>>> SUBSTITUIR',
  '<<<<<<< BUSCAR',
  'linha que nao existe()',
  '=======',
  'x()',
  '>>>>>>> SUBSTITUIR',
  '```',
].join('\n');

const { edits } = parseToolCalls(reply);
assert.ok(!edits[0].blocks[0].replace.includes('</parameter>'), 'marcador vazado removido');
const r = applyBlocksToText(js, edits);
console.log(r.text);
assert.strictEqual(r.text.split("drawDonut").length - 1, 1, 'repetição não duplica');
assert.ok(r.text.includes("if (tab === 'gauge') return drawGauge();"), 'bloco sequencial vê o anterior');
assert.ok(r.text.includes('rosca: "p3", gauge: "p4"'));
assert.strictEqual(r.problems.length, 1);
assert.ok(r.problems[0].includes('linha que nao existe'));
// criar e depois editar o mesmo arquivo novo
const c = parseToolCalls('```criar novo.js\nconst a = 1;\n```\n```editar novo.js\n<<<<<<< BUSCAR\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> SUBSTITUIR\n```');
assert.strictEqual(applyBlocksToText(undefined, c.edits).text, 'const a = 2;\n');
// editar arquivo inexistente
assert.ok(applyBlocksToText(undefined, parseToolCalls('```editar x.js\n<<<<<<< BUSCAR\na\n=======\nb\n>>>>>>> SUBSTITUIR\n```').edits).problems[0].includes('não existe'));
console.log('TODOS OS TESTES PASSARAM');
