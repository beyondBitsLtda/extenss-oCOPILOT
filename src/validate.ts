import * as vm from 'vm';
import * as vscode from 'vscode';
import { EditProblem, resolveInWorkspace } from './agent';

/**
 * Portão de qualidade: confere o conteúdo resultante das edições do agente antes de dar a
 * entrega por concluída. O que falhar volta ao agente para correção.
 *  - .js: sintaxe (compilação sem executar);
 *  - Fluig server-side e widgets: só ES5 (Rhino / convenção da equipe);
 *  - widget: recursos do application.info existem, sem chave repetida, SuperWidget = application.code;
 *  - design (widget): cores só da paleta DELP, sem style inline, gráficos via chartHelper, sem alert/confirm
 *    (só o que a entrega introduziu; problema que já existia no arquivo não é cobrado).
 */

export interface FileResult {
  path: string;
  text: string;
}

const ES5_PATH = /(^|\/)(datasets|events|workflow\/scripts|mechanisms)\/[^/]+\.js$|(^|\/)wcm\/widget\/.+\.js$|(^|\/)forms\/.+\.js$/i;

/** Remove comentários e literais de string (aproximado) para checar sintaxe ES5 sem falso positivo. */
function stripCode(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');
}

export function es5Problems(code: string): string[] {
  const c = stripCode(code);
  const found: string[] = [];
  if (/(^|[^\w$.])(let|const)\s+[\w$[{]/m.test(c)) found.push('let/const');
  if (/=>/.test(c)) found.push('arrow function (=>)');
  if (/`/.test(c)) found.push('template literal (crase)');
  if (/(^|[^\w$.])class\s+[A-Za-z_$]/m.test(c)) found.push('class');
  return found;
}

export function syntaxProblem(code: string, path: string): string | undefined {
  try {
    // Compila sem executar; o wrapper de função aceita "return" de nível superior usado em alguns scripts.
    new vm.Script(`(function(){\n${code}\n})`, { filename: path });
    return undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const line = e instanceof Error && /:(\d+)/.exec(String(e.stack || ''))?.[1];
    return `erro de sintaxe JavaScript${line ? ` perto da linha ${Number(line) - 1}` : ''}: ${msg}`;
  }
}

// ---------------------------------------------------------------------------
// Design (widgets): paleta DELP, sem CSS inline, gráficos pelo chartHelper, sem alert/confirm.
// ---------------------------------------------------------------------------
const PALETA_DELP = new Set(['CC0F10', '2362D3', 'FF6B05', '0B861D', '213D75', 'B0B0B0', 'EAE5DF', '000000', 'FFFFFF']);
const DESIGN_PATH = /(^|\/)wcm\/widget\//i;

function hexForaDaPaleta(hex: string): boolean {
  let h = hex.toUpperCase();
  if (h.length === 3 || h.length === 4) {
    h = h.slice(0, 3).split('').map((c) => c + c).join('');
  }
  return !PALETA_DELP.has(h.slice(0, 6));
}

/** Problemas de design de um arquivo de widget (lista vazia = ok). */
export function designProblems(path: string, text: string): string[] {
  const p = path.replace(/\\/g, '/');
  if (!DESIGN_PATH.test(p) || /\/lib\//i.test(p) || /\.min\.(js|css)$/i.test(p)) {
    return [];
  }
  const found: string[] = [];
  const cores = new Set<string>();
  if (/\.css$/i.test(p)) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // só valores de declaração (terminam em ; ou }), para não confundir #id de seletor com cor
    for (const decl of css.matchAll(/[\w-]+\s*:\s*([^;{}]+)(?=[;}])/g)) {
      for (const m of decl[1].matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) {
        if (hexForaDaPaleta(m[1])) cores.add(`#${m[1]}`);
      }
    }
  } else if (/\.js$/i.test(p)) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/['"]#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})['"]/g)) {
      if (hexForaDaPaleta(m[1])) cores.add(`#${m[1]}`);
    }
    if (!/(^|\/)chartHelper\.js$/i.test(p) && /\bnew\s+(window\.|global\.)?Chart\s*\(/.test(code)) {
      found.push('usa "new Chart" direto — gráficos passam por <ns>.grafico.barras/linha/rosca (chartHelper.js)');
    }
    if (/(^|[^\w$.])(window\.)?(alert|confirm|prompt)\s*\(/m.test(stripCode(text))) {
      found.push('usa alert/confirm/prompt — use o kit de UI (C.Toast, C.Confirmacao, C.Modal)');
    }
  } else if (/\.(ftl|html?)$/i.test(p)) {
    if (/\sstyle\s*=\s*["']/i.test(text)) {
      found.push('tem style="..." inline — toda aparência vai para o CSS da widget com tokens');
    }
  }
  for (const cor of [...cores].slice(0, 6)) {
    found.push(`cor ${cor} fora da paleta DELP — use os tokens var(--<ns>-*) ou transparência (rgba) de uma cor da paleta`);
  }
  return found;
}

async function existsOnDisk(rel: string): Promise<boolean> {
  const uri = resolveInWorkspace(rel);
  if (!uri) {
    return false;
  }
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readOnDisk(rel: string): Promise<string | undefined> {
  const uri = resolveInWorkspace(rel);
  if (!uri) {
    return undefined;
  }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** Valida os arquivos alterados/criados (conteúdo final). */
export async function validateFiles(results: FileResult[]): Promise<EditProblem[]> {
  const problems: EditProblem[] = [];
  const inBatch = new Map(results.map((r) => [r.path.replace(/\\/g, '/'), r.text]));
  const textOf = async (rel: string) => inBatch.get(rel) ?? (await readOnDisk(rel));

  for (const r of results) {
    const path = r.path.replace(/\\/g, '/');
    if (/\.js$/i.test(path) && !/\.min\.js$/i.test(path)) {
      const syn = syntaxProblem(r.text, path);
      if (syn) {
        problems.push({ path, message: syn, kind: 'validation' });
      } else if (ES5_PATH.test(path)) {
        const es5 = es5Problems(r.text);
        if (es5.length) {
          problems.push({ path, message: `usa ${es5.join(', ')} — Fluig/Rhino e o padrão da equipe exigem ES5`, kind: 'validation' });
        }
      }
    }
  }

  // Design: só cobra o que esta entrega introduziu (código legado não trava a correção).
  for (const r of results) {
    const path = r.path.replace(/\\/g, '/');
    const now = designProblems(path, r.text);
    if (!now.length) continue;
    const before = await readOnDisk(path);
    const old = new Set(before === undefined ? [] : designProblems(path, before));
    for (const msg of now) {
      if (!old.has(msg)) problems.push({ path, message: `design: ${msg}`, kind: 'validation' });
    }
  }

  // Widgets tocados nesta entrega: consistência do application.info.
  const widgets = new Set<string>();
  for (const r of results) {
    const m = /^(.*?wcm\/widget\/[^/]+)\//.exec(r.path.replace(/\\/g, '/'));
    if (m) {
      widgets.add(m[1]);
    }
  }
  for (const w of widgets) {
    const infoPath = `${w}/src/main/resources/application.info`;
    const info = await textOf(infoPath);
    if (info === undefined) {
      problems.push({ path: infoPath, message: 'widget sem application.info', kind: 'validation' });
      continue;
    }
    const keys = new Map<string, number>();
    let code = '';
    const resources: string[] = [];
    for (const raw of info.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      keys.set(key, (keys.get(key) ?? 0) + 1);
      if (key === 'application.code') code = value;
      if (/^application\.resource\.(js|css)\.\d+$/.test(key)) resources.push(value);
    }
    for (const [k, n] of keys) {
      if (n > 1) problems.push({ path: infoPath, message: `chave repetida ${k} (o .properties mantém só a última)`, kind: 'validation' });
    }
    for (const res of resources) {
      const rel = `${w}/src/main/webapp${res.startsWith('/') ? res : `/${res}`}`;
      if (!inBatch.has(rel) && !(await existsOnDisk(rel))) {
        problems.push({ path: infoPath, message: `recurso declarado e inexistente: ${res}`, kind: 'validation' });
      }
    }
    const mainPath = `${w}/src/main/webapp/resources/js/main.function.js`;
    const main = await textOf(mainPath);
    if (main && code) {
      const m = /var\s+([A-Za-z_$][\w$]*)\s*=\s*SuperWidget\.extend/.exec(main);
      if (m && m[1] !== code) {
        problems.push({ path: mainPath, message: `SuperWidget "${m[1]}" diferente do application.code "${code}" (a widget não inicia)`, kind: 'validation' });
      }
    }
  }
  return problems;
}
