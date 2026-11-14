const Module = require('module'); const path = require('path'); const assert = require('assert');
const ROOT = process.argv[2];
const CONN = 'https://default087a74d85ae14e3dae04f3857de214.bc.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr5d2_DelpCopilotCodigo/conversations?api-version=2022-03-01-preview';
const settings = { 'studio.agents': [{ label: 'Claude Opus 4.8', connectionString: CONN }], 'studio.activeAgent': 'Claude Opus 4.8', 'usage.dailyTokenLimit': 0, 'auth.clientId': 'cid' };
class EventEmitter { constructor(){this.l=[]; this.event=(f)=>{this.l.push(f); return {dispose(){}}};} fire(v){this.l.forEach(f=>f(v));} dispose(){} }
const stub = {
  EventEmitter, ConfigurationTarget: { Global: 1 },
  workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d), update: async (k, v) => { settings[k] = v; } }) },
  authentication: { getSession: async () => ({ accessToken: 'T', account: { label: 'x' } }) },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? stub : orig.call(this, r, ...a); };
const { addAgent, activeAgent, studioAgents, setActiveAgent } = require(path.join(ROOT, 'out/studioAgents.js'));
const { UsageTracker } = require(path.join(ROOT, 'out/usage.js'));
const { CopilotStudioProvider } = require(path.join(ROOT, 'out/providers/copilotStudioProvider.js'));

(async () => {
  // agentes
  const a = await addAgent('GPT-5', 'cr5d2_DelpCopilotGpt5');
  assert.strictEqual(a.connectionString, CONN.replace('cr5d2_DelpCopilotCodigo', 'cr5d2_DelpCopilotGpt5'));
  assert.strictEqual(studioAgents().length, 2);
  await addAgent('GPT-5', 'https://outro/bots/x/conversations'); // atualiza, não duplica
  assert.strictEqual(studioAgents().length, 2);
  await addAgent('GPT-5', 'cr5d2_DelpCopilotGpt5');

  // provedor reinicia a conversa ao trocar de agente
  const urls = [];
  const sse = (conv) => new Response(`event: activity\ndata: ${JSON.stringify({ type: 'message', text: 'ok ' + conv, conversation: { id: conv } })}\n\nevent: end\ndata: end\n\n`, { status: 200, headers: { 'x-ms-conversationid': conv } });
  let n = 0;
  global.fetch = async (url) => { urls.push(url); return sse('C' + (++n)); };
  const p = new CopilotStudioProvider();
  const token = { onCancellationRequested: () => ({ dispose() {} }) };
  assert.strictEqual(p.model, 'Claude Opus 4.8');
  await p.send({ prompt: 'a', context: [] }, () => {}, token);
  await p.send({ prompt: 'b', context: [] }, () => {}, token);
  assert.strictEqual(urls.filter((u) => /\/conversations\?/.test(u)).length, 1, 'mesma conversa');
  await setActiveAgent('GPT-5');
  assert.strictEqual(p.model, 'GPT-5');
  await p.send({ prompt: 'c', context: [] }, () => {}, token);
  const starts = urls.filter((u) => /\/conversations\?/.test(u));
  assert.strictEqual(starts.length, 2, 'nova conversa no novo agente');
  assert.ok(starts[1].includes('cr5d2_DelpCopilotGpt5'));
  assert.strictEqual(activeAgent().label, 'GPT-5');

  // consumo
  const store = new Map();
  const memento = { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)), keys: () => [...store.keys()] };
  const u = new UsageTracker(memento);
  await u.record(4000, 2000);
  await u.record(400, 0);
  assert.deepStrictEqual(u.current, { requests: 2, tokensIn: 1100, tokensOut: 500 });
  assert.deepStrictEqual(u.today, u.current);
  assert.strictEqual(u.shortText, '≈ 1.6k tokens nesta conversa · 1.6k hoje');
  settings['usage.dailyTokenLimit'] = 1000;
  assert.ok(u.overDailyLimit);
  assert.ok(u.shortText.endsWith('/ 1.0k hoje'));
  u.resetConversation();
  assert.strictEqual(u.current.requests, 0);
  assert.strictEqual(u.today.requests, 2, 'dia continua');
  await u.resetAll();
  assert.strictEqual(u.today.requests, 0);
  console.log(u.detailText.split('\n')[0]);
  console.log('TODOS OS TESTES PASSARAM');
})().catch((e) => { console.error(e); process.exit(1); });
