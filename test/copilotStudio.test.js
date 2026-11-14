const Module = require('module'); const path = require('path'); const assert = require('assert');
const ROOT = process.argv[2];
const CONN = 'https://default087a74d85ae14e3dae04f3857de214.bc.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr5d2_delpcopilotcdigo_wVNLp3/conversations?api-version=2022-03-01-preview';
const scopesSeen = [];
const stub = {
  workspace: { getConfiguration: () => ({ get: (k, d) => ({ 'auth.clientId': 'cid', 'auth.tenantId': 'tid', 'studio.agents': [{ label: 'Claude Opus 4.8', connectionString: CONN }], 'studio.activeAgent': 'Claude Opus 4.8' })[k] ?? d }) },
  authentication: { getSession: async (p, s) => { scopesSeen.push(s); return { accessToken: 'PPTOKEN', account: { label: 'x' } }; } },
};
const orig = Module._load; Module._load = function (r, ...a) { return r === 'vscode' ? stub : orig.call(this, r, ...a); };
const { CopilotStudioProvider, buildUrl } = require(path.join(ROOT, 'out/providers/copilotStudioProvider.js'));

const sse = (events, headers = {}) => {
  const enc = new TextEncoder(); const text = events.map(([e, d]) => `event: ${e}\ndata: ${typeof d === 'string' ? d : JSON.stringify(d)}\n\n`).join('');
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < text.length; i += 50) c.enqueue(enc.encode(text.slice(i, i + 50))); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', ...headers } });
};
const reqs = [];
global.fetch = async (url, init) => {
  reqs.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
  if (reqs.length === 1) return sse([['activity', { type: 'message', text: 'Olá! Sou o agente.', conversation: { id: 'C1' } }], ['end', 'end']], { 'x-ms-conversationid': 'C1' });
  const s = (t, n) => ({ type: 'typing', text: t, entities: [{ type: 'streaminfo', streamType: 'streaming', streamId: 'S', streamSequence: n }] });
  return sse([['activity', s('Aqui ', 1)], ['activity', s('está:', 2)], ['activity', { type: 'message', text: 'Aqui está:\n```ts\nconst x = 1;\n```', conversation: { id: 'C1' } }], ['end', 'end']]);
};
(async () => {
  assert.strictEqual(buildUrl(CONN, 'C 1'), CONN.replace('/conversations?', '/conversations/C%201?'));
  const p = new CopilotStudioProvider();
  const updates = [];
  const token = { onCancellationRequested: () => ({ dispose() {} }) };
  const out = await p.send({ prompt: 'Refatore', context: [{ label: 'a.ts', text: 'var x = 1', language: 'typescript' }] }, (t) => updates.push(t), token);
  console.log('updates:', JSON.stringify(updates));
  assert.strictEqual(out, 'Aqui está:\n```ts\nconst x = 1;\n```');
  assert.deepStrictEqual(updates.slice(0, 2), ['Aqui ', 'Aqui está:'], 'streaming parcial');
  assert.ok(!updates.some((u) => u.includes('Olá')), 'boas-vindas descartadas');
  assert.strictEqual(reqs[0].url, CONN);
  assert.deepStrictEqual(reqs[0].body, { emitStartConversationEvent: true });
  assert.ok(reqs[1].url.includes('/conversations/C1?api-version=2022-03-01-preview'));
  assert.strictEqual(reqs[1].body.activity.type, 'message');
  assert.strictEqual(reqs[1].body.activity.conversation.id, 'C1');
  assert.ok(reqs[1].body.activity.text.includes('var x = 1'));
  assert.strictEqual(reqs[1].auth, 'Bearer PPTOKEN');
  assert.deepStrictEqual(scopesSeen[0], ['https://api.powerplatform.com/CopilotStudio.Copilots.Invoke', 'VSCODE_CLIENT_ID:cid', 'VSCODE_TENANT:tid']);
  // segunda mensagem reutiliza a conversa
  await p.send({ prompt: 'De novo', context: [] }, () => {}, token);
  assert.strictEqual(reqs.length, 3);
  // 403
  global.fetch = async () => new Response('forbidden', { status: 403 });
  await assert.rejects(p.send({ prompt: 'x', context: [] }, () => {}, token), /Acesso negado ao agente/);
  console.log('TODOS OS TESTES PASSARAM');
})().catch((e) => { console.error(e); process.exit(1); });
