// Integração do painel de chat com um agente simulado (roteiro de respostas):
// cobrança de escopo (checklist), resposta cortada, modos Corrido/Planejado/Planejamento.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-chat-'));
const toUri = (p) => ({ fsPath: p, path: p, toString: () => p });

class EventEmitter {
  constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; }
  fire(v) { this.l.forEach((f) => f(v)); }
  dispose() {}
}
class CancellationTokenSource {
  constructor() {
    const subs = [];
    this.token = { isCancellationRequested: false, onCancellationRequested: (f) => { subs.push(f); return { dispose() {} }; } };
    this.cancel = () => { this.token.isCancellationRequested = true; subs.forEach((f) => f()); };
    this.dispose = () => {};
  }
}
const settings = { 'agent.autoApply': false, maxContextChars: 40000, provider: 'mock', 'knowledge.fluig': 'never' };
const stub = {
  EventEmitter,
  CancellationTokenSource,
  ConfigurationTarget: { Global: 1 },
  FileType: { File: 1, Directory: 2 },
  ThemeIcon: class {},
  QuickPickItemKind: { Separator: -1 },
  Uri: { file: (p) => toUri(p), joinPath: (u, ...p) => toUri(path.join(u.fsPath, ...p)) },
  RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
  Range: class {},
  WorkspaceEdit: class { createFile() {} replace() {} deleteFile() {} },
  commands: { executeCommand: async () => undefined },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    setStatusBarMessage: () => undefined,
    activeTextEditor: undefined,
    visibleTextEditors: [],
  },
  workspace: {
    workspaceFolders: [{ uri: toUri(dir), name: 'proj' }],
    getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d), update: async (k, v) => { settings[k] = v; } }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    findFiles: async () => [],
    asRelativePath: (u) => path.relative(dir, u.fsPath || String(u)).split(path.sep).join('/'),
    openTextDocument: async () => { throw new Error('nao existe'); },
    applyEdit: async () => true,
    textDocuments: [],
    fs: {
      stat: async (u) => {
        const s = fs.statSync(u.fsPath);
        return { type: s.isDirectory() ? 2 : 1, size: s.size };
      },
      readFile: async (u) => fs.readFileSync(u.fsPath),
      readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
      createDirectory: async () => undefined,
      writeFile: async () => undefined,
    },
  },
};
const orig = Module._load;
Module._load = function (r, ...a) {
  return r === 'vscode' ? stub : orig.call(this, r, ...a);
};
const { ChatViewProvider } = require(path.join(ROOT, 'out/chatViewProvider.js'));

function memento() {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? m.get(k) : d), update: async (k, v) => m.set(k, v), keys: () => [...m.keys()] };
}
const usage = { onDidChange: () => ({ dispose() {} }), overDailyLimit: false, shortText: '', resetConversation() {}, record: async () => {} };

function setup() {
  const posted = [];
  let onMsg;
  const chat = new ChatViewProvider(toUri(ROOT), {}, usage, memento(), memento());
  chat.resolveWebviewView({
    webview: {
      options: {},
      html: '',
      cspSource: '',
      asWebviewUri: (u) => u,
      onDidReceiveMessage: (cb) => { onMsg = cb; },
      postMessage: (m) => posted.push(m),
    },
    onDidDispose: () => {},
    show: () => {},
  });
  onMsg({ type: 'ready' });
  const requests = [];
  const script = [];
  chat.provider = {
    label: 'Simulado',
    local: true,
    reset() {},
    async send(req, onText) {
      requests.push(req);
      const r = script.shift();
      if (r === undefined) throw new Error('roteiro acabou');
      onText(r);
      return r;
    },
  };
  const notes = () => posted.filter((m) => m.type === 'note').map((m) => m.text);
  return { chat, posted, requests, script, notes, send: (m) => onMsg(m) };
}

const done = (items) => '```checklist\n' + items.map((i) => `- [x] ${i}`).join('\n') + '\n```';

(async () => {
  try {
    // A) Corrido: checklist com pendencia e cobrado ate completar
    let t = setup();
    t.script.push('```criar notas.txt\nola\n```\n```checklist\n- [x] criar notas\n- [ ] criar resumo\n```');
    t.script.push('```criar resumo.txt\nresumo\n```\n' + done(['criar notas', 'criar resumo']));
    let res = await t.chat.ask('crie notas e resumo', [], 'crie notas e resumo');
    assert.ok(res.ok, 'entrega completa');
    assert.ok(t.requests[0].prompt.startsWith('MODO DE TRABALHO: DESENVOLVIMENTO CORRIDO'), 'prefixo do modo corrido');
    assert.ok(/Ainda faltam itens/.test(t.requests[1].prompt) && t.requests[1].prompt.includes('criar resumo'), 'cobrou o pendente');
    assert.ok(t.notes().some((n) => n.startsWith('✅ Escopo completo')), t.notes().join(' | '));

    // B) Resposta cortada no meio de um bloco -> pede continuacao
    t = setup();
    t.script.push('vou criar\n```criar a.txt\nconteudo sem fim');
    t.script.push('```criar a.txt\nconteudo completo\n```\n' + done(['criar a']));
    res = await t.chat.ask('crie a.txt', [], 'crie a.txt');
    assert.ok(res.ok);
    assert.ok(/foi cortada dentro do bloco iniciado por "```criar a.txt"/.test(t.requests[1].prompt), t.requests[1].prompt);

    // C) Entrega sem checklist -> pede checklist uma vez
    t = setup();
    t.script.push('```criar b.txt\nb\n```');
    t.script.push(done(['criar b']));
    res = await t.chat.ask('crie b.txt', [], 'crie b.txt');
    assert.ok(res.ok && /checklist do escopo/.test(t.requests[1].prompt));

    // D) Planejado: plano -> executar todas as etapas
    t = setup();
    await t.chat.setMode('planejado');
    t.script.push('Abordagem\n```plano\n1. Criar arquivo x — x.txt\n2. Criar arquivo y — y.txt\n```');
    res = await t.chat.ask('crie x e y', [], 'crie x e y');
    assert.ok(t.requests[0].prompt.includes('FASE DE PLANO'));
    const planMsg = t.posted.filter((m) => m.type === 'plan').pop();
    assert.strictEqual(planMsg.steps.length, 2, 'plano exibido');
    t.script.push('```criar x.txt\nx\n```\n' + done(['x']));
    t.script.push('```criar y.txt\ny\n```\n' + done(['y']));
    await t.chat.runPlan(0, true);
    assert.ok(t.requests[1].prompt.includes('EXECUTE A ETAPA 1 DE 2') && t.requests[2].prompt.includes('EXECUTE A ETAPA 2 DE 2'));
    const last = t.posted.filter((m) => m.type === 'plan').pop();
    assert.deepStrictEqual(last.steps.map((s) => s.status), ['concluida', 'concluida']);
    assert.ok(t.notes().some((n) => n.startsWith('🏁 Plano concluído')));

    // E) Planejamento (ideia): nao altera arquivos e oferece salvar/gerar plano
    t = setup();
    await t.chat.setMode('ideacao');
    t.script.push('## Objetivo\nPainel\n```editar algo.js\n<<<<<<< BUSCAR\na\n=======\nb\n>>>>>>> SUBSTITUIR\n```');
    res = await t.chat.ask('quero um painel de obras', [], 'quero um painel de obras');
    assert.ok(t.requests[0].prompt.includes('PLANEJAMENTO DA IDEIA'));
    assert.ok(t.notes().some((n) => n.includes('não altera arquivos')));
    assert.ok(t.posted.some((m) => m.type === 'specActions'));
    assert.strictEqual(t.requests.length, 1, 'sem rodadas de correcao no modo ideia');

    // F) Acoes do editor (modo livre) nao recebem prefixo nem cobranca de checklist
    t = setup();
    t.script.push('Explicacao do codigo.');
    res = await t.chat.ask('Explique', [], 'Explicar', undefined, false, false, { mode: 'livre' });
    assert.ok(res.ok && t.requests[0].prompt === 'Explique' && t.requests.length === 1);

    // G) Caminho fora do projeto citado na mensagem vira referencia: o agente le, mas nao escreve
    const refDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-chatref-'));
    fs.writeFileSync(path.join(refDir, 'padrao.js'), 'function padrao() {}\n');
    try {
      t = setup();
      const shown = refDir.replace(/\\/g, '/');
      t.script.push(`@ler: ${shown}/padrao.js`);
      t.script.push('```editar ' + shown + '/padrao.js\n<<<<<<< BUSCAR\nfunction padrao() {}\n=======\nfunction x() {}\n>>>>>>> SUBSTITUIR\n```');
      t.script.push('```criar novo.js\nfunction padrao() {}\n```\n' + done(['seguir o padrao']));
      const pedido = `crie novo.js seguindo o padrão de ${refDir}`;
      res = await t.chat.ask(pedido, [], pedido);
      assert.ok(res.ok, 'entrega completa');
      const refItem = t.requests[0].context.find((c) => c.label.startsWith('Referência somente leitura:'));
      assert.ok(refItem && refItem.text.includes('padrao.js'), 'estrutura da referência vai na mensagem');
      assert.ok(t.notes().some((n) => n.startsWith('🔒 Referência somente leitura:')), t.notes().join(' | '));
      assert.deepStrictEqual(t.posted.filter((m) => m.type === 'references').pop().items.map((r) => r.name), [path.basename(refDir)]);
      assert.ok(t.requests[1].context.some((c) => c.text.includes('function padrao')), 'leu o arquivo da referência');
      assert.ok(/somente leitura/.test(t.requests[2].prompt), 'edição na referência recusada e devolvida ao agente');
      t.script.push('ok');
      await t.chat.ask('e agora?', [], 'e agora?', undefined, false, false, { mode: 'livre' });
      assert.ok(t.requests[3].context.some((c) => c.label === 'Referências somente leitura'), 'depois, só o lembrete');
      await t.send({ type: 'removeReference', path: path.resolve(refDir) });
      assert.deepStrictEqual(t.posted.filter((m) => m.type === 'references').pop().items, []);
      assert.ok(t.notes().some((n) => n.startsWith('🔓 Referência removida')));
    } finally {
      fs.rmSync(refDir, { recursive: true, force: true });
    }

    // H) Historico: listar, renomear, arquivar, reabrir, continuar e excluir
    t = setup();
    t.script.push('Resposta 1.');
    await t.chat.ask('primeira conversa', [], 'primeira conversa', undefined, false, false, { mode: 'livre' });
    await t.send({ type: 'listHistory' });
    const lastOf = (type) => t.posted.filter((m) => m.type === type).pop();
    let hist = lastOf('history');
    assert.strictEqual(hist.items.length, 1);
    const id = hist.items[0].id;
    assert.ok(hist.activeId === id && hist.items[0].title === 'primeira conversa' && /^1 pedido\(s\)/.test(hist.items[0].detail));
    assert.deepStrictEqual(lastOf('conversation'), { type: 'conversation', id, title: 'primeira conversa' }, 'cabeçalho com o título');
    await t.send({ type: 'renameConversation', id, title: '  Painel   de obras ' });
    assert.strictEqual(lastOf('conversation').title, 'Painel de obras');
    await t.send({ type: 'archiveConversations', ids: [id], archived: true });
    assert.ok(lastOf('history').items[0].archived);
    t.chat.newChat();
    assert.strictEqual(lastOf('conversation').id, undefined, 'nova conversa sem título');
    await t.send({ type: 'openConversation', id });
    assert.ok(lastOf('restore').turns.some((x) => x.text === 'primeira conversa'));
    assert.strictEqual(lastOf('conversation').title, 'Painel de obras');
    t.script.push('Resposta 2.');
    await t.chat.ask('segunda pergunta', [], 'segunda pergunta', undefined, false, false, { mode: 'livre' });
    assert.ok(t.requests[1].context.some((c) => c.label === 'Histórico da conversa até aqui'), 'transcrição vai ao agente');
    await t.send({ type: 'listHistory' });
    hist = lastOf('history');
    assert.ok(hist.items.length === 1 && hist.items[0].archived && hist.items[0].title === 'Painel de obras', 'continuar não perde nome nem arquivamento');
    assert.ok(/^2 pedido\(s\)/.test(hist.items[0].detail));
    stub.window.showWarningMessage = async () => 'Excluir';
    await t.send({ type: 'deleteConversation', id });
    stub.window.showWarningMessage = async () => undefined;
    assert.strictEqual(lastOf('history').items.length, 0);
    assert.strictEqual(lastOf('conversation').id, undefined, 'conversa aberta excluída: começa outra');

    console.log('TODOS OS TESTES PASSARAM');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
