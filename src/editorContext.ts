import * as vscode from 'vscode';
import { EditTarget } from './apply';
import { ContextItem } from './providers';

export interface EditorContext {
  item: ContextItem;
  target: EditTarget;
  hasSelection: boolean;
}

/**
 * Coleta o contexto do editor: a seleção, se houver; caso contrário, o arquivo inteiro.
 * `markCursor` insere <<CURSOR>> na posição do cursor (usado para gerar código).
 */
export function editorContext(editor: vscode.TextEditor, range?: vscode.Range, markCursor = false): EditorContext {
  const doc = editor.document;
  const selection = range ?? editor.selection;
  const hasSelection = !selection.isEmpty;
  const file = vscode.workspace.asRelativePath(doc.uri, false);

  let text: string;
  let label: string;
  if (hasSelection && !markCursor) {
    text = doc.getText(selection);
    label = `Trecho de ${file} (linhas ${selection.start.line + 1}–${selection.end.line + 1})`;
  } else {
    const full = doc.getText();
    if (markCursor) {
      const start = doc.offsetAt(selection.start);
      const end = doc.offsetAt(selection.end);
      text = `${full.slice(0, start)}<<CURSOR>>${full.slice(end)}`;
      label = `Arquivo ${file} (cursor na linha ${selection.start.line + 1})`;
    } else {
      text = full;
      label = `Arquivo ${file}`;
    }
  }

  // Sem seleção, uma sugestão substitui o arquivo inteiro; ao gerar código, entra no cursor.
  const targetRange =
    hasSelection || markCursor ? selection : new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));

  return {
    item: { label, text, language: doc.languageId },
    target: { uri: doc.uri, range: targetRange, version: doc.version },
    hasSelection,
  };
}

// Pastas geradas/dependências e arquivos sensíveis ficam fora da visão do projeto.
const PROJECT_EXCLUDE =
  '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**,**/bin/**,**/obj/**,**/target/**,' +
  '**/.venv/**,**/venv/**,**/__pycache__/**,**/.next/**,**/coverage/**,**/*.vsix,**/.env,**/.env.*,**/*.pem,**/*.key}';
const KEY_FILES =
  '{README*,readme*,package.json,requirements.txt,pyproject.toml,pom.xml,build.gradle,go.mod,Cargo.toml,*.csproj,*.sln,composer.json,Gemfile}';

/** Estrutura de arquivos do workspace + arquivos-chave (README, manifesto de dependências...). */
export async function projectContext(maxFiles = 400): Promise<ContextItem[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), PROJECT_EXCLUDE, maxFiles);
  const tree = files.map((f) => vscode.workspace.asRelativePath(f, false)).sort();
  const items: ContextItem[] = [
    {
      label: `Estrutura do projeto ${folder.name} (${tree.length}${tree.length >= maxFiles ? '+' : ''} arquivos)`,
      text: tree.join('\n'),
    },
  ];

  const keyFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, KEY_FILES), PROJECT_EXCLUDE, 6);
  for (const uri of keyFiles) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      items.push({ label: `Arquivo ${vscode.workspace.asRelativePath(uri, false)}`, text: doc.getText(), language: doc.languageId });
    } catch {
      // ilegível: ignora
    }
  }
  return items;
}

/** Diagnósticos (erros/avisos) que tocam o intervalo, formatados para o prompt. */
export function diagnosticsText(doc: vscode.TextDocument, range: vscode.Range): string {
  const diags = vscode.languages
    .getDiagnostics(doc.uri)
    .filter((d) => (range.isEmpty ? true : d.range.intersection(range) !== undefined))
    .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
  if (!diags.length) {
    return '';
  }
  const severity = ['Erro', 'Aviso', 'Info', 'Dica'];
  return diags
    .slice(0, 30)
    .map((d) => `- ${severity[d.severity]} linha ${d.range.start.line + 1}: ${d.message}${d.source ? ` (${d.source})` : ''}`)
    .join('\n');
}
