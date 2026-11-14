// Plano/checklist/resposta cortada (planner), portão de qualidade (validate) e histórico (history).
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-validate-'));
const toUri = (p) => ({ fsPath: p, path: p, toString: () => p });
const stub = {
  workspace: {
    workspaceFolders: [{ uri: toUri(dir), name: 'proj' }],
    fs: {
      stat: async (u) => fs.statSync(u.fsPath),
      readFile: async (u) => fs.readFileSync(u.fsPath),
    },
  },
  Uri: { file: (p) => toUri(p), joinPath: (u, ...p) => toUri(path.join(u.fsPath, ...p)) },
};
const orig = Module._load;
Module._load = function (r, ...a) {
  return r === 'vscode' ? stub : orig.call(this, r, ...a);
};
const planner = require(path.join(ROOT, 'out/planner.js'));
const validate = require(path.join(ROOT, 'out/validate.js'));
const history = require(path.join(ROOT, 'out/history.js'));

(async () => {
  try {
    // ---- planner
    const plan = planner.parsePlan(
      'Abordagem...\n```plano\n1. Estrutura do widget — usar @gerar widget painelObras\n2. **Dataset** — LISTAR e SALVAR\n   com filtro por periodo\n3. Revisão final\n```'
    );
    assert.strictEqual(plan.length, 3);
    assert.strictEqual(plan[0].title, 'Estrutura do widget');
    assert.ok(plan[1].title === 'Dataset' && plan[1].detail.includes('filtro por periodo'), 'continuacao de linha');
    assert.strictEqual(plan[2].status, 'pendente');
    assert.strictEqual(planner.parsePlan('sem plano'), undefined);
    assert.ok(planner.planToText(plan).startsWith('1. Estrutura do widget — usar'));

    const cl = planner.parseChecklist('feito\n```checklist\n- [x] tela de KPIs\n- [ ] exportar Excel\n- [X] filtro\n```');
    assert.deepStrictEqual(cl, { done: ['tela de KPIs', 'filtro'], pending: ['exportar Excel'] });
    assert.strictEqual(planner.parseChecklist('```checklist\n```'), undefined);

    assert.strictEqual(planner.truncatedFence('ok\n```editar a.js\n<<<<<<< BUSCAR\nx'), '```editar a.js');
    assert.strictEqual(planner.truncatedFence('```js\nx\n```\nfim'), undefined);

    // ---- validate: sintaxe e ES5
    assert.ok(validate.syntaxProblem('function a( {', 'a.js'));
    assert.strictEqual(validate.syntaxProblem('var a = 1; return a;', 'a.js'), undefined, 'return de nivel superior aceito');
    assert.deepStrictEqual(validate.es5Problems("var s = 'let x = 1 => `'; // const y\nvar ok = 1;"), [], 'sem falso positivo em string/comentario');
    assert.deepStrictEqual(validate.es5Problems('const a = () => 1;'), ['let/const', 'arrow function (=>)']);
    assert.deepStrictEqual(validate.es5Problems('var obj = { const: 1 }; obj.class = 2;'), [], 'propriedade nao e declaracao');

    // ---- validate: widget inconsistente
    const w = 'wcm/widget/painelX/src/main';
    fs.mkdirSync(path.join(dir, w, 'webapp/resources/js'), { recursive: true });
    fs.writeFileSync(path.join(dir, w, 'webapp/resources/js/Objects.js'), 'var a = 1;');
    const problems = await validate.validateFiles([
      {
        path: `${w}/resources/application.info`,
        text: 'application.code=painelX\napplication.resource.js.1=/resources/js/Objects.js\napplication.resource.js.2=/resources/js/Falta.js\napplication.resource.js.2=/resources/js/main.function.js\n',
      },
      { path: `${w}/webapp/resources/js/main.function.js`, text: 'var outroNome = SuperWidget.extend({});' },
      { path: 'datasets/dsX.js', text: 'function createDataset(){ let x = 1; return x; }' },
      { path: 'docs/nota.md', text: '# nada' },
    ]);
    const msgs = problems.map((p) => `${p.path}: ${p.message}`).join('\n');
    assert.ok(/chave repetida application\.resource\.js\.2/.test(msgs), msgs);
    assert.ok(/recurso declarado e inexistente: \/resources\/js\/Falta\.js/.test(msgs), msgs);
    assert.ok(/SuperWidget "outroNome" diferente/.test(msgs), msgs);
    assert.ok(/datasets\/dsX\.js: usa let\/const/.test(msgs), msgs);
    assert.ok(problems.every((p) => p.kind === 'validation'));
    assert.strictEqual(problems.filter((p) => p.message.includes('Objects.js')).length, 0, 'recurso existente no disco nao acusa');

    // ---- validate: design (widgets)
    const dp = validate.designProblems;
    const css = `${w}/webapp/resources/css/x.css`;
    assert.deepStrictEqual(dp(css, '.x { --x-red: #CC0F10; color: #fff; background: #EAE5DF; border-color: #ffffff80; }\n#abc .x { color: var(--x-red); }'), [], 'paleta, forma curta, alfa e #id de seletor passam');
    assert.ok(dp(css, '.x { color: #333333; background: #f5f5f5 }').length === 2, 'duas cores fora da paleta');
    assert.deepStrictEqual(dp(css, '/* #123456 */ .x{}'), [], 'comentario nao conta');
    assert.deepStrictEqual(dp('outra/pasta/x.css', '.x{color:#333}'), [], 'fora de widget nao cobra');
    assert.deepStrictEqual(dp(`${w}/webapp/resources/js/lib/a.min.js`, "new Chart(c); alert('x'); var c='#123456';"), [], 'lib ignorada');
    const js = `${w}/webapp/resources/js/integreA.js`;
    assert.ok(dp(js, "var g = new Chart(el, {});").some((m) => m.includes('new Chart')));
    assert.deepStrictEqual(dp(`${w}/webapp/resources/js/chartHelper.js`, "var g = new global.Chart(el, {});"), [], 'chartHelper pode');
    assert.ok(dp(js, "if (!confirm('Excluir?')) { return; }").some((m) => m.includes('alert/confirm')));
    assert.deepStrictEqual(dp(js, "C.Confirmacao.abrir({}); modal.confirm(); var s = 'alert(1)';"), [], 'metodo e string nao contam');
    assert.ok(dp(js, "var cor = '#9C27B0';").some((m) => m.includes('#9C27B0')));
    assert.ok(dp(`${w}/resources/view.ftl`, '<div style="color:red">x</div>').some((m) => m.includes('inline')));
    // so cobra o que a entrega introduziu
    fs.mkdirSync(path.join(dir, w, 'webapp/resources/css'), { recursive: true });
    fs.writeFileSync(path.join(dir, css), '.x { color: #333333; }');
    const dprob = await validate.validateFiles([{ path: css, text: '.x { color: #333333; background: #FAFAFA; }' }]);
    const dmsgs = dprob.map((p) => p.message);
    assert.ok(dmsgs.some((m) => m.includes('#FAFAFA')) && !dmsgs.some((m) => m.includes('#333333')), dmsgs.join('\n'));

    // ---- history
    const store = new Map();
    const memento = { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => store.set(k, v) };
    const h = new history.ConversationStore(memento);
    await h.save({ id: 'a', title: 't1', created: '2026-10-01T10:00:00Z', updated: '2026-10-01T10:00:00Z', turns: [{ role: 'user', text: 'oi' }] });
    await h.save({ id: 'b', title: 't2', created: '2026-10-01T11:00:00Z', updated: '2026-10-01T11:00:00Z', turns: [{ role: 'user', text: 'x'.repeat(30000) }] });
    assert.deepStrictEqual(h.list().map((c) => c.id), ['b', 'a'], 'mais recente primeiro');
    assert.ok(h.get('b').turns[0].text.length < 21000, 'texto truncado no historico');
    await h.save({ id: 'a', title: 't1', created: '2026-10-01T10:00:00Z', updated: '2026-10-01T12:00:00Z', turns: [] });
    assert.strictEqual(h.list().length, 2, 'atualiza sem duplicar');
    await h.rename('a', 'novo nome');
    await h.setArchived(['a', 'b'], true);
    assert.deepStrictEqual(h.list().map((c) => [c.id, c.title, c.archived]), [['a', 'novo nome', true], ['b', 't2', true]]);
    assert.strictEqual(h.get('a').updated, '2026-10-01T12:00:00Z', 'renomear/arquivar não reordena');
    await h.setArchived(['b'], false);
    assert.strictEqual(h.get('b').archived, false);
    await h.delete('a');
    assert.strictEqual(h.list().length, 1);
    assert.ok(history.transcript([{ role: 'user', text: 'pergunta' }, { role: 'note', text: 'n' }, { role: 'assistant', text: 'resp' }]).includes('Usuário: pergunta\n\nAssistente: resp'));
    assert.strictEqual(history.conversationTitle('  crie   um widget  '), 'crie um widget');

    console.log('TODOS OS TESTES PASSARAM');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
