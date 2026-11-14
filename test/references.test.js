// Referências somente leitura (references.ts + leitura/busca/edição em agent.ts) e funções puras do histórico no webview.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = process.argv[2];
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-ref-'));
const proj = path.join(base, 'projeto');
const ref = path.join(base, 'outra app'); // nome com espaço, comum no Windows
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'var a = 1;\n');
fs.mkdirSync(path.join(ref, 'src', 'widgets'), { recursive: true });
fs.mkdirSync(path.join(ref, 'node_modules', 'lib'), { recursive: true });
fs.writeFileSync(path.join(ref, 'src', 'widgets', 'Grid.js'), 'function GridPadrao() {\n  return "grid";\n}\n');
fs.writeFileSync(path.join(ref, 'src', 'config.secret.json'), '{"token":"x"}');
fs.writeFileSync(path.join(ref, 'node_modules', 'lib', 'x.js'), 'GridPadrao');
fs.writeFileSync(path.join(ref, 'README.md'), '# Outra app\n');

const toUri = (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => p });
const stub = {
  FileType: { File: 1, Directory: 2 },
  Uri: { file: (p) => toUri(path.resolve(p)), joinPath: (u, ...p) => toUri(path.join(u.fsPath, ...p)) },
  RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
  Range: class {},
  WorkspaceEdit: class { createFile() {} replace() {} deleteFile() {} },
  workspace: {
    workspaceFolders: [{ uri: toUri(proj), name: 'projeto' }],
    findFiles: async () => [],
    asRelativePath: (u) => path.relative(proj, u.fsPath).split(path.sep).join('/'),
    openTextDocument: async (u) => {
      const text = fs.readFileSync(u.fsPath, 'utf8');
      return { getText: () => text, languageId: 'javascript' };
    },
    fs: {
      stat: async (u) => {
        const s = fs.statSync(u.fsPath);
        return { type: s.isDirectory() ? 2 : 1, size: s.size };
      },
      readFile: async (u) => fs.readFileSync(u.fsPath),
      readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
    },
  },
};
const orig = Module._load;
Module._load = function (r, ...a) {
  return r === 'vscode' ? stub : orig.call(this, r, ...a);
};
const refs = require(path.join(ROOT, 'out/references.js'));
const agent = require(path.join(ROOT, 'out/agent.js'));
const shown = refs.displayPath(ref);

(async () => {
  try {
    // ---- pathMentions: candidatos do mais longo ao mais curto, aspas, pontuação, código e URLs
    const m = refs.pathMentions('siga o padrão de C:\\Projetos\\outra app\\src e mantenha', 'win32');
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0][0], 'C:\\Projetos\\outra app\\src e mantenha');
    assert.ok(m[0].includes('C:\\Projetos\\outra app\\src') && m[0][m[0].length - 1] === 'C:\\Projetos\\outra');
    assert.deepStrictEqual(refs.pathMentions('use "C:\\Pasta Com Espaço\\x.js" como base', 'win32'), [['C:\\Pasta Com Espaço\\x.js']]);
    assert.deepStrictEqual(refs.pathMentions('imite `D:/apps/portal`.', 'win32'), [['D:/apps/portal']]);
    assert.deepStrictEqual(refs.pathMentions('veja C:\\app\\src.', 'win32'), [['C:\\app\\src']]);
    assert.deepStrictEqual(refs.pathMentions('na rede: \\\\servidor\\share\\app', 'win32'), [['\\\\servidor\\share\\app']]);
    assert.deepStrictEqual(refs.pathMentions('```\nC:\\dentro\\do\\codigo\n```\nsem caminho', 'win32'), [], 'bloco de código ignorado');
    assert.deepStrictEqual(refs.pathMentions('arquivo src/app.js e e/ou https://x.com/a/b', 'linux'), [], 'relativo e URL não contam');
    assert.deepStrictEqual(refs.pathMentions('padrão de /home/u/app', 'linux'), [['/home/u/app']]);
    assert.deepStrictEqual(refs.pathMentions('padrão de /home/u/app', 'win32'), [], 'no Windows só C:\\ e \\\\servidor');

    // ---- detectReferences: só caminhos existentes e fora do projeto
    const text =
      `siga o padrão de ${ref}\\src e o ${ref}\\README.md. Projeto: ${proj}\\src. ` +
      'Também C:\\nao\\existe\\x e o stack C:\\x\\y.js:10';
    let d = await refs.detectReferences(text, [], proj);
    assert.deepStrictEqual(
      d.added.map((r) => [path.relative(ref, r.path), r.isFile]),
      [['src', false], ['README.md', true]]
    );
    assert.deepStrictEqual(d.problems, ['não encontrei C:\\nao\\existe\\x (confira o caminho e se você tem acesso a ele)']);
    const existing = d.added;
    d = await refs.detectReferences(`agora veja ${ref}\\src\\widgets`, existing, proj);
    assert.deepStrictEqual(d, { added: [], problems: [] }, 'já coberto por referência existente');
    const drive = path.parse(base).root;
    d = await refs.detectReferences(`tudo em ${drive} por favor`, [], proj);
    assert.ok(d.added.length === 0 && /amplo demais/.test(d.problems[0]), d.problems.join());
    const five = Array.from({ length: 5 }, (_, i) => ({ path: path.join(base, `x${i}`), isFile: false }));
    d = await refs.detectReferences(`e ${ref}`, five, proj);
    assert.ok(d.added.length === 0 && /limite de 5/.test(d.problems[0]));

    // ---- contenção e listagem
    const roots = [{ path: ref, isFile: false }];
    assert.ok(refs.findReference(path.join(ref, 'src', 'widgets', 'Grid.js'), roots));
    assert.ok(!refs.findReference(path.join(base, 'outra app2', 'x.js'), roots), 'prefixo de nome não é a mesma pasta');
    if (process.platform === 'win32') {
      assert.ok(refs.findReference(path.join(ref.toUpperCase(), 'SRC'), roots), 'Windows ignora maiúsculas');
    }
    const walk = await refs.walkFiles(ref);
    assert.deepStrictEqual(walk, { files: ['README.md', 'src/config.secret.json', 'src/widgets/Grid.js'], truncated: false });
    assert.strictEqual((await refs.walkFiles(ref, 2)).truncated, true);

    // ---- agente: ler, listar e buscar na referência; sensível e fora das referências recusados
    const calls = agent.parseToolCalls(
      [
        `@ler: ${shown}/src/widgets/Grid.js`,
        `@ler: ${shown}/src/config.secret.json`,
        `@ler: ${refs.displayPath(base)}/fora.js`,
        '@ler: src/a.js',
        `@listar: ${shown}/src`,
        '@buscar: GridPadrao',
      ].join('\n')
    );
    const { items, summary } = await agent.fulfillReads(calls, 38000, roots);
    const byLabel = (re) => items.find((i) => re.test(i.label));
    const grid = byLabel(/Grid\.js.*referência somente leitura/);
    assert.ok(grid && grid.text.includes('function GridPadrao') && grid.language === 'js', JSON.stringify(items.map((i) => i.label)));
    assert.ok(byLabel(/^Conteúdo completo de src\/a\.js/), 'arquivo do projeto continua funcionando');
    const listing = byLabel(/^Arquivos em .*\/src \(referência somente leitura/);
    assert.ok(listing && listing.text.split('\n').includes('widgets/Grid.js'));
    const found = byLabel(/@buscar: GridPadrao — referências/);
    assert.ok(found.text.includes(`${shown}/src/widgets/Grid.js:1:`) && !found.text.includes('node_modules'), found.text);
    const failed = byLabel(/Pedidos não atendidos/).text;
    assert.ok(/config\.secret\.json: arquivo sensível/.test(failed), failed);
    assert.ok(/fora\.js: fora do projeto e das referências/.test(failed), failed);
    assert.ok(summary.includes(`${shown}/src/widgets/Grid.js`));
    const noRefs = await agent.fulfillReads(agent.parseToolCalls(`@ler: ${shown}/README.md\n@buscar: GridPadrao`), 38000, []);
    assert.ok(/fora do projeto e das referências/.test(noRefs.items.find((i) => i.label === 'Pedidos não atendidos').text), 'sem referência, sem acesso');
    assert.ok(!noRefs.items.some((i) => /referências somente leitura/.test(i.label)));

    // ---- agente: escrever fora do projeto é recusado com motivo claro
    const edit = agent.parseToolCalls(
      '```editar ' + refs.displayPath(base) + '/x.js\n<<<<<<< BUSCAR\na\n=======\nb\n>>>>>>> SUBSTITUIR\n```'
    ).edits;
    const built = await agent.buildEdits(edit);
    assert.strictEqual(built.changes, 0);
    assert.ok(/somente leitura/.test(built.problems[0].message), built.problems[0].message);

    // ---- contexto enviado ao liberar uma referência
    const folder = await agent.referenceItem({ path: ref, isFile: false }, 38000);
    assert.strictEqual(folder.item.label, `Referência somente leitura: ${shown}`);
    assert.ok(/NUNCA use blocos editar\/criar/.test(folder.item.text) && folder.item.text.includes('src/widgets/Grid.js'));
    assert.strictEqual(folder.detail, 'pasta · 3 arquivo(s)');
    const file = await agent.referenceItem({ path: path.join(ref, 'src', 'widgets', 'Grid.js'), isFile: true }, 38000);
    assert.ok(file.item.text.includes('```js\nfunction GridPadrao') && file.detail === 'arquivo', file.item.text);
    const secret = await agent.referenceItem({ path: path.join(ref, 'src', 'config.secret.json'), isFile: true }, 38000);
    assert.ok(!secret.item.text.includes('token') && /sensível/.test(secret.detail));
    assert.ok(agent.referencesReminder(roots).text.startsWith(`- ${shown} (pasta)`));

    // ---- webview: tempo relativo, destaque da busca e divisão ativas/arquivadas
    const src = fs.readFileSync(path.join(ROOT, 'media/chat.js'), 'utf8');
    const md = src.slice(src.indexOf('// ---------- Markdown'), src.indexOf('// ---------- Mensagens'));
    const pure = src.slice(src.indexOf('// ---------- Histórico (funções puras)'), src.indexOf('// ---------- Histórico (lista suspensa'));
    const h = new Function(md + pure + '\nreturn { timeAgo, highlightMatch, historyRows };')();
    const now = Date.parse('2026-10-29T12:00:00Z');
    const ago = (ms) => new Date(now - ms).toISOString();
    const MIN = 60000;
    assert.deepStrictEqual(
      [30000, 5 * MIN, 3 * 60 * MIN, 2 * 1440 * MIN, 45 * 1440 * MIN, 70 * 1440 * MIN, 400 * 1440 * MIN, 800 * 1440 * MIN].map((ms) => h.timeAgo(ago(ms), now)),
      ['agora', '5 min', '3 h', '2 d', '1 mês', '2 meses', '1 ano', '2 anos']
    );
    assert.strictEqual(h.highlightMatch('Criar <widget> Obras', 'WIDGET'), 'Criar &lt;<mark class="hist-hl">widget</mark>&gt; Obras');
    assert.strictEqual(h.highlightMatch('a & b', ''), 'a &amp; b');
    const list = [
      { id: '1', title: 'Painel de obras', archived: false },
      { id: '2', title: 'Dataset', archived: true },
      { id: '3', title: 'Obras antigas', archived: true },
    ];
    assert.deepStrictEqual(h.historyRows(list, '', false).rows.map((c) => c.id), ['1'], 'arquivadas recolhidas');
    assert.deepStrictEqual(h.historyRows(list, '', true).rows.map((c) => c.id), ['1', '2', '3']);
    const q = h.historyRows(list, 'obras', false);
    assert.ok(q.showArchived && q.rows.map((c) => c.id).join() === '1,3', 'busca mostra arquivadas que casam');

    console.log('TODOS OS TESTES PASSARAM');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
