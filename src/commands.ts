import * as vscode from 'vscode';
import { AuthConfigError, signIn } from './auth';
import { ChatViewProvider } from './chatViewProvider';
import { diagnosticsText, editorContext } from './editorContext';
import { generatePrompt, TASKS } from './prompts';
import {
  camelFromTitle,
  DATASET_NAME,
  datasetVars,
  defaultFormPrefix,
  FORM_PREFIX,
  formVars,
  namespaceFromCode,
  projectDefaults,
  scaffold,
  ScaffoldResult,
  titleFromCode,
  WIDGET_CODE,
  widgetVars,
} from './scaffold';
import { activeAgent, addAgent, studioAgents } from './studioAgents';

type Task = keyof typeof TASKS;

const TASK_TITLES: Record<Task, string> = {
  explain: 'Explicar',
  refactor: 'Refatorar',
  tests: 'Gerar testes',
  document: 'Documentar',
  fix: 'Corrigir problemas',
};

function requireEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Abra um arquivo no editor primeiro.');
  }
  return editor;
}

/** Comandos de menu recebem (uri) do VS Code; a code action passa (uri, range). */
function rangeArg(args: unknown[]): vscode.Range | undefined {
  return args[1] instanceof vscode.Range ? args[1] : undefined;
}

export function registerCommands(context: vscode.ExtensionContext, chat: ChatViewProvider): void {
  const runTask = async (task: Task, args: unknown[]) => {
    const editor = requireEditor();
    if (!editor) {
      return;
    }
    const ctx = editorContext(editor, rangeArg(args));
    let prompt: string = TASKS[task];
    if (task === 'fix') {
      const diags = diagnosticsText(editor.document, ctx.target.range);
      prompt += diags
        ? `\n\nProblemas reportados pelo VS Code:\n${diags}`
        : '\n\nO VS Code não reportou erros; procure bugs de lógica, casos não tratados e más práticas.';
    }
    await chat.ask(prompt, [ctx.item], `${TASK_TITLES[task]} · ${ctx.item.label}`, ctx.target, task !== 'explain', false, { mode: 'livre' });
  };

  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('delpCopilot.openChat', () => chat.reveal());
  reg('delpCopilot.newChat', () => chat.newChat());
  reg('delpCopilot.history', () => chat.showHistory());
  reg('delpCopilot.pasteReply', () => chat.pasteReply());
  // Explorer: (uri clicada, todas as selecionadas); paleta: sem argumentos → seletor de arquivos.
  reg('delpCopilot.attachFiles', (uri, uris) =>
    chat.attach(Array.isArray(uris) ? (uris as vscode.Uri[]) : uri instanceof vscode.Uri ? [uri] : undefined)
  );
  reg('delpCopilot.explain', (...a) => runTask('explain', a));
  reg('delpCopilot.refactor', (...a) => runTask('refactor', a));
  reg('delpCopilot.generateTests', (...a) => runTask('tests', a));
  reg('delpCopilot.document', (...a) => runTask('document', a));
  reg('delpCopilot.fix', (...a) => runTask('fix', a));

  reg('delpCopilot.askSelection', async () => {
    const editor = requireEditor();
    if (!editor) {
      return;
    }
    const question = await vscode.window.showInputBox({
      title: 'Delp Copilot',
      prompt: editor.selection.isEmpty ? 'Pergunta sobre o arquivo atual' : 'Pergunta sobre o trecho selecionado',
      placeHolder: 'Ex.: por que esta função pode lançar exceção?',
    });
    if (!question) {
      return;
    }
    const ctx = editorContext(editor);
    await chat.ask(question, [ctx.item], question, ctx.target, false, false, { mode: 'livre' });
  });

  reg('delpCopilot.generate', async () => {
    const editor = requireEditor();
    if (!editor) {
      return;
    }
    const instruction = await vscode.window.showInputBox({
      title: 'Delp Copilot — gerar código no cursor',
      prompt: 'Descreva o código a gerar',
      placeHolder: 'Ex.: função que valida CNPJ e retorna boolean',
    });
    if (!instruction) {
      return;
    }
    const ctx = editorContext(editor, undefined, true);
    await chat.ask(
      generatePrompt(instruction, editor.document.languageId),
      [ctx.item],
      `Gerar código · ${instruction}`,
      ctx.target,
      true,
      false,
      { mode: 'livre' }
    );
  });

  // ---- Fluig: geram a estrutura padrão a partir dos modelos e pedem ao agente só a regra de negócio ----
  const input = (title: string, prompt: string, opts: Partial<vscode.InputBoxOptions> = {}) =>
    vscode.window.showInputBox({ title: `Delp Copilot — ${title}`, prompt, ignoreFocusOut: true, ...opts });

  const workspaceRoot = (): vscode.Uri | undefined => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage('Abra a pasta do projeto (Arquivo → Abrir Pasta) antes de gerar artefatos Fluig.');
    }
    return folder?.uri;
  };

  const pathExists = async (uri: vscode.Uri) => {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  };

  /** Mostra o que foi gerado e devolve o texto para o pedido ao agente. */
  const report = (what: string, res: ScaffoldResult): string => {
    const lines = res.created.map((f) => `- ${f}`).join('\n');
    const skipped = res.skipped.length ? `\nJá existiam (não alterados): ${res.skipped.join(', ')}.` : '';
    vscode.window.showInformationMessage(`${what}: ${res.created.length} arquivo(s) gerado(s) no padrão Delp.`);
    return `Arquivos gerados agora pelo modelo padrão da Delp:\n${lines}${skipped}`;
  };

  const AGENT_RULES =
    'A estrutura já está no padrão da equipe: NÃO recrie nem renomeie esses arquivos e não crie estruturas paralelas. ' +
    'Leia os arquivos gerados com @ler antes de editar e implemente usando blocos "editar" (ou "criar" apenas para arquivos novos que a arquitetura preveja, ' +
    'como novos módulos integre*.js / ds*.js — nesse caso declare-os no application.info na ordem correta). Siga o guia Fluig da Delp.';

  reg('delpCopilot.fluig.newWidget', async () => {
    const root = workspaceRoot();
    if (!root) {
      return;
    }
    const code = await input('novo widget Fluig (1/4)', 'Código do widget (application.code, camelCase)', {
      placeHolder: 'Ex.: painelObras',
      validateInput: (v) => (WIDGET_CODE.test(v.trim()) ? undefined : 'Use camelCase: começa com minúscula, só letras e números.'),
    });
    if (!code) {
      return;
    }
    const c = code.trim();
    const titulo = await input('novo widget Fluig (2/4)', 'Título exibido', { value: titleFromCode(c) });
    if (!titulo) {
      return;
    }
    const ns = await input('novo widget Fluig (3/4)', 'Namespace JS e prefixo CSS (curto, minúsculo)', {
      value: namespaceFromCode(c),
      validateInput: (v) => (/^[a-z][a-z0-9]{1,15}$/.test(v.trim()) ? undefined : 'Só letras minúsculas e números, até 16 caracteres.'),
    });
    if (!ns) {
      return;
    }
    const objetivo = await input('novo widget Fluig (4/4)', 'O que o widget deve fazer? (dados, telas, filtros, ações)', {
      placeHolder: 'Ex.: painel com KPIs de obras por período, a partir da tabela de obras',
    });
    if (!objetivo?.trim()) {
      return;
    }
    if (await pathExists(vscode.Uri.joinPath(root, 'wcm', 'widget', c))) {
      vscode.window.showErrorMessage(`Já existe wcm/widget/${c} neste projeto. Escolha outro código.`);
      return;
    }
    const vars = { ...widgetVars(c, { ns: ns.trim(), titulo: titulo.trim(), objetivo: objetivo.trim() }), ...(await projectDefaults()) };
    const dataset = vars.DATASET;
    const widget = await scaffold(context.extensionUri, 'widget', root, vars);
    const ds = await scaffold(context.extensionUri, 'dataset', root, vars);
    const merged = { created: [...widget.created, ...ds.created], skipped: [...widget.skipped, ...ds.skipped] };
    const gerado = report(`Widget ${c}`, merged);
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(root, 'wcm', 'widget', c, 'src', 'main', 'resources', 'view.ftl'),
      { preview: true }
    );
    await chat.ask(
      `${gerado}\n\nObjetivo do widget "${c}": ${objetivo.trim()}\n\n${AGENT_RULES} ` +
        `O dataset servidor é ${dataset} (datasets/${dataset}.js, tabela ${vars.BASE}.dbo.${vars.TABELA}, datasource ${vars.DS_JNDI}); ajuste colunas, ações _ACAO e SQL conforme o objetivo, mantendo o contrato.`,
      [],
      `Novo widget Fluig · ${c}`,
      undefined,
      true,
      true
    );
  });

  reg('delpCopilot.fluig.newForm', async () => {
    const root = workspaceRoot();
    if (!root) {
      return;
    }
    const titulo = await input('novo formulário Fluig (1/3)', 'Título do formulário', { placeHolder: 'Ex.: Solicitação de Viagem' });
    if (!titulo?.trim()) {
      return;
    }
    const form = camelFromTitle(titulo) || 'formulario';
    const px = await input('novo formulário Fluig (2/3)', 'Prefixo curto (namespace JS e CSS)', {
      value: defaultFormPrefix(form),
      validateInput: (v) => (FORM_PREFIX.test(v.trim()) ? undefined : '2 a 6 letras minúsculas/números.'),
    });
    if (!px) {
      return;
    }
    const req = await input('novo formulário Fluig (3/3)', 'Campos, seções, pai-filho, zooms, atividades e validações', {
      placeHolder: 'Ex.: solicitante, destino, datas; itens de despesa (pai-filho); atividades 5 Solicitar, 10 Aprovar gestor',
    });
    if (!req?.trim()) {
      return;
    }
    const vars = formVars(titulo, px.trim());
    const folder = vars.FORM_FOLDER;
    if (await pathExists(vscode.Uri.joinPath(root, 'forms', folder))) {
      vscode.window.showErrorMessage(`Já existe forms/${folder}.`);
      return;
    }
    const res = await scaffold(context.extensionUri, 'form', root, vars);
    const gerado = report(`Formulário ${titulo.trim()}`, res);
    await chat.ask(
      `${gerado}\n\nRequisitos do formulário "${titulo.trim()}": ${req.trim()}\n\n${AGENT_RULES} ` +
        'Implemente os campos, seções, pai-filho, zooms, regras por atividade e validações; se houver processo, crie os scripts de workflow em workflow/scripts/<processId>.<evento>.js. ' +
        'A pasta usa "000000" porque o documentId só existe depois de publicar: avise o usuário para renomear após a publicação.',
      [],
      `Novo formulário Fluig · ${titulo.trim()}`,
      undefined,
      true,
      true
    );
  });

  reg('delpCopilot.fluig.newDataset', async () => {
    const root = workspaceRoot();
    if (!root) {
      return;
    }
    const name = await input('novo dataset Fluig (1/2)', 'Nome do dataset', {
      placeHolder: 'Ex.: dsObrasMedicao',
      validateInput: (v) => (DATASET_NAME.test(v.trim()) ? undefined : 'Use ds + PascalCase, ex.: dsObrasMedicao.'),
    });
    if (!name) {
      return;
    }
    const n = name.trim();
    const req = await input('novo dataset Fluig (2/2)', 'Origem dos dados, colunas, filtros e ações', {
      placeHolder: 'Ex.: tabela própria de medições; listar por obra e período; salvar e excluir lógico',
    });
    if (!req?.trim()) {
      return;
    }
    if (await pathExists(vscode.Uri.joinPath(root, 'datasets', `${n}.js`))) {
      vscode.window.showErrorMessage(`Já existe datasets/${n}.js.`);
      return;
    }
    const vars = { ...datasetVars(n, req.trim()), ...(await projectDefaults()) };
    const res = await scaffold(context.extensionUri, 'dataset', root, vars);
    const gerado = report(`Dataset ${n}`, res);
    await vscode.window.showTextDocument(vscode.Uri.joinPath(root, 'datasets', `${n}.js`), { preview: true });
    await chat.ask(
      `${gerado}\n\nRequisitos do dataset "${n}": ${req.trim()}\n\n${AGENT_RULES} ` +
        'Ajuste colunas (COLS_*), ações _ACAO, SQL (sempre PreparedStatement) e o script SQL de criação da tabela; mostre um exemplo de consumo no front (camada ds*.js).',
      [],
      `Novo dataset Fluig · ${n}`,
      undefined,
      true,
      true
    );
  });

  reg('delpCopilot.switchModel', async () => {
    const add = '$(add) Adicionar modelo...';
    const current = activeAgent()?.label;
    const pick = await vscode.window.showQuickPick(
      [...studioAgents().map((a) => ({ label: a.label, description: a.label === current ? 'ativo' : undefined })), { label: add }],
      { title: 'Delp Copilot — trocar modelo', placeHolder: 'Cada modelo é um agente publicado no Copilot Studio' }
    );
    if (!pick) {
      return;
    }
    if (pick.label === add) {
      await vscode.commands.executeCommand('delpCopilot.addModel');
    } else {
      await chat.selectModel(pick.label);
    }
  });

  reg('delpCopilot.addModel', async () => {
    const label = await vscode.window.showInputBox({
      title: 'Delp Copilot — adicionar modelo (1/2)',
      prompt: 'Nome que aparece no seletor (normalmente o modelo do agente)',
      placeHolder: 'Ex.: GPT-5',
    });
    if (!label?.trim()) {
      return;
    }
    const schema = await vscode.window.showInputBox({
      title: 'Delp Copilot — adicionar modelo (2/2)',
      prompt: 'Nome do esquema do agente (Copilot Studio → Configurações → Avançado → Metadados) ou a cadeia de conexão completa',
      placeHolder: 'Ex.: cr5d2_DelpCopilotGpt5',
    });
    if (!schema?.trim()) {
      return;
    }
    try {
      const agent = await addAgent(label, schema);
      await chat.selectModel(agent.label);
      vscode.window.showInformationMessage(`Modelo "${agent.label}" adicionado e selecionado. Confirme que o agente está publicado no Copilot Studio.`);
    } catch (err) {
      vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
    }
  });

  reg('delpCopilot.showUsage', async () => {
    const limit = 'Definir limite diário';
    const reset = 'Zerar contadores';
    const choice = await vscode.window.showInformationMessage(
      'Delp Copilot — consumo estimado',
      { modal: true, detail: chat.usage.detailText },
      limit,
      reset
    );
    if (choice === limit) {
      const value = await vscode.window.showInputBox({
        title: 'Limite diário de tokens (estimado)',
        prompt: 'Ao atingir, a extensão pede confirmação antes de enviar. 0 = sem limite.',
        value: String(chat.usage.dailyLimit),
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'Informe um número inteiro.'),
      });
      if (value !== undefined) {
        await vscode.workspace
          .getConfiguration('delpCopilot')
          .update('usage.dailyTokenLimit', Number(value.trim()), vscode.ConfigurationTarget.Global);
      }
    } else if (choice === reset) {
      await chat.usage.resetAll();
    }
  });

  reg('delpCopilot.signIn', async () => {
    try {
      const account = await signIn();
      vscode.window.showInformationMessage(`Delp Copilot conectado como ${account}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const action = err instanceof AuthConfigError ? 'Abrir configurações' : undefined;
      const choice = await vscode.window.showErrorMessage(message, ...(action ? [action] : []));
      if (choice === action) {
        vscode.commands.executeCommand('workbench.action.openSettings', 'delpCopilot.auth');
      }
    }
  });
}

/** Lâmpada "Corrigir com Delp Copilot" nos erros e avisos do editor. */
export class FixCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const diags = ctx.diagnostics.filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
    if (!diags.length) {
      return [];
    }
    // Envia as linhas completas afetadas, para a sugestão substituir um trecho coerente.
    const first = Math.min(...diags.map((d) => d.range.start.line));
    const last = Math.max(...diags.map((d) => d.range.end.line));
    const range = new vscode.Range(first, 0, last, doc.lineAt(last).text.length);

    const action = new vscode.CodeAction('Corrigir com Delp Copilot', vscode.CodeActionKind.QuickFix);
    action.command = { command: 'delpCopilot.fix', title: 'Corrigir com Delp Copilot', arguments: [doc.uri, range] };
    action.diagnostics = diags;
    return [action];
  }
}
