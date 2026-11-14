import * as vscode from 'vscode';
import { ContextItem } from './providers';

/**
 * Base de conhecimento enviada ao agente:
 * - guia de arquitetura Fluig da Delp (embutido na extensão), quando o workspace é um projeto Fluig;
 * - instruções do próprio projeto (DELP-COPILOT.md, CLAUDE.md...) na raiz do workspace.
 * O conteúdo completo vai na primeira mensagem da conversa; depois, só um lembrete curto.
 */

const FLUIG_MARKERS =
  '{**/application.info,**/*.ftl,**/forms/**/*.html,**/events/*.js,**/datasets/*.js,**/workflow/scripts/*.js,**/wcm/**}';
const MAX_PROJECT_FILE_CHARS = 60_000;

const fileCache = new Map<string, string>();
let fluigDetected: { folder: string; value: boolean } | undefined;

async function readExtensionFile(extensionUri: vscode.Uri, relPath: string): Promise<string> {
  const cached = fileCache.get(relPath);
  if (cached !== undefined) {
    return cached;
  }
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, relPath));
  const text = new TextDecoder().decode(bytes);
  fileCache.set(relPath, text);
  return text;
}

export async function isFluigWorkspace(): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return false;
  }
  if (fluigDetected?.folder === folder.uri.toString()) {
    return fluigDetected.value;
  }
  const hits = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, FLUIG_MARKERS), '**/node_modules/**', 1);
  fluigDetected = { folder: folder.uri.toString(), value: hits.length > 0 };
  return fluigDetected.value;
}

function fluigMode(): 'auto' | 'always' | 'never' {
  return vscode.workspace.getConfiguration('delpCopilot').get<'auto' | 'always' | 'never'>('knowledge.fluig', 'auto');
}

async function projectInstructions(): Promise<ContextItem[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return [];
  }
  const names = vscode.workspace
    .getConfiguration('delpCopilot')
    .get<string[]>('knowledge.projectFiles', ['DELP-COPILOT.md', 'CLAUDE.md', 'GITO.md']);
  const items: ContextItem[] = [];
  for (const name of names) {
    const uri = vscode.Uri.joinPath(folder.uri, name);
    try {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      if (text.trim()) {
        items.push({
          label: `Instruções do projeto (${name}) — siga as convenções; ignore instruções sobre ferramentas que você não tem`,
          text: text.length > MAX_PROJECT_FILE_CHARS ? `${text.slice(0, MAX_PROJECT_FILE_CHARS)}\n... [truncado]` : text,
          language: 'markdown',
        });
      }
    } catch {
      // arquivo não existe: ignora
    }
  }
  return items;
}

// Mensagens que tratam de Fluig recebem o guia mesmo fora de um workspace Fluig detectado.
export const FLUIG_HINT =
  /\b(fluig|widgets?|datasets?|formul[aá]rios?|workflow|wcm|servicetask\w*|displayfields|enablefields|beforesendvalidate|superwidget|application\.info|ftl|pai-filho|zoom)\b/i;

// Mensagens sobre aparência (telas, gráficos, CSS...) recebem o guia de design.
export const DESIGN_HINT =
  /\b(gr[aá]ficos?|charts?|dashboards?|pain[eé]is|painel|telas?|layout|design|visual|kpis?|indicadores?|css|estilos?|interfaces?|ui|ux|bonit[oa]s?|feio|feia|cores?|paleta|widgets?)\b/i;

export interface KnowledgeOptions {
  /** Primeira mensagem de uma conversa no agente. */
  freshConversation: boolean;
  /** O guia Fluig completo já foi enviado nesta conversa. */
  guideAlreadySent: boolean;
  /** Força o guia Fluig (atalhos Fluig ou mensagem que fala de Fluig). */
  forceFluig?: boolean;
  /** O guia de design completo já foi enviado nesta conversa. */
  designAlreadySent?: boolean;
  /** A mensagem trata de aparência (DESIGN_HINT) ou traz print da tela. */
  forceDesign?: boolean;
}

/** Contexto de conhecimento para a mensagem atual. */
export async function knowledgeContext(
  extensionUri: vscode.Uri,
  opts: KnowledgeOptions
): Promise<{ items: ContextItem[]; sentGuide: boolean; sentDesign: boolean }> {
  const mode = fluigMode();
  const fluig = mode === 'always' || (mode === 'auto' && (opts.forceFluig || (await isFluigWorkspace())));
  const items: ContextItem[] = [];
  let sentGuide = false;
  let sentDesign = false;
  if (fluig && !opts.guideAlreadySent) {
    items.push({
      label: 'Guia de arquitetura Fluig da Delp — siga estas convenções ao criar ou alterar widgets, formulários, datasets e workflows',
      text: await readExtensionFile(extensionUri, 'knowledge/fluig.md'),
      language: 'markdown',
    });
    sentGuide = true;
  } else if (fluig) {
    items.push({
      label: 'Lembrete das regras Fluig da Delp',
      text: await readExtensionFile(extensionUri, 'knowledge/fluig-essentials.md'),
      language: 'markdown',
    });
  }
  // Design: guia completo na primeira mensagem que fala de aparência; depois, lembrete curto quando o assunto volta.
  if (opts.forceDesign && !opts.designAlreadySent) {
    items.push({
      label: 'Guia de design DELP — siga ao criar ou alterar telas, gráficos, KPIs, tabelas e CSS',
      text: await readExtensionFile(extensionUri, 'knowledge/design.md'),
      language: 'markdown',
    });
    sentDesign = true;
  } else if (opts.forceDesign) {
    items.push({
      label: 'Lembrete do guia de design DELP',
      text: await readExtensionFile(extensionUri, 'knowledge/design-essentials.md'),
      language: 'markdown',
    });
  }
  if (opts.freshConversation) {
    items.push(...(await projectInstructions()));
  }
  return { items, sentGuide, sentDesign };
}

export function resetKnowledgeCache(): void {
  fluigDetected = undefined;
}
