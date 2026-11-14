// Ponta a ponta do gerador: gera widget + dataset + formulário numa pasta temporária a partir de
// templates/, confere nomes/placeholders/ES5 e roda o build-widget.js gerado (deve produzir o .war).
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = process.argv[2];

// Dublê mínimo do módulo vscode apoiado no sistema de arquivos real.
const toUri = (p) => ({ fsPath: p, path: p, toString: () => p });
let wsRoot = '';
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const stub = {
  FileType: { File: 1, Directory: 2 },
  Uri: { joinPath: (u, ...parts) => toUri(path.join(u.fsPath, ...parts)) },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  workspace: {
    get workspaceFolders() { return wsRoot ? [{ uri: toUri(wsRoot), name: 'ws' }] : undefined; },
    getConfiguration: () => ({ get: (k, d) => d }),
    findFiles: async (rp) => {
      const base = rp.base.uri ? rp.base.uri.fsPath : rp.base.fsPath;
      const re = rp.pattern === '**/application.info' ? /(^|\/)application\.info$/ : /(^|\/)datasets\/.*\.js$/;
      return walk(base).filter((f) => re.test(path.relative(base, f).split(path.sep).join('/'))).map(toUri);
    },
    fs: {
      readDirectory: async (u) =>
        fs.readdirSync(u.fsPath, { withFileTypes: true }).map((e) => [e.name, e.isDirectory() ? 2 : 1]),
      readFile: async (u) => fs.readFileSync(u.fsPath),
      writeFile: async (u, data) => fs.writeFileSync(u.fsPath, data),
      createDirectory: async (u) => fs.mkdirSync(u.fsPath, { recursive: true }),
      stat: async (u) => fs.statSync(u.fsPath),
    },
  },
};
const orig = Module._load;
Module._load = function (r, ...a) {
  return r === 'vscode' ? stub : orig.call(this, r, ...a);
};
const sc = require(path.join(ROOT, 'out/scaffold.js'));
const validate = require(path.join(ROOT, 'out/validate.js'));

(async () => {
  // Derivação de nomes
  assert.strictEqual(sc.titleFromCode('painelDeObras'), 'Painel De Obras');
  assert.strictEqual(sc.namespaceFromCode('portalTestes'), 'testes');
  assert.strictEqual(sc.camelFromTitle('Solicitação de Viagem'), 'solicitacaoViagem');
  assert.strictEqual(sc.asciiTitle('Gestão Operacional'), 'Gestao Operacional');
  assert.strictEqual(sc.fillPlaceholders('{{A}}-{{B}}-{{X}}', { A: '1', B: '2' }), '1-2-{{X}}');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-scaffold-'));
  try {
    const ext = toUri(ROOT);
    const target = toUri(dir);
    const vars = {
      CODE: 'painelObras', NS: 'obras', TITULO: 'Painel de Obras', TITULO_ASCII: 'Painel de Obras',
      DESCRICAO: 'Painel de Obras DELP - teste', DESCRICAO_ASCII: 'teste', DATA: '01/10/2026',
      DATASET: 'dsPainelObras', TABELA: 'Z_DELP_PAINEL_OBRAS',
      DS_JNDI: '/jdbc/FluigDS', BASE: 'FLUIG', DEV_CODE: 'DELP0216', DEV_NAME: 'dev.teste',
    };
    const w = await sc.scaffold(ext, 'widget', target, vars);
    const d = await sc.scaffold(ext, 'dataset', target, vars);
    const f = await sc.scaffold(ext, 'form', target, {
      FORM_FOLDER: '000000 - Solicitacao de Viagem', FORM: 'solicitacaoViagem', PX: 'sv', PX_UPPER: 'SV',
      TITULO: 'Solicitação de Viagem', DATA: '01/10/2026',
    });

    const base = 'wcm/widget/painelObras/src/main';
    for (const rel of [
      'build-widget.js',
      `${base}/resources/application.info`,
      `${base}/resources/view.ftl`,
      `${base}/resources/edit.ftl`,
      `${base}/resources/painelObras_pt_BR.properties`,
      `${base}/webapp/WEB-INF/jboss-web.xml`,
      `${base}/webapp/resources/css/obras.css`,
      `${base}/webapp/resources/js/Objects.js`,
      `${base}/webapp/resources/js/dsPainelObras.js`,
      `${base}/webapp/resources/js/main.function.js`,
      `${base}/webapp/resources/js/chartHelper.js`,
      `${base}/webapp/resources/js/lib/chart.umd.min.js`,
      'datasets/dsPainelObras.js',
      'sql/01_CREATE_Z_DELP_PAINEL_OBRAS.sql',
      'forms/000000 - Solicitacao de Viagem/solicitacaoViagem.html',
      'forms/000000 - Solicitacao de Viagem/sv.app.js',
      'forms/000000 - Solicitacao de Viagem/events/displayFields.js',
    ]) {
      assert.ok(fs.existsSync(path.join(dir, rel)), `gerado: ${rel}`);
    }

    // Nenhum placeholder restante e ES5 nos JS
    const all = [...w.created, ...d.created, ...f.created];
    for (const rel of all) {
      const text = fs.readFileSync(path.join(dir, rel), 'utf8');
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(text), `placeholder restante em ${rel}`);
      if (rel.endsWith('.js') && !rel.endsWith('build-widget.js') && !rel.endsWith('.min.js')) {
        assert.ok(!/(^|[^\w.])(let|const)\s|=>|`/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `ES5 em ${rel}`);
        const chk = spawnSync(process.execPath, ['--check', path.join(dir, rel)], { encoding: 'utf8' });
        assert.strictEqual(chk.status, 0, `sintaxe ${rel}: ${chk.stderr}`);
      }
    }
    // Graficos: Chart.js real (nao o placeholder de poucos bytes) e modelo limpo no portao de design
    assert.ok(fs.statSync(path.join(dir, base, 'webapp/resources/js/lib/chart.umd.min.js')).size > 100000, 'Chart.js real no modelo');
    for (const rel of w.created) {
      const probs = validate.designProblems(rel, fs.readFileSync(path.join(dir, rel), 'utf8'));
      assert.deepStrictEqual(probs, [], `design do modelo em ${rel}`);
    }
    const helper = fs.readFileSync(path.join(dir, base, 'webapp/resources/js/chartHelper.js'), 'utf8');
    // Logica de cor e formatacao do helper (sem DOM)
    const win = { obras: { util: { formatarNumero: (n, d) => Number(n).toFixed(d || 0).replace('.', ',') } } };
    require('vm').runInNewContext(helper, { window: win, jQuery: function () {} });
    const G = win.obras.grafico;
    assert.deepStrictEqual([...G.ORDEM], ['#2362D3', '#FF6B05', '#213D75', '#0B861D'], 'ordem validada Subsea, Industria, Mooring, Servicos');
    assert.strictEqual(G.corDaSerie('Mooring', 0), '#213D75', 'cor segue a unidade');
    assert.strictEqual(G.corDaSerie('Serviços', 0), '#0B861D');
    assert.strictEqual(G.corDaSerie('Receita', 1), '#FF6B05');
    assert.strictEqual(G.corDaSerie('Quinta', 4), '#B0B0B0', '5a serie em cinza');
    assert.strictEqual(G.formatar(2500000, 'compacto'), '2,5 mi');
    assert.strictEqual(G.formatar(12.5, 'percentual'), '12,5%');
    assert.strictEqual(G.formatar(null), '-');
    assert.strictEqual(G.disponivel(), false, 'sem Chart.js carregado');
    assert.ok(/obras\.grafico/.test(helper) && !/new Chart\(/.test(fs.readFileSync(path.join(dir, base, 'webapp/resources/js/integreInicio.js'), 'utf8')));
    const view = fs.readFileSync(path.join(dir, base, 'resources/view.ftl'), 'utf8');
    assert.ok(view.includes('data-obras-container="inicio-grafico"'), 'card do grafico no view.ftl');
    assert.ok(view.includes("painelObras_${instanceId!'0'}"), 'instanceId literal no view.ftl');
    assert.ok(view.includes('data-params="painelObras.instance()"'));
    const main = fs.readFileSync(path.join(dir, base, 'webapp/resources/js/main.function.js'), 'utf8');
    assert.ok(/var painelObras = SuperWidget\.extend/.test(main), 'SuperWidget com o nome do code');

    // Gerar de novo nao sobrescreve nada
    const again = await sc.scaffold(ext, 'dataset', target, vars);
    assert.strictEqual(again.created.length, 0);
    assert.strictEqual(again.skipped.length, d.created.length);

    // Build do WAR com o build-widget.js gerado
    const build = spawnSync(process.execPath, ['build-widget.js'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(build.status, 0, `build falhou:\n${build.stdout}\n${build.stderr}`);
    assert.ok(fs.existsSync(path.join(dir, 'wcm/widget/painelObras/target/painelObras.war')), '.war gerado');
    const dsGerado = fs.readFileSync(path.join(dir, 'datasets/dsPainelObras.js'), 'utf8');
    assert.ok(dsGerado.includes("JNDI_DATASOURCE = '/jdbc/FluigDS'") && dsGerado.includes("'FLUIG.dbo.Z_DELP_PAINEL_OBRAS'"), 'dataset ja aponta para a base');
    const infoGerado = fs.readFileSync(path.join(dir, base, 'resources/application.info'), 'utf8');
    assert.ok(infoGerado.includes('developer.code=DELP0216') && infoGerado.includes('developer.name=dev.teste'));
    assert.ok(fs.readFileSync(path.join(dir, 'sql/01_CREATE_Z_DELP_PAINEL_OBRAS.sql'), 'utf8').includes('FLUIG.dbo.Z_DELP_PAINEL_OBRAS'));

    // Descoberta das configuracoes do projeto (datasets e application.info existentes)
    wsRoot = dir;
    fs.mkdirSync(path.join(dir, 'outros/datasets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'outros/datasets/dsLegado.js'), "var c = lookup('/jdbc/FluigDSRM');");
    fs.writeFileSync(
      path.join(dir, 'outros/datasets/dsProprio.js'),
      ["var JNDI_DATASOURCE = '/jdbc/OutroDS';", "var T = 'OUTRA.dbo.Z_DELP_X';", "var U = 'OUTRA.dbo.Z_DELP_Y';"].join('\n')
    );
    fs.rmSync(path.join(dir, 'datasets'), { recursive: true });
    const defs2 = await sc.projectDefaults();
    assert.strictEqual(defs2.DS_JNDI, '/jdbc/OutroDS', 'usa o JNDI dos datasets com tabelas Z_DELP_');
    assert.strictEqual(defs2.BASE, 'OUTRA');
    assert.strictEqual(defs2.DEV_CODE, 'DELP0216', 'developer.code do application.info existente');
    fs.mkdirSync(path.join(dir, 'datasets'), { recursive: true });

    // @gerar (ferramenta do agente)
    let g = await sc.runGenerate(ext, target, 'widget painelDois pdois');
    assert.ok(g.ok && g.summary.includes('wcm/widget/painelDois/src/main/resources/view.ftl'), g.summary);
    assert.ok(fs.existsSync(path.join(dir, 'datasets/dsPainelDois.js')), 'dataset acompanha o widget');
    g = await sc.runGenerate(ext, target, 'widget painelDois');
    assert.ok(!g.ok && g.summary.includes('já existe'), 'nao gera por cima');
    g = await sc.runGenerate(ext, target, 'widget Painel-Errado');
    assert.ok(!g.ok && g.summary.includes('inválido'));
    g = await sc.runGenerate(ext, target, 'formulário rq Requisição de Material');
    assert.ok(g.ok && fs.existsSync(path.join(dir, 'forms/000000 - Requisicao de Material/requisicaoMaterial.html')), g.summary);
    g = await sc.runGenerate(ext, target, 'dataset dsObrasMedicao');
    assert.ok(g.ok && fs.existsSync(path.join(dir, 'datasets/dsObrasMedicao.js')));
    g = await sc.runGenerate(ext, target, 'relatorio x');
    assert.ok(!g.ok);

    console.log(`gerados: ${all.length} arquivos; .war ok`);
    console.log('TODOS OS TESTES PASSARAM');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
