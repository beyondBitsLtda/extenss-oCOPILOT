import * as path from 'path';
import * as vscode from 'vscode';

export const PROPOSAL_SCHEME = 'delp-copilot-proposal';

/** Onde uma sugestão deve ser aplicada: o trecho que originou o pedido. */
export interface EditTarget {
  uri: vscode.Uri;
  range: vscode.Range;
  version: number;
}

/** Documentos virtuais (somente leitura) usados no lado direito do diff. */
export class ProposalStore implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? '';
  }

  set(uri: vscode.Uri, content: string): void {
    this.docs.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  delete(uri: vscode.Uri): void {
    this.docs.delete(uri.toString());
  }
}

export function targetFromEditor(editor: vscode.TextEditor): EditTarget {
  return { uri: editor.document.uri, range: editor.selection, version: editor.document.version };
}

/** Editor onde Inserir/Aplicar atuam quando o pedido não veio de um trecho específico. */
export function fallbackEditor(): vscode.TextEditor | undefined {
  return vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme !== PROPOSAL_SCHEME);
}

/** Insere o código na posição do cursor (substituindo a seleção, se houver). */
export async function insertAtCursor(code: string): Promise<void> {
  const editor = fallbackEditor();
  if (!editor) {
    vscode.window.showWarningMessage('Abra um arquivo no editor para inserir o código.');
    return;
  }
  await editor.edit((b) => editor.selections.forEach((s) => b.replace(s, code)));
}

/** Mostra o diff entre o arquivo atual e a proposta e aplica se o usuário confirmar. */
export async function applyWithDiff(store: ProposalStore, code: string, target: EditTarget | undefined): Promise<void> {
  if (!target) {
    const editor = fallbackEditor();
    if (!editor) {
      vscode.window.showWarningMessage('Abra um arquivo e selecione o trecho que deve ser substituído.');
      return;
    }
    target = targetFromEditor(editor);
  }

  const doc = await vscode.workspace.openTextDocument(target.uri);
  let range = doc.validateRange(target.range);
  if (doc.version !== target.version) {
    // O arquivo mudou desde o pedido: usa a seleção atual, se o arquivo estiver aberto.
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (editor) {
      range = editor.selection;
    }
    vscode.window.showWarningMessage('O arquivo foi alterado desde o pedido. Confira o diff com atenção antes de aplicar.');
  }

  // O pedido foi sobre o arquivo inteiro, mas a resposta é só um trecho: substitui apenas o bloco correspondente.
  const wholeDocument = range.start.line === 0 && range.end.isEqual(doc.lineAt(doc.lineCount - 1).range.end);
  if (wholeDocument && isSnippet(code, doc.lineCount)) {
    const block = locateSnippet(doc.getText(), code);
    if (!block) {
      vscode.window.showWarningMessage(
        'A sugestão é só um trecho e não encontrei onde ela se encaixa no arquivo. Selecione o trecho a substituir e clique em Aplicar de novo.'
      );
      return;
    }
    range = new vscode.Range(block.startLine, 0, block.endLine, doc.lineAt(block.endLine).text.length);
  }

  const original = doc.getText();
  const proposed = original.slice(0, doc.offsetAt(range.start)) + code + original.slice(doc.offsetAt(range.end));
  const proposalUri = vscode.Uri.from({ scheme: PROPOSAL_SCHEME, path: doc.uri.path, query: String(Date.now()) });
  store.set(proposalUri, proposed);

  const title = `${path.basename(doc.uri.fsPath || doc.uri.path)} ↔ Proposta Delp Copilot`;
  await vscode.commands.executeCommand('vscode.diff', doc.uri, proposalUri, title, { preview: true });

  const choice = await vscode.window.showInformationMessage('Aplicar a alteração proposta?', 'Aplicar', 'Descartar');
  await closeDiffTabs(proposalUri);
  store.delete(proposalUri);

  if (choice === 'Aplicar') {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, code);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(range.start, doc.positionAt(doc.offsetAt(range.start) + code.length)) });
    } else {
      vscode.window.showErrorMessage('Não foi possível aplicar a alteração.');
    }
  }
}

/** A sugestão é bem menor que o arquivo, então provavelmente é só um trecho dele. */
function isSnippet(code: string, docLineCount: number): boolean {
  return docLineCount > 10 && code.split(/\r?\n/).length < docLineCount * 0.7;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

// Linha que declara algo nomeado: function x, def x, class X, const x =, public void x( ...
const DECLARATION =
  /\b(?:function|def|class|interface|enum|type|struct|fn|func|sub|procedure|const|let|var|(?:public|private|protected|static|async|export|void|int|string|bool)\s+[\w<>[\],\s]*?)\s*([A-Za-z_$][\w$]*)\s*[(=:<{]/;

/**
 * Encontra no arquivo o bloco que corresponde ao trecho sugerido (0-based, inclusivo).
 * Procura a primeira linha do trecho (igual, ou pelo nome declarado nela) e estende
 * o bloco pela indentação até a linha de fechamento.
 */
export function locateSnippet(docText: string, code: string): { startLine: number; endLine: number } | undefined {
  const docLines = docText.split(/\r?\n/);
  const codeLines = code.split(/\r?\n/).filter((l) => l.trim());
  if (!codeLines.length) {
    return undefined;
  }
  // Âncora: a primeira declaração do trecho (pula comentários/docstrings iniciais); senão, a primeira linha.
  const anchorIdx = Math.max(0, codeLines.findIndex((l) => !isCommentLine(l) && DECLARATION.test(l)));
  const first = codeLines[anchorIdx].trim();

  let start = docLines.findIndex((l) => l.trim() === first);
  if (start < 0) {
    const name = DECLARATION.exec(first)?.[1];
    if (name) {
      const byName = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*[(=:<{]`);
      start = docLines.findIndex((l) => DECLARATION.test(l) && byName.test(l));
    }
  }
  if (start < 0) {
    return undefined;
  }

  // Estende enquanto as linhas estiverem mais indentadas; inclui a linha de fechamento (}, ), ], end).
  const baseIndent = indentOf(docLines[start]);
  let end = start;
  for (let i = start + 1; i < docLines.length; i++) {
    const line = docLines[i];
    if (!line.trim()) {
      continue;
    }
    if (indentOf(line) > baseIndent) {
      end = i;
      continue;
    }
    if (/^([)\]}]|end\b)/.test(line.trim())) {
      end = i;
    }
    break;
  }

  // O trecho traz comentários antes da declaração: substitui também os comentários que já existem acima dela.
  if (anchorIdx > 0) {
    while (start > 0 && isCommentLine(docLines[start - 1])) {
      start--;
    }
  }
  return { startLine: start, endLine: end };
}

function isCommentLine(line: string): boolean {
  return /^(\/\/|\/\*|\*|#|"""|'''|@|--|<!--)/.test(line.trim());
}

async function closeDiffTabs(proposalUri: vscode.Uri): Promise<void> {
  const tabs = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.toString() === proposalUri.toString());
  if (tabs.length) {
    await vscode.window.tabGroups.close(tabs);
  }
}
