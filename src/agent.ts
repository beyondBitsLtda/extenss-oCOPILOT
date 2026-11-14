import * as path from 'path';
import * as vscode from 'vscode';
import { fence as codeFence } from './prompts';
import { ContextItem } from './providers';
import { displayPath, findReference, ReferenceRoot, walkFiles } from './references';

// Protocolo em texto entre a extensão e o modelo (descrito ao modelo em prompts.ts):
//   @ler: caminho            → a extensão devolve o conteúdo do arquivo
//   @ler: caminho#L100-250   → só esse intervalo de linhas (arquivos grandes chegam em partes)
//   @listar: pasta           → a extensão devolve a lista de arquivos da pasta
//   @buscar: texto           → ocorrências do texto no projeto (arquivo:linha: trecho)
//   ```editar caminho        → pares <<<<<<< BUSCAR / ======= / >>>>>>> SUBSTITUIR
//   ```criar caminho         → conteúdo completo de um arquivo novo
// Caminhos absolutos só valem para leitura, dentro das referências indicadas pelo usuário (references.ts).

export const MAX_ROUNDS = 15;
const MAX_FILES_PER_ROUND = 8;
const MAX_FILE_BYTES = 2_000_000;
const MAX_SEARCH_HITS = 60;
const MAX_REFERENCE_HITS = 40;
const OUTSIDE_PROJECT =
  'fora do projeto: caminhos absolutos (como as referências indicadas pelo usuário) são somente leitura; ' +
  'aplique a alteração no arquivo correspondente do projeto, com caminho relativo';

// Nunca enviados ao modelo, mesmo que ele peça.
const SENSITIVE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|pfx|p12)|id_rsa.*|.*secret.*|.*credential.*)$/i;
const LIST_EXCLUDE = '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**,**/bin/**,**/obj/**,**/.venv/**,**/__pycache__/**}';

export interface SearchReplace {
  search: string;
  replace: string;
}

export interface FileEdit {
  path: string;
  kind: 'edit' | 'create';
  blocks: SearchReplace[];
  content: string;
}

export interface ToolCalls {
  reads: string[];
  lists: string[];
  searches: string[];
  generates: string[];
  edits: FileEdit[];
}

const READ_LINE = /^\s*[`*_]*@(ler|listar|buscar|gerar):\s*[`'"]?([^`\n]+?)[`'"]?[`*_]*\s*$/i;
// Tags de chamada de ferramenta que alguns modelos deixam vazar no texto (ex.: </parameter>).
const LEAKED_MARKUP = /^\s*<\/?(parameter|invoke|function_calls|antml:[\w-]+)\b[^>]*>\s*$/i;
const EDIT_FENCE = /^\s*(`{3,}|~{3,})\s*(editar|criar)\s+(\S+)\s*$/i;

/** Extrai pedidos de leitura (fora de blocos de código) e blocos de edição da resposta do modelo. */
export function parseToolCalls(reply: string): ToolCalls {
  const calls: ToolCalls = { reads: [], lists: [], searches: [], generates: [], edits: [] };
  const lines = reply.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      const close = new RegExp(`^\\s*\\${fence[1][0]}{${fence[1].length},}\\s*$`);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) {
        body.push(lines[j++]);
      }
      const edit = EDIT_FENCE.exec(lines[i]);
      if (edit && j < lines.length) {
        const kind = edit[2].toLowerCase() === 'criar' ? 'create' : 'edit';
        const content = body.filter((l) => !LEAKED_MARKUP.test(l)).join('\n');
        calls.edits.push({ path: cleanPath(edit[3]), kind, blocks: kind === 'edit' ? parseBlocks(content) : [], content });
      }
      i = j;
      continue;
    }
    const read = READ_LINE.exec(lines[i]);
    if (read) {
      const tool = read[1].toLowerCase();
      if (tool === 'buscar') {
        calls.searches.push(read[2].trim());
      } else if (tool === 'gerar') {
        calls.generates.push(read[2].trim());
      } else {
        (tool === 'ler' ? calls.reads : calls.lists).push(cleanPath(read[2]));
      }
    }
  }
  calls.reads = [...new Set(calls.reads)];
  calls.lists = [...new Set(calls.lists)];
  calls.searches = [...new Set(calls.searches)];
  calls.generates = [...new Set(calls.generates)];
  return calls;
}

export function parseBlocks(body: string): SearchReplace[] {
  const blocks: SearchReplace[] = [];
  const re = /^<{5,}\s*BUSCAR[^\n]*\n([\s\S]*?)^={5,}[^\n]*\n([\s\S]*?)^>{5,}\s*SUBSTITUIR[^\n]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    blocks.push({ search: m[1].replace(/\n$/, ''), replace: m[2].replace(/\n$/, '') });
  }
  return blocks;
}

function cleanPath(p: string): string {
  return p.trim().replace(/^\.?\//, '').replace(/\\/g, '/');
}

/** Resolve um caminho relativo dentro do workspace; recusa caminhos fora dele. */
export function resolveInWorkspace(relPath: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || path.isAbsolute(relPath)) {
    return undefined;
  }
  const root = folder.uri.fsPath;
  const full = path.resolve(root, relPath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    return undefined;
  }
  return vscode.Uri.file(full);
}

/** Separa "caminho#L10-20" (ou "caminho:10-20") em caminho e intervalo de linhas (1-based, inclusivo). */
export function parseRange(spec: string): { rel: string; from?: number; to?: number } {
  const m = /^(.*?)(?:#L?|:)(\d+)(?:\s*-\s*L?(\d+))?$/i.exec(spec);
  if (!m || !m[1]) {
    return { rel: spec };
  }
  const from = Number(m[2]);
  return { rel: m[1], from, to: m[3] ? Number(m[3]) : from };
}

/**
 * Recorta o arquivo para caber no orçamento de caracteres. Se não couber inteiro,
 * devolve as primeiras linhas e diz ao modelo como pedir o restante.
 */
export function sliceForModel(text: string, rel: string, budget: number, from?: number, to?: number): { label: string; text: string } {
  const lines = text.split(/\r?\n/);
  const total = lines.length;
  let start = from ? Math.max(1, from) : 1;
  const end = Math.min(total, to ?? total);
  if (start > end) {
    start = end;
  }
  let out = '';
  let last = start - 1;
  for (let i = start; i <= end; i++) {
    const next = (out ? '\n' : '') + lines[i - 1];
    if (out.length + next.length > budget && last >= start) {
      break;
    }
    out += next;
    last = i;
  }
  const whole = start === 1 && last === total;
  if (whole) {
    return { label: `Conteúdo completo de ${rel} (${total} linhas)`, text: out };
  }
  const more =
    last < end
      ? ` Faltam as linhas ${last + 1}–${end}: peça com \`@ler: ${rel}#L${last + 1}-${Math.min(end, last + 600)}\` (ou use @buscar para achar o ponto exato).`
      : '';
  return { label: `${rel}, linhas ${start}–${last} de ${total} (parcial).${more}`, text: out };
}

/** Caminho absoluto pedido pelo modelo que cai dentro de uma referência somente leitura. */
function referenceTarget(rel: string, refs: ReferenceRoot[]): { full: string; ref: ReferenceRoot } | undefined {
  // cleanPath tira a barra inicial; no Linux/macOS o caminho absoluto da referência começa com "/".
  const candidates = path.isAbsolute(rel) ? [rel] : process.platform === 'win32' || !refs.length ? [] : [`/${rel}`];
  for (const c of candidates) {
    const full = path.resolve(c);
    const ref = findReference(full, refs);
    if (ref) {
      return { full, ref };
    }
  }
  return undefined;
}

/** Caminho usado no filtro de sensíveis: relativo à referência, para o nome das pastas acima não contar. */
function referenceKey(full: string, ref: ReferenceRoot): string {
  return ref.isFile ? path.basename(full) : displayPath(path.relative(ref.path, full));
}

/**
 * Texto de um arquivo para o modelo. Do projeto, pelo documento (inclui o que não foi salvo no editor);
 * de referência, direto do disco, sem abrir documento (não aciona os serviços de linguagem).
 */
async function readText(uri: vscode.Uri, external: boolean): Promise<{ text: string; language?: string }> {
  if (!external) {
    const doc = await vscode.workspace.openTextDocument(uri);
    return { text: doc.getText(), language: doc.languageId };
  }
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  if (text.includes('\u0000')) {
    throw new Error('binário');
  }
  return { text, language: path.extname(uri.fsPath).slice(1).toLowerCase() || undefined };
}

/** Lê os arquivos e pastas pedidos pelo modelo e devolve como contexto da próxima mensagem. */
export async function fulfillReads(
  calls: ToolCalls,
  budget = 38_000,
  refs: ReferenceRoot[] = []
): Promise<{ items: ContextItem[]; summary: string[] }> {
  const items: ContextItem[] = [];
  const summary: string[] = [];
  const problems: string[] = [];
  // Total por rodada: o que não couber fica para a próxima, para a mensagem não ficar grande demais.
  const roundBudget = budget * 3;
  let used = 0;

  for (const spec of calls.reads.slice(0, MAX_FILES_PER_ROUND)) {
    const { rel, from, to } = parseRange(spec);
    const external = referenceTarget(rel, refs);
    const uri = external ? vscode.Uri.file(external.full) : resolveInWorkspace(rel);
    if (!uri) {
      problems.push(`${rel}: ${path.isAbsolute(rel) ? 'fora do projeto e das referências indicadas pelo usuário' : 'fora do projeto'}`);
      continue;
    }
    if (SENSITIVE.test(external ? referenceKey(external.full, external.ref) : rel)) {
      problems.push(`${rel}: arquivo sensível, não enviado`);
      continue;
    }
    const shown = external ? displayPath(external.full) : rel;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        calls.lists.push(rel);
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) {
        problems.push(`${rel}: maior que ${MAX_FILE_BYTES / 1000} KB`);
        continue;
      }
      const file = await readText(uri, !!external);
      const part = sliceForModel(file.text, shown, budget, from, to);
      if (used + part.text.length > roundBudget && items.length) {
        problems.push(`${spec}: adiado por tamanho da rodada; peça novamente`);
        continue;
      }
      used += part.text.length;
      items.push({ label: external ? `${part.label} — referência somente leitura` : part.label, text: part.text, language: file.language });
      summary.push(from ? `${shown}#L${from}-${to}` : shown);
    } catch {
      problems.push(`${rel}: não encontrado ou não é texto`);
    }
  }
  if (calls.reads.length > MAX_FILES_PER_ROUND) {
    problems.push(`limite de ${MAX_FILES_PER_ROUND} arquivos por vez; peça os demais na próxima resposta`);
  }

  for (const rel of [...new Set(calls.lists)].slice(0, 4)) {
    const external = referenceTarget(rel, refs);
    if (external) {
      const shown = displayPath(external.full);
      const { files, truncated } = await walkFiles(external.full);
      items.push({
        label: `Arquivos em ${shown} (referência somente leitura, caminhos relativos a essa pasta; ${files.length}${truncated ? '+' : ''})`,
        text: files.join('\n') || '(pasta vazia, inexistente ou é um arquivo — use @ler)',
      });
      summary.push(`${shown}/`);
      continue;
    }
    const uri = resolveInWorkspace(rel || '.');
    if (!uri) {
      problems.push(`${rel}: ${path.isAbsolute(rel) ? 'fora do projeto e das referências indicadas pelo usuário' : 'fora do projeto'}`);
      continue;
    }
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'), LIST_EXCLUDE, 300);
    const list = files.map((f) => vscode.workspace.asRelativePath(f, false)).sort();
    items.push({ label: `Arquivos em ${rel || '.'} (${list.length})`, text: list.join('\n') || '(pasta vazia ou inexistente)' });
    summary.push(`${rel || '.'}/`);
  }

  for (const term of calls.searches.slice(0, 4)) {
    items.push({ label: `Resultado de @buscar: ${term}`, text: await searchWorkspace(term) });
    if (refs.length) {
      items.push({ label: `Resultado de @buscar: ${term} — referências somente leitura`, text: await searchReferences(term, refs) });
    }
    summary.push(`🔎 ${term}`);
  }

  if (problems.length) {
    items.push({ label: 'Pedidos não atendidos', text: problems.map((p) => `- ${p}`).join('\n') });
  }
  return { items, summary };
}

interface SearchFile {
  uri: vscode.Uri;
  /** Como aparece no resultado (e como o modelo deve pedir com @ler). */
  shown: string;
  /** Caminho testado no filtro de sensíveis. */
  key: string;
}

/** Ocorrências (sem diferenciar maiúsculas) do termo nos arquivos de texto, no formato arquivo:linha: trecho. */
async function grep(files: SearchFile[], term: string, max: number): Promise<string> {
  const needle = term.toLowerCase();
  const hits: string[] = [];
  for (const f of files) {
    if (SENSITIVE.test(f.key) || /\.(png|jpe?g|gif|ico|pdf|zip|exe|dll|woff2?|ttf|mp4|lock)$/i.test(f.key)) {
      continue;
    }
    try {
      const stat = await vscode.workspace.fs.stat(f.uri);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(f.uri));
      if (text.includes('\u0000') || !text.toLowerCase().includes(needle)) {
        continue;
      }
      text.split(/\r?\n/).forEach((line, i) => {
        if (hits.length < max && line.toLowerCase().includes(needle)) {
          hits.push(`${f.shown}:${i + 1}: ${line.trim().slice(0, 200)}`);
        }
      });
    } catch {
      // ilegível
    }
    if (hits.length >= max) {
      hits.push(`(limite de ${max} ocorrências; refine a busca)`);
      break;
    }
  }
  return hits.join('\n') || '(nenhuma ocorrência)';
}

/** Busca textual simples (sem diferenciar maiúsculas) nos arquivos de texto do projeto. */
export async function searchWorkspace(term: string): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || !term) {
    return '(sem projeto aberto)';
  }
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), LIST_EXCLUDE, 1500);
  return grep(
    files.map((uri) => {
      const rel = vscode.workspace.asRelativePath(uri, false);
      return { uri, shown: rel, key: rel };
    }),
    term,
    MAX_SEARCH_HITS
  );
}

/** A mesma busca nas referências somente leitura; os resultados trazem o caminho absoluto. */
export async function searchReferences(term: string, refs: ReferenceRoot[]): Promise<string> {
  const files: SearchFile[] = [];
  for (const ref of refs) {
    if (ref.isFile) {
      files.push({ uri: vscode.Uri.file(ref.path), shown: displayPath(ref.path), key: path.basename(ref.path) });
      continue;
    }
    for (const rel of (await walkFiles(ref.path, 1500)).files) {
      files.push({ uri: vscode.Uri.file(path.join(ref.path, rel)), shown: `${displayPath(ref.path)}/${rel}`, key: rel });
    }
  }
  return grep(files, term, MAX_REFERENCE_HITS);
}

/** Apresenta ao agente uma referência recém-liberada: regras de uso + estrutura (pasta) ou conteúdo (arquivo). */
export async function referenceItem(ref: ReferenceRoot, budget: number): Promise<{ item: ContextItem; detail: string }> {
  const shown = displayPath(ref.path);
  const rules = [
    `O usuário indicou ${ref.isFile ? 'este arquivo' : 'esta pasta'} como REFERÊNCIA SOMENTE LEITURA, fora do projeto: use para entender e seguir o padrão ou o recurso pedido.`,
    ref.isFile
      ? `- Reler: \`@ler: ${shown}\` (aceita #L10-80). @buscar também procura aqui.`
      : `- Ler: \`@ler: ${shown}/<caminho abaixo>\` (aceita #L10-80); listar subpasta: \`@listar: ${shown}/<subpasta>\`. @buscar também procura aqui.`,
    '- NUNCA use blocos editar/criar com estes caminhos: a referência não pode ser alterada. Aplique o padrão nos arquivos do projeto aberto (caminhos relativos).',
  ].join('\n');
  const item = { label: `Referência somente leitura: ${shown}`, text: rules, language: 'markdown' };
  if (!ref.isFile) {
    const { files, truncated } = await walkFiles(ref.path);
    const count = `${files.length}${truncated ? '+' : ''}`;
    item.text += `\n\nArquivos (caminhos relativos a ${shown}; ${count}):\n${files.join('\n') || '(pasta vazia)'}`;
    return { item, detail: `pasta · ${count} arquivo(s)` };
  }
  if (SENSITIVE.test(path.basename(ref.path))) {
    item.text += '\n\n(arquivo sensível: conteúdo não enviado)';
    return { item, detail: 'arquivo sensível, conteúdo não enviado' };
  }
  try {
    const file = await readText(vscode.Uri.file(ref.path), true);
    const part = sliceForModel(file.text, shown, budget);
    item.text += `\n\n${part.label}:\n${codeFence(part.text, file.language)}`;
    return { item, detail: 'arquivo' };
  } catch {
    item.text += '\n\n(arquivo binário ou ilegível)';
    return { item, detail: 'arquivo binário ou ilegível' };
  }
}

/** Lembrete curto, nas mensagens seguintes, de quais referências estão liberadas. */
export function referencesReminder(refs: ReferenceRoot[]): ContextItem {
  return {
    label: 'Referências somente leitura',
    text:
      refs.map((r) => `- ${displayPath(r.path)} (${r.isFile ? 'arquivo' : 'pasta'})`).join('\n') +
      '\nConsulte com @ler/@listar/@buscar usando o caminho absoluto; nunca altere esses caminhos — aplique o padrão no projeto.',
  };
}

export interface EditProblem {
  path: string;
  message: string;
  /** match = BUSCAR nao encontrado; validation = conteudo final reprovado na validacao. */
  kind?: 'match' | 'validation';
}

/**
 * Aplica, em sequência, os blocos de um arquivo sobre o texto (em LF). Cada bloco vê o
 * resultado do anterior, então repetições e versões sucessivas do mesmo trecho não se
 * sobrepõem; um bloco cujo resultado já está no texto é tratado como já aplicado.
 */
export function applyBlocksToText(
  text: string | undefined,
  fileEdits: FileEdit[]
): { text: string | undefined; applied: number; problems: string[] } {
  let current = text;
  let applied = 0;
  const problems: string[] = [];
  for (const fe of fileEdits) {
    if (fe.kind === 'create') {
      current = fe.content.endsWith('\n') ? fe.content : `${fe.content}\n`;
      applied++;
      continue;
    }
    if (current === undefined) {
      problems.push('arquivo não existe (use um bloco "criar")');
      continue;
    }
    if (!fe.blocks.length) {
      problems.push('bloco de edição sem pares BUSCAR/SUBSTITUIR');
      continue;
    }
    fe.blocks.forEach((b, n) => {
      const match = findMatch(current!, b.search);
      if (match) {
        current = current!.slice(0, match.start) + b.replace + current!.slice(match.end);
        applied++;
      } else if (!(b.replace.trim() && findMatch(current!, b.replace))) {
        const preview = b.search.split('\n').find((l) => l.trim())?.trim().slice(0, 80) ?? '';
        problems.push(`trecho BUSCAR ${n + 1} não encontrado (começa com: "${preview}")`);
      }
    });
  }
  return { text: current, applied, problems };
}

/**
 * Monta um WorkspaceEdit com todas as edições (uma substituição por arquivo, calculada em
 * sequência). Com confirm, o VS Code abre a pré-visualização de refatoração para revisão.
 */
export async function buildEdits(
  edits: FileEdit[],
  confirm = true
): Promise<{ edit: vscode.WorkspaceEdit; problems: EditProblem[]; changes: number; files: string[]; results: { path: string; text: string }[] }> {
  const edit = new vscode.WorkspaceEdit();
  const problems: EditProblem[] = [];
  const files: string[] = [];
  const results: { path: string; text: string }[] = [];
  let changes = 0;

  const byPath = new Map<string, FileEdit[]>();
  for (const fe of edits) {
    byPath.set(fe.path, [...(byPath.get(fe.path) ?? []), fe]);
  }

  for (const [rel, fileEdits] of byPath) {
    const uri = resolveInWorkspace(rel);
    if (!uri) {
      problems.push({ path: rel, message: path.isAbsolute(rel) ? OUTSIDE_PROJECT : 'fora do projeto' });
      continue;
    }
    let doc: vscode.TextDocument | undefined;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      doc = undefined; // ainda não existe
    }
    const original = doc?.getText().replace(/\r\n/g, '\n');
    const result = applyBlocksToText(original, fileEdits);
    problems.push(...result.problems.map((message) => ({ path: rel, message, kind: 'match' as const })));
    if (!result.applied || result.text === undefined || result.text === original) {
      continue;
    }
    const metadata: vscode.WorkspaceEditEntryMetadata = { needsConfirmation: confirm, label: rel, description: 'Delp Copilot' };
    if (doc) {
      edit.replace(uri, fullRange(doc), withEol(result.text, doc), metadata);
    } else {
      edit.createFile(uri, { contents: new TextEncoder().encode(result.text) }, metadata);
    }
    changes += result.applied;
    files.push(rel);
    results.push({ path: rel, text: result.text });
  }
  return { edit, problems, changes, files, results };
}

/** Conteúdo atual dos arquivos que serão alterados (undefined = arquivo ainda não existe), para desfazer. */
export async function snapshotFiles(edits: FileEdit[]): Promise<{ uri: vscode.Uri; original: string | undefined }[]> {
  const result: { uri: vscode.Uri; original: string | undefined }[] = [];
  for (const fe of edits) {
    const uri = resolveInWorkspace(fe.path);
    if (!uri || result.some((r) => r.uri.toString() === uri.toString())) {
      continue;
    }
    try {
      result.push({ uri, original: (await vscode.workspace.openTextDocument(uri)).getText() });
    } catch {
      result.push({ uri, original: undefined });
    }
  }
  return result;
}

/** Restaura os arquivos ao estado capturado por snapshotFiles (apaga os que foram criados). */
export async function restoreSnapshots(snapshots: { uri: vscode.Uri; original: string | undefined }[]): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  for (const s of snapshots) {
    if (s.original === undefined) {
      edit.deleteFile(s.uri, { ignoreIfNotExists: true });
    } else {
      const doc = await vscode.workspace.openTextDocument(s.uri);
      edit.replace(s.uri, fullRange(doc), s.original);
    }
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (ok) {
    await saveAll(snapshots.filter((s) => s.original !== undefined).map((s) => s.uri));
  }
  return ok;
}

export async function saveAll(uris: vscode.Uri[]): Promise<void> {
  for (const uri of uris) {
    await vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())?.save();
  }
}

function fullRange(doc: vscode.TextDocument): vscode.Range {
  return new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
}

function withEol(text: string, doc: vscode.TextDocument): string {
  return doc.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text;
}

/**
 * Procura o trecho no texto: primeiro exato; depois linha a linha ignorando espaços nas
 * pontas (modelos às vezes erram a indentação ou espaços finais).
 */
export function findMatch(text: string, search: string): { start: number; end: number } | undefined {
  if (!search.trim()) {
    return undefined;
  }
  const exact = text.indexOf(search);
  if (exact >= 0) {
    return { start: exact, end: exact + search.length };
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const wanted = search.split(/\r?\n/).map((l) => l.trim());
  while (wanted.length && !wanted[wanted.length - 1]) {
    wanted.pop();
  }
  while (wanted.length && !wanted[0]) {
    wanted.shift();
  }
  if (!wanted.length) {
    return undefined;
  }
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + eol.length;
  }
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((w, k) => lines[i + k].trim() === w)) {
      const last = i + wanted.length - 1;
      return { start: offsets[i], end: offsets[last] + lines[last].length };
    }
  }
  return undefined;
}
