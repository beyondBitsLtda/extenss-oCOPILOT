import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Referências somente leitura: caminhos fora do projeto que o usuário cita na própria mensagem
 * ("siga o padrão de C:\Projetos\outra-app") para o agente consultar — nunca alterar.
 * Não há botão: a extensão detecta o caminho no texto e libera a leitura na conversa.
 */

export interface ReferenceRoot {
  /** Caminho absoluto normalizado (separadores do sistema). */
  path: string;
  isFile: boolean;
}

export const MAX_REFERENCES = 5;
// Caminho com espaços e sem aspas: tenta até 8 palavras, do mais longo ao mais curto.
const MAX_WORDS = 8;
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'out', 'dist', 'build', 'bin', 'obj', 'target',
  '.venv', 'venv', '__pycache__', '.next', 'coverage', '.idea', '.vs',
]);
const QUOTES = '"\'`';
const TRAILING = /[.,;:!?)\]}>"'`]+$/;
const CASELESS = process.platform === 'win32';

/** Barras normais, como o agente deve escrever o caminho (C:/Projetos/app). */
export function displayPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function key(p: string): string {
  const full = path.resolve(p);
  return CASELESS ? full.toLowerCase() : full;
}

export function samePath(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** child é parent ou está dentro dele. */
export function isInside(child: string, parent: string): boolean {
  const c = key(child);
  const p = key(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/** Referência que dá acesso ao caminho absoluto (arquivo: só ele; pasta: tudo abaixo). */
export function findReference(target: string, refs: ReferenceRoot[]): ReferenceRoot | undefined {
  return refs.find((r) => (r.isFile ? samePath(target, r.path) : isInside(target, r.path)));
}

/**
 * Caminhos absolutos citados no texto (fora de blocos de código). Cada menção vira uma lista
 * de candidatos, do mais longo ao mais curto, porque caminhos do Windows costumam ter espaços.
 */
export function pathMentions(text: string, platform: string = process.platform): string[][] {
  const prose = text.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, ' ');
  const start =
    platform === 'win32'
      ? /(^|[\s"'`(\[<{,;=])([A-Za-z]:[\\/]|\\\\[^\\/\s"'`]+[\\/])/g
      : /(^|[\s"'`(\[<{,;=])([A-Za-z]:[\\/]|\\\\[^\\/\s"'`]+[\\/]|~?\/(?=[^\s/]))/g;
  const mentions: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = start.exec(prose))) {
    const begin = m.index + m[1].length;
    const rest = prose.slice(begin).split('\n')[0];
    const quote = m[1] && QUOTES.includes(m[1]) ? m[1] : '';
    const close = quote ? rest.indexOf(quote) : -1;
    let candidates: string[];
    if (close > 0) {
      candidates = [rest.slice(0, close).trim()];
    } else {
      const words = rest.split(' ');
      candidates = [];
      for (let n = Math.min(words.length, MAX_WORDS); n >= 1; n--) {
        candidates.push(words.slice(0, n).join(' ').trim().replace(TRAILING, ''));
      }
    }
    candidates = [...new Set(candidates.filter((c) => c.length >= 3))];
    if (candidates.length) {
      mentions.push(candidates);
    }
    start.lastIndex = begin + 1;
  }
  return mentions;
}

function normalize(p: string): string {
  return path.resolve(p.replace(/^~(?=[\\/])/, os.homedir()));
}

/**
 * Libera como referência os caminhos do texto que existem e estão fora do projeto.
 * Caminhos dentro do projeto são ignorados (já acessíveis); raiz de disco e pasta do usuário
 * são recusadas por serem amplas demais.
 */
export async function detectReferences(
  text: string,
  current: ReferenceRoot[],
  workspaceRoot: string | undefined
): Promise<{ added: ReferenceRoot[]; problems: string[] }> {
  const added: ReferenceRoot[] = [];
  const problems: string[] = [];
  for (const candidates of pathMentions(text)) {
    let found: ReferenceRoot | undefined;
    for (const c of candidates) {
      const full = normalize(c);
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(full));
        found = { path: full, isFile: !(stat.type & vscode.FileType.Directory) };
        break;
      } catch {
        // não existe: tenta o candidato mais curto
      }
    }
    const shortest = candidates[candidates.length - 1];
    if (!found) {
      // Só avisa quando é claramente um caminho do Windows (C:\..., \\servidor\...), não linha de stack trace.
      if (/^([A-Za-z]:[\\/]|\\\\)/.test(shortest) && !/:\d+$/.test(shortest)) {
        problems.push(`não encontrei ${shortest} (confira o caminho e se você tem acesso a ele)`);
      }
      continue;
    }
    const all = [...current, ...added];
    if ((workspaceRoot && isInside(found.path, workspaceRoot)) || findReference(found.path, all)) {
      continue;
    }
    if (path.parse(found.path).root === found.path || samePath(found.path, os.homedir())) {
      problems.push(`${found.path} é amplo demais; indique a pasta da aplicação de referência`);
      continue;
    }
    if (all.length >= MAX_REFERENCES) {
      problems.push(`${found.path}: limite de ${MAX_REFERENCES} referências por conversa`);
      continue;
    }
    added.push(found);
  }
  return { added, problems };
}

/** Arquivos da pasta (caminhos relativos com "/"), em largura, sem dependências e builds. */
export async function walkFiles(root: string, max = 300, maxDirs = 500): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue = [''];
  let dirs = 0;
  let truncated = false;
  while (queue.length && dirs < maxDirs) {
    const rel = queue.shift()!;
    dirs++;
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(rel ? path.join(root, rel) : root));
    } catch {
      continue; // sem permissão ou removida
    }
    for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const child = rel ? `${rel}/${name}` : name;
      if (type & vscode.FileType.Directory) {
        if (!SKIP_DIRS.has(name.toLowerCase())) {
          queue.push(child);
        }
      } else if (files.length < max) {
        files.push(child);
      } else {
        truncated = true;
      }
    }
    if (truncated) {
      break;
    }
  }
  return { files: files.sort(), truncated: truncated || queue.length > 0 };
}
