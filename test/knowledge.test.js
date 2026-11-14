const Module = require('module'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const ROOT = process.argv[2]; const WS = process.argv[3];
let folderPath = '';
function walk(dir, out) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.git') continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
const uri = (p) => ({ fsPath: p, toString: () => p });
const stub = {
  Uri: { joinPath: (u, ...parts) => uri(path.join(u.fsPath, ...parts)) },
  RelativePattern: class { constructor(base, pat) { this.base = base; this.pat = pat; } },
  workspace: {
    get workspaceFolders() { return [{ uri: uri(folderPath), name: path.basename(folderPath) }]; },
    getConfiguration: () => ({ get: (k, d) => d }),
    fs: { readFile: async (u) => fs.readFileSync(u.fsPath) },
    findFiles: async (rp) => {
      const files = walk(folderPath, []).map((f) => path.relative(folderPath, f).split(path.sep).join('/'));
      const re = /(^|\/)application\.info$|\.ftl$|(^|\/)forms\/.*\.html$|(^|\/)events\/[^/]+\.js$|(^|\/)datasets\/[^/]+\.js$|(^|\/)workflow\/scripts\/[^/]+\.js$|(^|\/)wcm\//;
      return files.filter((f) => re.test(f)).slice(0, 1);
    },
  },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? stub : orig.call(this, r, ...a); };
const k = require(path.join(ROOT, 'out/knowledge.js'));
const ext = uri(ROOT);
(async () => {
  folderPath = path.join(WS, 'fluig-proj');
  let r = await k.knowledgeContext(ext, { freshConversation: true, guideAlreadySent: false });
  console.log('fluig-proj (nova conversa):', r.items.map((i) => `${i.label.slice(0, 50)}… (${i.text.length})`));
  assert.ok(r.items[0].label.startsWith('Guia de arquitetura Fluig') && r.sentGuide);
  assert.ok(r.items.some((i) => i.label.includes('CLAUDE.md')), 'CLAUDE.md do projeto incluido');
  r = await k.knowledgeContext(ext, { freshConversation: false, guideAlreadySent: true });
  assert.strictEqual(r.items.length, 1);
  assert.ok(r.items[0].label.startsWith('Lembrete') && !r.sentGuide, 'guia ja enviado: so lembrete');

  k.resetKnowledgeCache();
  folderPath = path.join(WS, 'plain-proj');
  r = await k.knowledgeContext(ext, { freshConversation: true, guideAlreadySent: false });
  assert.ok(!r.items.some((i) => i.label.startsWith('Guia')), 'nao-Fluig sem guia');
  r = await k.knowledgeContext(ext, { freshConversation: false, guideAlreadySent: false, forceFluig: true });
  assert.ok(r.items[0].label.startsWith('Guia') && r.sentGuide, 'atalho/mensagem Fluig forca o guia fora de projeto Fluig');

  assert.ok(k.FLUIG_HINT.test('crie um widget para o PMO'));
  assert.ok(k.FLUIG_HINT.test('ajuste o formulário de compras'));
  assert.ok(!k.FLUIG_HINT.test('o que este projeto faz?'));
  assert.ok(!k.FLUIG_HINT.test('zooming in'), 'limite de palavra');

  // Guia de design: completo uma vez, depois lembrete
  r = await k.knowledgeContext(ext, { freshConversation: false, guideAlreadySent: true, forceDesign: true });
  assert.ok(r.items.some((i) => i.label.startsWith('Guia de design DELP')) && r.sentDesign, 'guia de design enviado');
  assert.ok(r.items.find((i) => i.label.startsWith('Guia de design')).text.includes('Subsea #2362D3'));
  r = await k.knowledgeContext(ext, { freshConversation: false, guideAlreadySent: true, forceDesign: true, designAlreadySent: true });
  assert.ok(r.items.some((i) => i.label.startsWith('Lembrete do guia de design')) && !r.sentDesign, 'depois so o lembrete');
  r = await k.knowledgeContext(ext, { freshConversation: false, guideAlreadySent: true });
  assert.ok(!r.items.some((i) => /design/.test(i.label)), 'sem assunto visual, sem guia de design');
  assert.ok(k.DESIGN_HINT.test('o gráfico ficou feio'));
  assert.ok(k.DESIGN_HINT.test('monte um dashboard de KPIs'));
  assert.ok(!k.DESIGN_HINT.test('corrija o erro no dataset'));
  console.log('TODOS OS TESTES PASSARAM');
})().catch((e) => { console.error(e); process.exit(1); });
