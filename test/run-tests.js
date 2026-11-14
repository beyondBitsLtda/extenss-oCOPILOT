// Executa todos os testes (*.test.js) contra o código compilado em out/.
// Uso: npm test   (compila antes)
// Os testes não usam o VS Code real: cada um substitui o módulo 'vscode' por um dublê mínimo.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Projetos de exemplo para o teste da base de conhecimento (um Fluig e um comum).
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'delp-copilot-'));
const widget = path.join(fixtures, 'fluig-proj', 'wcm', 'widget', 'exemplo', 'src', 'main', 'resources');
fs.mkdirSync(widget, { recursive: true });
fs.writeFileSync(path.join(widget, 'application.info'), 'application.code=exemplo\n');
fs.writeFileSync(path.join(fixtures, 'fluig-proj', 'CLAUDE.md'), '# Instruções do projeto de exemplo\n');
fs.mkdirSync(path.join(fixtures, 'plain-proj'), { recursive: true });
fs.writeFileSync(path.join(fixtures, 'plain-proj', 'index.html'), '<!doctype html>\n');

const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const t of tests) {
  const args = [path.join(__dirname, t), ROOT];
  if (t === 'knowledge.test.js') args.push(fixtures);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${t}`);
  if (!ok) console.log((r.stdout || '') + (r.stderr || ''));
}
fs.rmSync(fixtures, { recursive: true, force: true });
console.log(`\n${tests.length - failed}/${tests.length} arquivos de teste passaram.`);
process.exit(failed ? 1 : 0);
