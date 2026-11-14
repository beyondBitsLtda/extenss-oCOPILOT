const Module = require('module');
const path = require('path');
const fs = require('fs');
const ROOT = process.argv[2];
const settings = { 'auth.clientId': 'fake-client', 'm365.streaming': true };
const calls = [];
const vscodeStub = {
  workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }) },
  authentication: { getSession: async (p, scopes) => { calls.push({ scopes }); return { accessToken: 'TOKEN', account: { label: 'x' } }; } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscodeStub : origLoad.call(this, req, ...rest); };

const { M365CopilotProvider, cleanReply } = require(path.join(ROOT, 'out/providers/m365Provider.js'));
const assert = require('assert');

function sseResponse(chunks) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { chunks.forEach((ch) => c.enqueue(enc.encode(ch))); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const conv = (text) => JSON.stringify({ id: 'conv1', displayName: 'Intermediate Conversation Update', messages: [{ id: 'r', text }] }, null, 2);
// Formato da doc: JSON "pretty" em várias linhas após "data: ", eventos separados por linha em branco; cortes no meio de eventos.
const ev1 = 'data: ' + conv('Olá, aqui');
const ev2 = 'data: ' + conv('Olá, aqui está[^1^] o código:\n\n```java\nList<File> xs = new ArrayList<>();\n```\n<Person>Fulano</Person> ok');
const stream = ev1 + '\n\n' + ev2 + '\n\n';
const reqs = [];
global.fetch = async (url, init) => {
  reqs.push({ url, body: JSON.parse(init.body), headers: init.headers });
  if (url.endsWith('/conversations')) return new Response(JSON.stringify({ id: 'conv1' }), { status: 201 });
  if (url.endsWith('/chatOverStream')) return sseResponse([stream.slice(0, 37), stream.slice(37, 200), stream.slice(200)]);
  throw new Error('url inesperada ' + url);
};

(async () => {
  const p = new M365CopilotProvider();
  const updates = [];
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const final = await p.send({ prompt: 'Explique', context: [{ label: 'Arquivo a.java', text: 'class A {}', language: 'java' }] }, (t) => updates.push(t), token);
  console.log('updates:', updates.length);
  console.log('final:\n' + final);
  assert.strictEqual(updates.length, 2);
  assert.ok(final.includes('List<File> xs'), 'código preservado');
  assert.ok(!final.includes('[^1^]') && !final.includes('<Person>'), 'marcações removidas');
  assert.strictEqual(reqs[0].url, 'https://graph.microsoft.com/beta/copilot/conversations');
  assert.strictEqual(reqs[1].url, 'https://graph.microsoft.com/beta/copilot/conversations/conv1/chatOverStream');
  const body = reqs[1].body;
  assert.deepStrictEqual(body.contextualResources, { webContext: { isWebEnabled: false } });
  assert.ok(body.locationHint.timeZone);
  assert.ok(body.message.text.includes('```java\nclass A {}\n```'));
  assert.ok(calls[0].scopes.includes('VSCODE_CLIENT_ID:fake-client'));
  assert.ok(calls[0].scopes.includes('https://graph.microsoft.com/Sites.Read.All'));
  // segunda mensagem reaproveita a conversa
  await p.send({ prompt: 'De novo', context: [] }, () => {}, token);
  assert.strictEqual(reqs.filter((r) => r.url.endsWith('/conversations')).length, 1);

  // modo síncrono + additionalContext
  settings['m365.streaming'] = false; settings['m365.contextMode'] = 'additionalContext'; settings['m365.webSearch'] = true;
  global.fetch = async (url, init) => { reqs.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'conv1', messages: [{ text: JSON.parse(init.body).message.text }, { text: 'resposta sync' }] }), { status: 200 }); };
  const s = await p.send({ prompt: 'X', context: [{ label: 'L', text: 'code', language: 'ts' }] }, () => {}, token);
  assert.strictEqual(s, 'resposta sync');
  const last = reqs[reqs.length - 1];
  assert.ok(last.url.endsWith('/chat'));
  assert.strictEqual(last.body.additionalContext.length, 1);
  assert.strictEqual(last.body.contextualResources, undefined);

  // erro 403 com mensagem amigável
  global.fetch = async () => new Response(JSON.stringify({ error: { code: 'Forbidden', message: 'no license' } }), { status: 403 });
  await assert.rejects(p.send({ prompt: 'X', context: [] }, () => {}, token), /licença Microsoft 365 Copilot.*Forbidden: no license/);

  // ---- renderizador markdown do webview ----
  const src = fs.readFileSync(path.join(ROOT, 'media/chat.js'), 'utf8');
  const block = src.slice(src.indexOf('// ---------- Markdown'), src.indexOf('// ---------- Mensagens'));
  const render = new Function(block + '\nreturn render;')();
  const html = render('# Título\n\nTexto **forte** e `a<b>` e [link](https://x.com?a=1&b=2) <script>alert(1)</script>\n\n- item 1\n- item 2\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n````ts\nconst s = "```";\n````\n\n```python\nprint("<oi>")\n');
  console.log('\nhtml:\n' + html);
  assert.ok(!html.includes('<script>'), 'escapa HTML');
  assert.ok(html.includes('<code>a&lt;b&gt;</code>'));
  assert.ok(html.includes('const s = &quot;```&quot;;'), 'cerca de 4 crases');
  assert.ok(html.includes('print(&quot;&lt;oi&gt;&quot;)'), 'bloco não terminado (streaming)');
  assert.ok(html.includes('<table>') && html.includes('<ul>'));
  console.log('\nTODOS OS TESTES PASSARAM');
})().catch((e) => { console.error(e); process.exit(1); });
