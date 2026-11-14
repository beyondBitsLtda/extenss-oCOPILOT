// Testes do addon de navegador (addon/delp-copilot-addon.js) - sem DOM, sem VS Code.
// Carrega o arquivo num contexto isolado com window/document minimos e testa as
// partes puras: veredito, markdown seguro, mascara LGPD, URL do agente, SSE e
// a copia do CSS embutido.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const ARQ = path.join(ROOT, 'addon', 'delp-copilot-addon.js');
const fonte = fs.readFileSync(ARQ, 'utf8');

const win = { location: { origin: 'http://fluig.teste', pathname: '/x', search: '' } };
const doc = { readyState: 'complete', body: null, addEventListener() {} };
vm.runInNewContext(fonte, { window: win, document: doc, setTimeout, clearTimeout, URL, URLSearchParams, Promise, Error, JSON, Math, Date, String, Object, Array });
const api = win.DelpCopilotAddon;
assert.ok(api && api.versao, 'expoe window.DelpCopilotAddon');
const I = api._interno;

// 1) CSS embutido = CSS do arquivo fonte
const emb = require(path.join(ROOT, 'addon', 'ferramentas', 'embutir-css.js'));
const css = fs.readFileSync(emb.ARQ_CSS, 'utf8');
assert.strictEqual(emb.embutir(fonte, css), fonte, 'CSS desatualizado: rode node addon/ferramentas/embutir-css.js');

// 2) veredito
let v = I.extrairVeredito('Analise...\n\nVEREDITO: REPROVADO\nTIPO_FALHA: Erro de dados\nPRIORIDADE: Alta\nDESCRICAO_TICKET: Total nao soma os itens.');
assert.deepStrictEqual([v.veredito, v.tipoFalha, v.prioridade, v.descricao], ['REPROVADO', 'Erro de dados', 'Alta', 'Total nao soma os itens.']);
assert.strictEqual(v.textoVisivel, 'Analise...', 'as 4 linhas somem do texto mostrado');
v = I.extrairVeredito('**VEREDITO:** aprovado\n**TIPO_FALHA:** N/A\n- PRIORIDADE: Média\nDESCRICAO_TICKET:');
assert.deepStrictEqual([v.veredito, v.tipoFalha, v.prioridade, v.descricao], ['APROVADO', '', 'Media', '']);
v = I.extrairVeredito('VEREDITO: INCONCLUSIVO\nTIPO_FALHA: erro de usabilidade\nPRIORIDADE: crítica');
assert.deepStrictEqual([v.veredito, v.tipoFalha, v.prioridade], ['INCONCLUSIVO', 'Erro de usabilidade', 'Critica']);
assert.strictEqual(I.extrairVeredito('sem bloco nenhum').veredito, '');
// varios tickets (um por problema), linhas escondidas do texto mostrado
v = I.extrairVeredito('Conclusao: nao salvou.\nVEREDITO: REPROVADO\nPRIORIDADE: Alta\n' +
    'TICKET: Alta | Salvar nao grava | POST dsX HTTP 500 [+00:03.1]\n- TICKET 2: baixa | Mensagem confusa | texto do aviso errado\nTICKET: so a descricao');
assert.strictEqual(v.textoVisivel, 'Conclusao: nao salvou.');
assert.strictEqual(v.tickets.length, 3);
assert.deepStrictEqual([v.tickets[0].prioridade, v.tickets[0].titulo, v.tickets[0].descricao], ['Alta', 'Salvar nao grava', 'POST dsX HTTP 500 [+00:03.1]']);
assert.deepStrictEqual([v.tickets[1].prioridade, v.tickets[1].titulo], ['Baixa', 'Mensagem confusa']);
assert.deepStrictEqual([v.tickets[2].prioridade, v.tickets[2].titulo, v.tickets[2].descricao], ['Alta', '', 'so a descricao']);
v = I.extrairVeredito('VEREDITO: REPROVADO\nPRIORIDADE: Media\nDESCRICAO_TICKET: formato antigo');
assert.deepStrictEqual([v.tickets.length, v.tickets[0].descricao, v.tickets[0].prioridade], [1, 'formato antigo', 'Media']);

// 3) markdown nunca vira HTML do agente
const h = I.markdown('<script>alert(1)</script> **ok** [x](javascript:alert(1)) [y](https://delp.com.br)\n\n| a | b |\n|---|---|\n| <img src=x onerror=1> | 2 |');
assert.ok(!/<script|<img/i.test(h), 'escapa tags');
assert.ok(h.includes('&lt;script&gt;') && h.includes('<strong>ok</strong>'));
assert.ok(!/href="javascript/i.test(h), 'link so http(s)');
assert.ok(h.includes('href="https://delp.com.br"') && h.includes('<table class="dca-md-tabela">'));

// 4) mascara LGPD
const m = I.mascarar('CPF 123.456.789-09, cnpj 11.222.333/0001-81, mail ana.silva@delp.com.br e 12345678909');
assert.ok(!/123\.456|11\.222|ana\.silva|12345678909/.test(m), m);
assert.ok(m.includes('[CPF]') && m.includes('[CNPJ]') && m.includes('[e-mail]'));

// 5) URL do agente (mesma regra do SDK)
const base = 'https://x.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/b1/conversations?api-version=2022-03-01-preview';
assert.strictEqual(I.montarUrl(base), 'https://x.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/b1/conversations?api-version=2022-03-01-preview');
assert.ok(I.montarUrl(base, 'c/1').endsWith('/conversations/c%2F1?api-version=2022-03-01-preview'));

// 6) streaming fora de ordem e remontado pela sequencia
const acc = new I.Acumulador();
acc.tratar({ type: 'typing', text: ' mundo', entities: [{ type: 'streaminfo', streamId: 's', streamSequence: 2 }], conversation: { id: 'cv' } });
acc.tratar({ type: 'typing', text: 'Ola', entities: [{ type: 'streaminfo', streamId: 's', streamSequence: 1 }] });
assert.strictEqual(acc.texto(), 'Ola mundo');
acc.tratar({ type: 'message', text: 'Ola mundo!' });
assert.strictEqual(acc.final(), 'Ola mundo!');
assert.strictEqual(acc.conversaId, 'cv');
// 6b) streaming do Agents SDK: 1o pedaco SEM streamId (cortava o "Ola" do comeco da resposta)
const pedaco = (txt, seq, sid, tipo) => ({ type: 'typing', text: txt,
    entities: [Object.assign({ type: 'streaminfo', streamType: tipo || 'streaming', streamSequence: seq }, sid ? { streamId: sid } : {})] });
let ac = new I.Acumulador();
[pedaco('Ol', 1), pedaco('a, Brayan!', 2, 'S'), pedaco(' Tudo certo.', 3, 'S')].forEach((x) => ac.tratar(x));
assert.strictEqual(ac.texto(), 'Ola, Brayan! Tudo certo.', '1o pedaco sem streamId entra no texto');
assert.strictEqual(ac.final(), 'Ola, Brayan! Tudo certo.', 'sem mensagem final vale o streaming');
ac.tratar({ type: 'message', text: 'a, Brayan! Tudo certo.' });
assert.strictEqual(ac.final(), 'Ola, Brayan! Tudo certo.', 'mensagem final cortada no comeco: vale o streaming');
ac = new I.Acumulador();
[pedaco('Pesquisando...', 1, 'S', 'informative'), pedaco('Ola', 2, 'S'), pedaco('Ola, mundo', 3, 'S')].forEach((x) => ac.tratar(x));
assert.strictEqual(ac.texto(), 'Ola, mundo', 'informativo fora; pedaco cumulativo substitui');
assert.strictEqual(ac.diagnostico.length, 3);
assert.strictEqual(ac.diagnostico[0].streamType, 'informative');

const bl = I.lerBlocoSse('event: activity\ndata: {"a":1}');   /* objeto de outro contexto (vm): compara campos */
assert.deepStrictEqual([bl.evento, bl.dados], ['activity', '{"a":1}']);

// 7) instrucoes do modo testar pedem o bloco que o parser le
const pre = I.preambuloTestar('baseAPE');
['VEREDITO:', 'TIPO_FALHA:', 'PRIORIDADE:', 'TICKET:', 'ESCREVA PARA O TESTADOR', 'baseAPE'].forEach((k) => assert.ok(pre.includes(k), k));

// 7b) modos da pagina (extensoes): so id simples com rotulo; "testar"/"livre" nao se sobrescrevem
const ext = I.modosDaPagina({ fluxo: { rotulo: 'Fluxograma' }, 'X y': { rotulo: 'ruim' }, livre: { rotulo: 'tenta trocar' }, semRotulo: {}, nada: null });
assert.deepStrictEqual(Object.keys(ext), ['fluxo']);
assert.deepStrictEqual(Array.from(I.modosVisiveis(null, ext)), ['testar', 'livre'], 'padrao: os dois do addon');
assert.deepStrictEqual(Array.from(I.modosVisiveis(['fluxo', 'fluxo', 'inexistente', 'livre'], ext)), ['fluxo', 'livre'], 'sem repetido nem desconhecido');
assert.deepStrictEqual(Array.from(I.modosVisiveis(['inexistente'], ext)), ['livre'], 'nada valido: cai no livre');

// 8) ES5 (padrao Fluig): nada de arrow, let/const ou template string fora do CSS embutido
const semCss = fonte.split('\n').filter((l) => !/^\s*var CSS = /.test(l)).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/(^|[=(,:!&|?{};]|return)\s*\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/gm, '$1 RE')  /* literais de regex */
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
assert.ok(!/=>/.test(semCss), 'sem arrow function');
assert.ok(!/\b(let|const|class)\s/.test(semCss), 'sem let/const/class');
assert.ok(!/`/.test(semCss), 'sem template string');

console.log('addon: ok');
