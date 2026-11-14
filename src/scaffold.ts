import * as os from 'os';
import * as vscode from 'vscode';

/**
 * Gerador de estrutura a partir dos modelos em templates/<nome>/ (embutidos na extensão).
 * Placeholders {{NOME}} são substituídos no caminho e no conteúdo. Arquivos que já existem
 * no destino nunca são sobrescritos.
 */
export type ScaffoldVars = Record<string, string>;

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

export function fillPlaceholders(text: string, vars: ScaffoldVars): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (all, name: string) => (name in vars ? vars[name] : all));
}

async function listFiles(root: vscode.Uri, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const dir = rel ? vscode.Uri.joinPath(root, rel) : root;
  for (const [name, type] of await vscode.workspace.fs.readDirectory(dir)) {
    const child = rel ? `${rel}/${name}` : name;
    if (type & vscode.FileType.Directory) {
      out.push(...(await listFiles(root, child)));
    } else {
      out.push(child);
    }
  }
  return out;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function scaffold(
  extensionUri: vscode.Uri,
  template: string,
  target: vscode.Uri,
  vars: ScaffoldVars
): Promise<ScaffoldResult> {
  const root = vscode.Uri.joinPath(extensionUri, 'templates', template);
  const result: ScaffoldResult = { created: [], skipped: [] };
  for (const rel of (await listFiles(root)).sort()) {
    const destRel = fillPlaceholders(rel, vars);
    const dest = vscode.Uri.joinPath(target, ...destRel.split('/'));
    if (await exists(dest)) {
      result.skipped.push(destRel);
      continue;
    }
    const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, ...rel.split('/'))));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dest, '..'));
    await vscode.workspace.fs.writeFile(dest, new TextEncoder().encode(fillPlaceholders(content, vars)));
    result.created.push(destRel);
  }
  return result;
}

// ---- Derivação de nomes (convenções DELP) ----

/** "painelDeObras" -> ["painel","De","Obras"] */
function camelWords(code: string): string[] {
  return code.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean);
}

export function titleFromCode(code: string): string {
  return camelWords(code)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Namespace curto: última palavra significativa do code (portalTestes -> testes). */
export function namespaceFromCode(code: string): string {
  const words = camelWords(code).map((w) => w.toLowerCase());
  const last = [...words].reverse().find((w) => w.length >= 3);
  return (last ?? code.toLowerCase()).replace(/[^a-z0-9]/g, '').slice(0, 12);
}

export function camelFromTitle(title: string): string {
  const words = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(de|da|do|das|dos|e)$/i.test(w));
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
}

export function asciiTitle(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|]/g, '').trim();
}

export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Configuração de banco e desenvolvedor para os modelos, descoberta no próprio projeto:
 * datasource (JNDI) e base mais usados nos datasets com tabelas Z_DELP_, e developer.code/name
 * dos application.info existentes. Sem nada no projeto, usa o padrão da equipe (configurável).
 */
export async function projectDefaults(): Promise<ScaffoldVars> {
  const cfg = vscode.workspace.getConfiguration('delpCopilot');
  let jndi = cfg.get<string>('fluig.datasource', '/jdbc/FluigDS');
  let base = cfg.get<string>('fluig.database', 'FLUIG');
  let devCode = cfg.get<string>('fluig.developerCode', 'DELP0216');
  let devName = cfg.get<string>('fluig.developerName', '');
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const read = async (u: vscode.Uri) => {
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(u));
      } catch {
        return '';
      }
    };
    const count = (map: Map<string, number>, key: string, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
    const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const jndis = new Map<string, number>();
    const bases = new Map<string, number>();
    const datasets = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/datasets/**/*.js'), '**/node_modules/**', 300);
    for (const uri of datasets) {
      const text = await read(uri);
      const ownTables = text.includes('Z_DELP_');
      for (const m of text.matchAll(/(?:JNDI[A-Z_]*\s*=\s*|lookup\(\s*)['"]((?:java:)?\/?jdbc\/[\w.-]+)['"]/g)) {
        // datasets com tabelas proprias (Z_DELP_) pesam mais: e o mesmo tipo de dataset que o modelo gera
        count(jndis, m[1], ownTables ? 10 : 1);
      }
      for (const m of text.matchAll(/\b([A-Za-z_]\w*)\.dbo\.Z_DELP_/g)) {
        count(bases, m[1]);
      }
    }
    jndi = top(jndis) ?? jndi;
    base = top(bases) ?? base;
    const infos = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/application.info'), '**/node_modules/**', 20);
    for (const uri of infos) {
      const text = await read(uri);
      const code = /^developer\.code=([^<\r\n]+)$/m.exec(text)?.[1]?.trim();
      const name = /^developer\.name=([^<\r\n]+)$/m.exec(text)?.[1]?.trim();
      if (code) devCode = code;
      if (name && !devName) devName = name;
      if (code) break;
    }
  }
  if (!devName) {
    try {
      devName = os.userInfo().username;
    } catch {
      devName = 'desenvolvedor';
    }
  }
  return { DS_JNDI: jndi, BASE: base, DEV_CODE: devCode, DEV_NAME: devName };
}

const upperSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const oneLine = (s: string, max = 150) => s.trim().replace(/\s+/g, ' ').slice(0, max);

export const WIDGET_CODE = /^[a-z][A-Za-z0-9]{2,40}$/;
export const DATASET_NAME = /^ds[A-Z][A-Za-z0-9]{2,60}$/;
export const FORM_PREFIX = /^[a-z][a-z0-9]{1,5}$/;

/** Variáveis do modelo de widget (também usadas pelo modelo de dataset que o acompanha). */
export function widgetVars(code: string, opts: { ns?: string; titulo?: string; objetivo?: string } = {}): ScaffoldVars {
  const titulo = (opts.titulo || titleFromCode(code)).trim();
  const objetivo = oneLine(opts.objetivo || titulo);
  return {
    CODE: code,
    NS: (opts.ns || namespaceFromCode(code)).trim(),
    TITULO: titulo,
    DESCRICAO: `${titulo} DELP - ${objetivo}`,
    // application.info e lido em ISO-8859-1: titulo e descricao vao sem acento.
    TITULO_ASCII: asciiTitle(titulo),
    DESCRICAO_ASCII: asciiTitle(objetivo),
    DATA: today(),
    DATASET: `ds${code.charAt(0).toUpperCase()}${code.slice(1)}`,
    TABELA: `Z_DELP_${upperSnake(code)}`,
  };
}

export function datasetVars(name: string, descricao = ''): ScaffoldVars {
  const base = name.slice(2);
  return {
    DATASET: name,
    TABELA: `Z_DELP_${upperSnake(base)}`,
    DATA: today(),
    TITULO: titleFromCode(base.charAt(0).toLowerCase() + base.slice(1)),
    DESCRICAO: oneLine(descricao || `dataset ${name}`),
  };
}

export function defaultFormPrefix(form: string): string {
  const initials = form.replace(/[^A-Z]/g, '').toLowerCase();
  return (form.charAt(0) + initials).slice(0, 4).padEnd(2, form.charAt(1) || 'x');
}

export function formVars(titulo: string, px?: string): ScaffoldVars {
  const form = camelFromTitle(titulo) || 'formulario';
  const prefix = (px || defaultFormPrefix(form)).trim();
  return {
    FORM_FOLDER: `000000 - ${asciiTitle(titulo)}`,
    FORM: form,
    PX: prefix,
    PX_UPPER: prefix.toUpperCase(),
    TITULO: titulo.trim(),
    DATA: today(),
  };
}

/**
 * Executa um pedido "@gerar" do agente: "widget <code> [ns]", "dataset <dsNome>" ou
 * "formulario <prefixo> <Título...>". Devolve um resumo para o agente (nunca sobrescreve).
 */
export async function runGenerate(extensionUri: vscode.Uri, root: vscode.Uri, spec: string): Promise<{ ok: boolean; summary: string }> {
  const [kindRaw, ...args] = spec.trim().split(/\s+/);
  const kind = (kindRaw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const list = (title: string, res: ScaffoldResult) =>
    `${title}: ${res.created.length} arquivo(s) criados${res.created.length ? `:\n${res.created.map((f) => `- ${f}`).join('\n')}` : ''}` +
    (res.skipped.length ? `\nJá existiam (não alterados): ${res.skipped.join(', ')}` : '');

  if (kind === 'widget') {
    const code = args[0] || '';
    if (!WIDGET_CODE.test(code)) {
      return { ok: false, summary: `@gerar widget: código inválido "${code}" (use camelCase, ex.: painelObras).` };
    }
    if (await exists(vscode.Uri.joinPath(root, 'wcm', 'widget', code))) {
      return { ok: false, summary: `@gerar widget: wcm/widget/${code} já existe; edite os arquivos existentes em vez de gerar.` };
    }
    const ns = args[1] && FORM_PREFIX.test(args[1]) ? args[1] : undefined;
    const vars = { ...widgetVars(code, { ns }), ...(await projectDefaults()) };
    const w = await scaffold(extensionUri, 'widget', root, vars);
    const d = await scaffold(extensionUri, 'dataset', root, vars);
    return {
      ok: true,
      summary: list(`Widget ${code} (namespace ${vars.NS}, dataset ${vars.DATASET})`, {
        created: [...w.created, ...d.created],
        skipped: [...w.skipped, ...d.skipped],
      }),
    };
  }
  if (kind === 'dataset') {
    const name = args[0] || '';
    if (!DATASET_NAME.test(name)) {
      return { ok: false, summary: `@gerar dataset: nome inválido "${name}" (use ds + PascalCase, ex.: dsObrasMedicao).` };
    }
    return { ok: true, summary: list(`Dataset ${name}`, await scaffold(extensionUri, 'dataset', root, { ...datasetVars(name), ...(await projectDefaults()) })) };
  }
  if (kind === 'formulario' || kind === 'form') {
    const px = args[0] && FORM_PREFIX.test(args[0]) ? args[0] : undefined;
    const titulo = (px ? args.slice(1) : args).join(' ').trim();
    if (!titulo) {
      return { ok: false, summary: '@gerar formulario: informe o título, ex.: "@gerar: formulario sv Solicitação de Viagem".' };
    }
    const vars = formVars(titulo, px);
    if (await exists(vscode.Uri.joinPath(root, 'forms', vars.FORM_FOLDER))) {
      return { ok: false, summary: `@gerar formulario: forms/${vars.FORM_FOLDER} já existe.` };
    }
    return { ok: true, summary: list(`Formulário ${titulo} (prefixo ${vars.PX})`, await scaffold(extensionUri, 'form', root, vars)) };
  }
  return { ok: false, summary: `@gerar: tipo desconhecido "${kindRaw}". Use widget, dataset ou formulario.` };
}
