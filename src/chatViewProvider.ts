import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildEdits,
  EditProblem,
  FileEdit,
  fulfillReads,
  MAX_ROUNDS,
  parseToolCalls,
  referenceItem,
  referencesReminder,
  resolveInWorkspace,
  restoreSnapshots,
  saveAll,
  sliceForModel,
  snapshotFiles,
} from './agent';
import { applyWithDiff, EditTarget, fallbackEditor, insertAtCursor, ProposalStore } from './apply';
import { editorContext, projectContext } from './editorContext';
import { ConversationStore, conversationTitle, newConversationId, StoredTurn, transcript } from './history';
import { DESIGN_HINT, FLUIG_HINT, knowledgeContext } from './knowledge';
import { parseChecklist, parsePlan, PlanStep, planToText, truncatedFence } from './planner';
import { MODE_CORRIDO, MODE_IDEIA, MODE_PLANO, PLAN_FROM_SPEC, PREAMBLE, stepPrompt } from './prompts';
import { ChatImage, ChatProvider, ChatRequest, ContextItem, CopilotWebProvider, createProvider } from './providers';
import { detectReferences, findReference, isInside, ReferenceRoot } from './references';
import { runGenerate } from './scaffold';
import { activeAgent, setActiveAgent, studioAgents } from './studioAgents';
import { UsageTracker } from './usage';
import { validateFiles } from './validate';

// Perguntas que pedem visão do projeto inteiro, não só do arquivo aberto.
const PROJECT_QUESTION = /\b(projeto|reposit[óo]rio|workspace|estrutura|arquitetura|aplica[çc][ãa]o|sistema|codebase)\b/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGE_BYTES = 4_000_000;

/** Modos de trabalho escolhidos no chat. */
export type Mode = 'corrido' | 'planejado' | 'ideacao';
/** Fase interna de uma execução: 'etapa' = execução de uma etapa do plano; 'livre' = ações do editor. */
type Phase = Mode | 'etapa' | 'livre';

type Turn = StoredTurn;

interface PlanState {
  goal: string;
  steps: PlanStep[];
}

export interface AskOptions {
  /** Modo/fase desta execução (padrão: modo selecionado no chat). */
  mode?: Phase;
  images?: ChatImage[];
}

type FromWebview =
  | { type: 'ready' }
  | { type: 'send'; text: string; includeContext: boolean; images?: ChatImage[] }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'copy' | 'insert' | 'apply'; code: string }
  | { type: 'command'; command: string }
  | { type: 'manual'; action: 'paste' | 'copyPrompt' | 'open' }
  | { type: 'attach' }
  | { type: 'removeAttachment'; index: number }
  | { type: 'applyEdits'; blocks: { lang: string; code: string }[] }
  | { type: 'selectModel'; label: string }
  | { type: 'setAutoApply'; value: boolean }
  | { type: 'setMode'; mode: Mode }
  | { type: 'planAction'; action: 'all' | 'step' | 'discard'; index?: number }
  | { type: 'specAction'; action: 'save' | 'plan' }
  | { type: 'undo'; id: string }
  | { type: 'removeReference'; path: string }
  | { type: 'listHistory' }
  | { type: 'openConversation'; id: string }
  | { type: 'renameConversation'; id: string; title: string }
  | { type: 'archiveConversations'; ids: string[]; archived: boolean }
  | { type: 'deleteConversation'; id: string };

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'delpCopilot.chat';

  private view: vscode.WebviewView | undefined;
  private viewReady!: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private provider: ChatProvider = createProvider();
  private turns: Turn[] = [];
  private pending: vscode.CancellationTokenSource | undefined;
  private lastTarget: EditTarget | undefined;
  private attachments: vscode.Uri[] = [];
  /** Próxima mensagem inicia conversa nova no agente (precisa da estrutura do projeto). */
  private freshConversation = true;
  /** O guia Fluig completo já foi enviado na conversa atual do agente. */
  private fluigGuideSent = false;
  private designGuideSent = false;
  /** Histórico levado ao agente ao trocar de modelo ou reabrir uma conversa. */
  private carryOver: string | undefined;
  /** Caminhos fora do projeto citados pelo usuário: o agente lê, mas nunca altera. */
  private references: ReferenceRoot[] = [];
  /** Referências cuja estrutura/conteúdo já foi enviado na conversa atual do agente. */
  private readonly referencesSent = new Set<string>();
  private readonly undoStack = new Map<string, { uri: vscode.Uri; original: string | undefined }[]>();
  private undoSeq = 0;
  private mode: Mode;
  private plan: PlanState | undefined;
  private stopPlan = false;
  private lastSpec: string | undefined;
  private conversationId: string | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly history: ConversationStore;
  private readonly busyEmitter = new vscode.EventEmitter<boolean>();
  private readonly configSub: vscode.Disposable;

  /** Dispara quando uma requisição começa (true) ou termina (false). */
  readonly onDidChangeBusy = this.busyEmitter.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly proposals: ProposalStore,
    readonly usage: UsageTracker,
    private readonly state: vscode.Memento,
    workspaceState: vscode.Memento
  ) {
    this.history = new ConversationStore(workspaceState);
    this.mode = state.get<Mode>('delpCopilot.mode', 'corrido');
    this.resetReady();
    this.configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('delpCopilot.provider')) {
        this.provider = createProvider();
        this.newChat();
      } else if (e.affectsConfiguration('delpCopilot.studio')) {
        this.postModels();
      }
      if (e.affectsConfiguration('delpCopilot.agent.autoApply')) {
        this.postSettings();
      }
      if (e.affectsConfiguration('delpCopilot.usage')) {
        this.postUsage();
      }
    });
    usage.onDidChange(() => this.postUsage());
  }

  // ---------------------------------------------------------------- configurações

  private get autoApply(): boolean {
    return vscode.workspace.getConfiguration('delpCopilot').get<boolean>('agent.autoApply', false);
  }

  /** Liga/desliga a aplicação automática; na primeira vez, pede confirmação explícita. */
  async setAutoApply(value: boolean): Promise<void> {
    if (value && !this.state.get<boolean>('autoApplyAcknowledged')) {
      const ok = await vscode.window.showWarningMessage(
        'Com "Aplicar automaticamente", o agente grava alterações nos arquivos sem pedir confirmação. ' +
          'Cada aplicação terá um botão "Desfazer", mas recomenda-se usar Git para revisar. Ativar?',
        { modal: true },
        'Ativar'
      );
      if (ok !== 'Ativar') {
        this.postSettings();
        return;
      }
      await this.state.update('autoApplyAcknowledged', true);
    }
    await vscode.workspace.getConfiguration('delpCopilot').update('agent.autoApply', value, vscode.ConfigurationTarget.Global);
  }

  async setMode(mode: Mode): Promise<void> {
    this.mode = mode;
    await this.state.update('delpCopilot.mode', mode);
    this.postSettings();
  }

  /** Troca o agente/modelo ativo; o histórico da conversa vai junto na próxima mensagem. */
  async selectModel(label: string): Promise<void> {
    if (label === activeAgent()?.label) {
      return;
    }
    if (this.pending) {
      vscode.window.showInformationMessage('Aguarde a resposta atual (ou clique em "Parar") antes de trocar de modelo.');
      this.postModels();
      return;
    }
    await setActiveAgent(label);
    this.provider.reset();
    this.freshConversation = true;
    this.fluigGuideSent = false;
    this.designGuideSent = false;
    this.referencesSent.clear();
    if (this.turns.some((t) => t.role === 'user')) {
      this.carryOver = transcript(this.turns);
      this.note(`🔀 Modelo trocado para ${label}. O histórico desta conversa vai junto na próxima mensagem.`);
    }
    this.postModels();
  }

  private postModels(): void {
    const studio = vscode.workspace.getConfiguration('delpCopilot').get<string>('provider', 'copilotStudio') === 'copilotStudio';
    this.post({
      type: 'models',
      enabled: studio,
      items: studio ? studioAgents().map((a) => a.label) : [],
      active: studio ? activeAgent()?.label : undefined,
      provider: this.providerLabel,
    });
  }

  private postSettings(): void {
    this.post({ type: 'settings', autoApply: this.autoApply, mode: this.mode });
  }

  private postUsage(): void {
    this.post({ type: 'usage', text: this.usage.shortText, over: this.usage.overDailyLimit });
  }

  private postPlan(): void {
    this.post({ type: 'plan', steps: this.plan?.steps ?? [], busy: !!this.pending });
  }

  private postReferences(): void {
    this.post({
      type: 'references',
      items: this.references.map((r) => ({ path: r.path, name: path.basename(r.path), isFile: r.isFile })),
    });
  }

  /** Orçamento de caracteres por arquivo enviado ao agente. */
  private get budget(): number {
    return vscode.workspace.getConfiguration('delpCopilot').get<number>('maxContextChars', 40000) - 2000;
  }

  /** Provedor + modelo, exibidos no chat e na barra de status. */
  get providerLabel(): string {
    return this.provider.model ? `${this.provider.label} · ${this.provider.model}` : this.provider.label;
  }

  dispose(): void {
    this.pending?.cancel();
    void this.flushSave();
    this.configSub.dispose();
    this.busyEmitter.dispose();
  }

  // ---------------------------------------------------------------- webview

  /** A promessa só resolve quando o webview avisa que carregou ('ready'). */
  private resetReady(): void {
    if (this.resolveReady) {
      return; // já existe uma espera pendente; reaproveita
    }
    this.viewReady = new Promise((r) => {
      this.resolveReady = () => {
        this.resolveReady = undefined;
        r();
      };
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.resetReady();
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
    view.webview.html = this.html(view.webview, mediaUri);
    view.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
  }

  async reveal(): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand(`${ChatViewProvider.viewId}.focus`);
    } else {
      this.view.show(true);
    }
    await this.viewReady;
  }

  // ---------------------------------------------------------------- conversas e histórico

  newChat(): void {
    this.pending?.cancel();
    void this.flushSave(); // grava o fim da conversa anterior antes de limpar
    this.provider.reset();
    this.turns = [];
    this.lastTarget = undefined;
    this.freshConversation = true;
    this.fluigGuideSent = false;
    this.designGuideSent = false;
    this.carryOver = undefined;
    this.references = [];
    this.referencesSent.clear();
    this.plan = undefined;
    this.lastSpec = undefined;
    this.conversationId = undefined;
    this.usage.resetConversation();
    this.post({ type: 'restore', turns: [], provider: this.providerLabel });
    this.postModels();
    this.postPlan();
    this.postReferences();
    this.postConversation();
  }

  private addTurn(turn: Turn): void {
    this.turns.push(turn);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.persistConversation();
    }, 400);
  }

  /** Grava já o que estava aguardando o intervalo de gravação. */
  private async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      await this.persistConversation();
    }
  }

  private async persistConversation(): Promise<void> {
    const first = this.turns.find((t) => t.role === 'user');
    if (!first) {
      return;
    }
    this.conversationId ??= newConversationId();
    const existing = this.history.get(this.conversationId);
    const now = new Date().toISOString();
    await this.history.save({
      id: this.conversationId,
      title: existing?.title ?? conversationTitle(first.text),
      created: existing?.created ?? now,
      updated: now,
      model: this.providerLabel,
      mode: this.mode,
      archived: existing?.archived,
      references: this.references.length ? [...this.references] : undefined,
      turns: this.turns,
    });
    if (!existing) {
      this.postConversation(); // a conversa ganhou título: o cabeçalho deixa de mostrar "Nova conversa"
    }
  }

  /** Reabre uma conversa salva; o histórico vai como contexto na próxima mensagem ao agente. */
  async openConversation(id: string): Promise<void> {
    if (id === this.conversationId) {
      return;
    }
    if (this.pending) {
      vscode.window.showInformationMessage('Aguarde a resposta atual (ou clique em "Parar") antes de abrir outra conversa.');
      return;
    }
    await this.flushSave();
    const conv = this.history.get(id);
    if (!conv) {
      return;
    }
    this.newChat();
    this.conversationId = conv.id;
    this.turns = [...conv.turns];
    this.carryOver = transcript(conv.turns);
    this.references = [...(conv.references ?? [])];
    await this.reveal();
    this.post({ type: 'restore', turns: this.turns, provider: this.providerLabel });
    this.postReferences();
    this.postConversation();
    this.note('📜 Conversa reaberta do histórico. As últimas mensagens vão como contexto para o agente na próxima pergunta.');
  }

  /** Abre o histórico de conversas: lista suspensa no topo do chat, como na extensão do Claude Code. */
  async showHistory(): Promise<void> {
    await this.reveal();
    this.post({ type: 'openHistory' });
  }

  private async postHistory(): Promise<void> {
    await this.flushSave();
    this.post({
      type: 'history',
      activeId: this.conversationId,
      items: this.history.list().map((c) => ({
        id: c.id,
        title: c.title,
        updated: c.updated,
        archived: !!c.archived,
        detail: `${c.turns.filter((t) => t.role === 'user').length} pedido(s)${c.model ? ` · ${c.model}` : ''}${c.mode ? ` · modo ${c.mode}` : ''}`,
      })),
    });
  }

  /** Título da conversa atual no cabeçalho do chat (sem id = conversa ainda não salva). */
  private postConversation(): void {
    const conv = this.conversationId ? this.history.get(this.conversationId) : undefined;
    this.post({ type: 'conversation', id: conv?.id, title: conv?.title });
  }

  private async renameConversation(id: string, title: string): Promise<void> {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (clean) {
      await this.flushSave();
      await this.history.rename(id, clean);
    }
    this.postConversation();
    await this.postHistory();
  }

  private async deleteConversation(id: string): Promise<void> {
    const conv = this.history.get(id);
    if (!conv) {
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      `Excluir a conversa "${conv.title}"? Isso não pode ser desfeito.`,
      { modal: true },
      'Excluir'
    );
    if (ok !== 'Excluir') {
      return;
    }
    await this.flushSave();
    await this.history.delete(id);
    if (id === this.conversationId) {
      this.newChat();
    }
    await this.postHistory();
  }

  // ---------------------------------------------------------------- execução

  /**
   * Envia um pedido ao agente e mostra no chat, aplicando o modo de trabalho.
   * @param display texto exibido como mensagem do usuário (o prompt real pode ser mais longo).
   * @param target trecho do editor que uma sugestão de código deve substituir.
   * @param expectsCode o pedido espera código como resposta (refatorar, corrigir, gerar...).
   * @param forceFluig envia o guia Fluig mesmo fora de um workspace Fluig (atalhos Fluig).
   */
  async ask(
    prompt: string,
    context: ContextItem[],
    display: string,
    target?: EditTarget,
    expectsCode = false,
    forceFluig = false,
    options: AskOptions = {}
  ): Promise<{ ok: boolean; reply: string }> {
    const fail = { ok: false, reply: '' };
    if (this.pending) {
      vscode.window.showInformationMessage('Aguarde a resposta atual ou clique em "Parar".');
      return fail;
    }
    if (this.usage.overDailyLimit && !this.provider.local) {
      const go = await vscode.window.showWarningMessage(
        `Limite diário estimado atingido (${this.usage.shortText}). Continuar mesmo assim?`,
        { modal: true },
        'Continuar'
      );
      if (go !== 'Continuar') {
        return fail;
      }
    }
    await this.reveal();
    const phase: Phase = options.mode ?? this.mode;
    this.lastTarget = target ?? this.lastTarget;
    const attached = await this.consumeAttachments();
    context = [...context, ...attached.items];
    const images = [...(options.images ?? []), ...attached.images];
    // Guia Fluig e instruções do projeto: completos na conversa nova, lembrete curto nas demais.
    const knowledge = await knowledgeContext(this.extensionUri, {
      freshConversation: this.freshConversation,
      guideAlreadySent: this.fluigGuideSent,
      forceFluig: forceFluig || FLUIG_HINT.test(prompt),
      designAlreadySent: this.designGuideSent,
      // print colado = provável revisão visual
      forceDesign: DESIGN_HINT.test(prompt) || images.length > 0,
    });
    context.unshift(...knowledge.items);
    this.fluigGuideSent = this.fluigGuideSent || knowledge.sentGuide;
    this.designGuideSent = this.designGuideSent || knowledge.sentDesign;
    // Conversa nova no agente: ele recebe a estrutura do projeto para saber o que pode ler.
    if (this.freshConversation && !context.some((c) => c.label.startsWith('Estrutura do projeto'))) {
      context.push(...(await projectContext()));
    }
    // Caminhos fora do projeto citados no pedido viram referências somente leitura da conversa.
    const refs = await this.referenceContext(display);
    context.push(...refs.items);
    if (this.carryOver) {
      context.unshift({ label: 'Histórico da conversa até aqui', text: this.carryOver });
      this.carryOver = undefined;
    }
    this.freshConversation = false;

    const labels = context.map((c) => c.label);
    if (images.length) {
      labels.push(`🖼 ${images.length} imagem(ns)`);
    }
    const contextLabel = labels.join(', ') || undefined;
    this.addTurn({ role: 'user', text: display, contextLabel });
    this.post({ type: 'user', text: display, contextLabel });
    refs.notes.forEach((n) => this.note(n));

    const prefix =
      phase === 'corrido' ? MODE_CORRIDO : phase === 'planejado' ? MODE_PLANO : phase === 'ideacao' ? MODE_IDEIA : '';
    const fullPrompt = prefix ? `${prefix}\n\nPedido do usuário: ${prompt}` : prompt;
    const manual = this.provider instanceof CopilotWebProvider;
    if (images.length && !(this.provider.label === 'Copilot Studio')) {
      this.note('⚠️ Este provedor não envia imagens; elas foram ignoradas.');
    }

    const cts = (this.pending = new vscode.CancellationTokenSource());
    this.busyEmitter.fire(true);
    this.postPlan();
    void vscode.commands.executeCommand('setContext', 'delpCopilot.waitingReply', manual);
    try {
      const result = await this.agentLoop({ prompt: fullPrompt, context, expectsCode, images }, phase, manual, cts.token);
      if (phase === 'planejado') {
        this.onPlanReply(result.reply, prompt);
      } else if (phase === 'ideacao') {
        this.lastSpec = result.reply;
        this.post({ type: 'specActions' });
      }
      return { ok: result.complete, reply: result.reply };
    } catch (err) {
      if (!cts.token.isCancellationRequested) {
        const message = err instanceof Error ? err.message : String(err);
        this.addTurn({ role: 'error', text: message });
        this.post({ type: 'error', text: message });
      }
      return fail;
    } finally {
      cts.dispose();
      this.pending = undefined;
      this.busyEmitter.fire(false);
      this.postPlan();
      void vscode.commands.executeCommand('setContext', 'delpCopilot.waitingReply', false);
    }
  }

  /**
   * Ciclo do agente: leituras (@ler/@buscar/@listar/@gerar), edições, validação e cobrança de escopo
   * até a entrega ficar completa ou o limite de rodadas.
   */
  private async agentLoop(
    first: ChatRequest,
    phase: Phase,
    manual: boolean,
    token: vscode.CancellationToken
  ): Promise<{ reply: string; complete: boolean }> {
    const canEdit = phase === 'corrido' || phase === 'etapa' || phase === 'livre';
    const enforceScope = phase === 'corrido' || phase === 'etapa';
    const budget = this.budget;
    const expectsCode = first.expectsCode;
    let request: ChatRequest = first;
    let reply = '';
    let sawEdits = false;
    let askedChecklist = false;
    let scopeAsks = 0;
    let cutAsks = 0;

    for (let round = 1; ; round++) {
      reply = await this.runTurn(request, manual, token);
      const calls = parseToolCalls(reply);

      let problems: EditProblem[] = [];
      if (calls.edits.length) {
        if (!canEdit) {
          this.note('ℹ️ Neste modo o agente não altera arquivos; os blocos de edição da resposta foram ignorados.');
        } else {
          sawEdits = true;
          const built = this.autoApply ? await this.autoApplyEdits(calls.edits) : await buildEdits(calls.edits);
          problems = [...built.problems, ...(await validateFiles(built.results))];
        }
      }
      if (!canEdit) {
        calls.generates = [];
      }
      const wantsData = calls.reads.length || calls.lists.length || calls.searches.length || calls.generates.length;

      if (round >= MAX_ROUNDS) {
        if (problems.length || wantsData) {
          this.note(`Limite de ${MAX_ROUNDS} rodadas atingido. Peça "continue" para o agente seguir de onde parou.`);
        }
        return { reply, complete: false };
      }
      if (problems.length) {
        const val = problems.filter((p) => p.kind === 'validation').length;
        this.note(
          `🔁 ${problems.length} problema(s) — ${problems.length - val} trecho(s) não bateram${val ? `, ${val} na validação automática` : ''}; pedindo correção ao agente.`
        );
        request = { prompt: this.correctionPrompt(problems), context: await this.currentContents(problems, budget), expectsCode };
        continue;
      }
      if (wantsData) {
        // @gerar: estrutura padrão Delp a partir dos modelos embutidos (nunca sobrescreve).
        const generated: ContextItem[] = [];
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        for (const spec of calls.generates.slice(0, 3)) {
          const r = root
            ? await runGenerate(this.extensionUri, root, spec)
            : { ok: false, summary: '@gerar: nenhuma pasta de projeto aberta no VS Code.' };
          generated.push({ label: `Resultado de @gerar: ${spec}`, text: r.summary });
          this.note(`${r.ok ? '🧱 Estrutura padrão gerada' : '⚠️ @gerar não executado'}: ${spec}`);
        }
        const { items: readItems, summary } = await fulfillReads(calls, budget, this.references);
        if (summary.length) {
          this.note(`📂 Enviado ao agente: ${summary.join(', ')}`);
        }
        request = {
          prompt:
            'Aqui está o resultado do que você pediu. Continue a tarefa original do usuário: peça mais arquivos se precisar, ou entregue os blocos de edição, o resumo e o checklist.',
          context: [...generated, ...readItems],
          expectsCode,
        };
        continue;
      }
      if (enforceScope) {
        const cut = truncatedFence(reply);
        if (cut && cutAsks < 3) {
          cutAsks++;
          this.note('✂️ A resposta foi cortada no meio de um bloco; pedindo a continuação ao agente.');
          request = {
            prompt:
              `Sua resposta foi cortada dentro do bloco iniciado por "${cut}". Reenvie esse bloco COMPLETO (do início) e continue a entrega a partir dele, ` +
              'sem repetir blocos anteriores que já estavam completos. Termine com o checklist do escopo.',
            context: [],
            expectsCode,
          };
          continue;
        }
        if (sawEdits) {
          const cl = parseChecklist(reply);
          if (!cl && !askedChecklist) {
            askedChecklist = true;
            this.note('📋 Conferindo o escopo: pedindo o checklist ao agente.');
            request = {
              prompt:
                'Liste agora o checklist do escopo pedido pelo usuário (bloco ```checklist), um item por requisito, marcando [x] só o que já foi entregue. ' +
                'Se houver itens pendentes, entregue-os nesta mesma resposta (blocos completos) antes do checklist.',
              context: [],
              expectsCode,
            };
            continue;
          }
          if (cl && cl.pending.length) {
            if (scopeAsks < 4) {
              scopeAsks++;
              this.note(`📋 Escopo: ${cl.done.length}/${cl.done.length + cl.pending.length} itens entregues — cobrando os pendentes.`);
              request = {
                prompt:
                  `Ainda faltam itens do escopo:\n${cl.pending.map((p) => `- ${p}`).join('\n')}\n\n` +
                  'Entregue-os agora, completos (leia o que precisar e use blocos editar/criar). Não repita o que já foi entregue. Termine com o checklist atualizado.',
                context: [],
                expectsCode,
              };
              continue;
            }
            this.note(`⚠️ Escopo incompleto após várias tentativas: ${cl.pending.join('; ')}. Peça "continue" ou detalhe esses itens.`);
            return { reply, complete: false };
          }
          if (cl) {
            this.note(`✅ Escopo completo: ${cl.done.length} item(ns) entregue(s).`);
          }
        }
      }
      return { reply, complete: true };
    }
  }

  /** Uma ida e volta com o provedor, exibida como uma resposta do assistente no chat. */
  private async runTurn(request: ChatRequest, manual: boolean, token: vscode.CancellationToken): Promise<string> {
    this.post({ type: 'assistantStart', manual });
    let latest = '';
    try {
      const text = await this.provider.send(request, (t) => {
        latest = t;
        this.post({ type: 'assistantUpdate', text: t });
      }, token);
      latest = text || (manual ? '' : latest);
      this.addTurn({ role: 'assistant', text: latest });
      this.post({ type: 'assistantDone', text: latest });
      if (!this.provider.local) {
        const sent = PREAMBLE.length + request.prompt.length + request.context.reduce((n, c) => n + c.label.length + c.text.length, 0);
        await this.usage.record(sent, latest.length);
      }
      return latest;
    } catch (err) {
      if (token.isCancellationRequested) {
        const text = latest && !manual ? `${latest}\n\n_(resposta interrompida)_` : '_(cancelado)_';
        this.addTurn({ role: 'assistant', text });
        this.post({ type: 'assistantDone', text });
      } else if (latest && !manual) {
        // Falha no meio da resposta (ex.: tempo limite): mantém no chat o que já chegou.
        const text = `${latest}\n\n_(resposta incompleta)_`;
        this.addTurn({ role: 'assistant', text });
        this.post({ type: 'assistantDone', text });
      }
      throw err;
    }
  }

  private note(text: string): void {
    this.addTurn({ role: 'note', text });
    this.post({ type: 'note', text });
  }

  // ---------------------------------------------------------------- modo planejado

  private onPlanReply(reply: string, goal: string): void {
    const steps = parsePlan(reply);
    if (!steps) {
      this.note('⚠️ Não encontrei o bloco ```plano na resposta. Peça: "gere o plano no formato ```plano".');
      return;
    }
    this.plan = { goal, steps };
    this.postPlan();
    this.note(`🧭 Plano com ${steps.length} etapa(s). Use "Executar todas" ou execute etapa por etapa no cartão do plano.`);
  }

  /** Executa uma etapa (ou todas, em sequência, a partir de start). */
  async runPlan(start: number, all: boolean): Promise<void> {
    if (!this.plan || this.pending) {
      return;
    }
    this.stopPlan = false;
    const { steps, goal } = this.plan;
    for (let i = start; i < steps.length; i++) {
      if (all && steps[i].status === 'concluida') {
        continue;
      }
      steps[i].status = 'executando';
      this.postPlan();
      const res = await this.ask(
        stepPrompt(i, steps.length, steps[i].title, steps[i].detail, planToText(steps), goal),
        [],
        `▶ Etapa ${i + 1}/${steps.length}: ${steps[i].title}`,
        undefined,
        true,
        false,
        { mode: 'etapa' }
      );
      if (!this.plan || this.plan.steps !== steps) {
        return; // plano descartado ou conversa trocada durante a execução
      }
      steps[i].status = res.ok ? 'concluida' : 'falhou';
      this.postPlan();
      if (!res.ok || !all || this.stopPlan) {
        if (!res.ok) {
          this.note(`⚠️ A etapa ${i + 1} não terminou. Você pode executá-la de novo pelo cartão do plano.`);
        }
        return;
      }
    }
    if (steps.every((s) => s.status === 'concluida')) {
      this.note('🏁 Plano concluído: todas as etapas foram entregues.');
    }
  }

  // ---------------------------------------------------------------- modo planejamento (especificação)

  private async saveSpec(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!this.lastSpec || !root) {
      vscode.window.showWarningMessage('Abra a pasta do projeto e gere uma especificação antes de salvar.');
      return;
    }
    const first = this.turns.find((t) => t.role === 'user')?.text ?? 'especificacao';
    const slug =
      first
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50) || 'especificacao';
    const uri = vscode.Uri.joinPath(root, 'docs', 'planejamento', `${new Date().toISOString().slice(0, 10)}-${slug}.md`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(this.lastSpec + '\n'));
    await vscode.window.showTextDocument(uri, { preview: false });
    this.note(`💾 Especificação salva em ${vscode.workspace.asRelativePath(uri, false)}.`);
  }

  private async planFromSpec(): Promise<void> {
    if (!this.lastSpec) {
      return;
    }
    await this.setMode('planejado');
    await this.ask(
      PLAN_FROM_SPEC,
      [{ label: 'Especificação definida no modo Planejamento', text: this.lastSpec, language: 'markdown' }],
      '🧭 Gerar plano de desenvolvimento a partir da especificação',
      undefined,
      false,
      false,
      { mode: 'planejado' }
    );
  }

  // ---------------------------------------------------------------- edições

  /** Aplica blocos ```editar/```criar pela pré-visualização de refatoração do VS Code. */
  private async applyEditBlocks(blocks: { lang: string; code: string }[]): Promise<void> {
    const text = blocks
      .map((b) => {
        const longest = Math.max(3, ...(b.code.match(/`+/g) ?? []).map((m) => m.length + 1));
        const f = '`'.repeat(longest);
        return `${f}${b.lang}\n${b.code}\n${f}`;
      })
      .join('\n\n');
    const { edits } = parseToolCalls(text);
    const { edit, problems, changes } = await buildEdits(edits);
    if (problems.length) {
      vscode.window.showWarningMessage(
        `Algumas alterações não puderam ser preparadas: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`
      );
    }
    if (!changes) {
      return;
    }
    // Com needsConfirmation, o VS Code abre o painel "Refactor Preview" para revisar e escolher o que aplicar.
    const ok = await vscode.workspace.applyEdit(edit, { isRefactoring: true });
    if (ok) {
      vscode.window.setStatusBarMessage(`Delp Copilot: alterações aplicadas (${changes}).`, 4000);
    }
  }

  /** Modo "Aplicar automaticamente": grava as edições que bateram e oferece "Desfazer". */
  private async autoApplyEdits(edits: FileEdit[]): Promise<{ problems: EditProblem[]; results: { path: string; text: string }[] }> {
    const snapshots = await snapshotFiles(edits);
    const { edit, problems, changes, files, results } = await buildEdits(edits, false);
    if (!changes) {
      return { problems, results };
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      this.note('⚠️ O VS Code recusou as alterações (o arquivo pode estar somente leitura).');
      return { problems, results: [] };
    }
    const touched = snapshots.filter((s) => files.includes(vscode.workspace.asRelativePath(s.uri, false)));
    await saveAll(touched.map((s) => s.uri));
    const id = String(++this.undoSeq);
    this.undoStack.set(id, touched);
    const text = `⚡ Aplicado automaticamente (${changes} alteração${changes > 1 ? 'ões' : ''}): ${files.join(', ')}`;
    this.addTurn({ role: 'note', text });
    this.post({ type: 'applied', id, text });
    return { problems, results };
  }

  private correctionPrompt(problems: EditProblem[]): string {
    const list = (ps: EditProblem[]) => ps.map((p) => `- ${p.path}: ${p.message}`).join('\n');
    const match = problems.filter((p) => p.kind !== 'validation');
    const validation = problems.filter((p) => p.kind === 'validation');
    const parts: string[] = [];
    if (match.length) {
      parts.push(`Blocos que não puderam ser aplicados porque o trecho BUSCAR não corresponde ao arquivo:\n${list(match)}`);
    }
    if (validation.length) {
      parts.push(`Problemas encontrados na validação automática do resultado (sintaxe, ES5/Rhino, application.info, SuperWidget):\n${list(validation)}`);
    }
    const state = this.autoApply
      ? 'Os blocos aplicáveis JÁ FORAM APLICADOS e salvos. Corrija SOMENTE o que está listado, com blocos editar calculados sobre o conteúdo atual abaixo.'
      : 'Nada foi aplicado ainda. Reenvie numa única resposta TODOS os blocos de edição desta tarefa, já corrigidos, sem repetir versões antigas.';
    return (
      `${parts.join('\n\n')}\n\n${state} ` +
      'Copie o BUSCAR exatamente do conteúdo atual (3 a 15 linhas, único no arquivo). Se o arquivo veio parcial, use @buscar/@ler para achar o trecho. Não peça confirmação. Termine com o checklist do escopo.'
    );
  }

  /** Conteúdo atual dos arquivos com problema, para o agente recalcular os blocos. */
  private async currentContents(problems: EditProblem[], budget: number): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    for (const rel of [...new Set(problems.map((p) => p.path))].slice(0, 4)) {
      const uri = resolveInWorkspace(rel);
      if (!uri) {
        continue;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const part = sliceForModel(doc.getText(), rel, budget);
        items.push({ label: `Conteúdo ATUAL de ${part.label}`, text: part.text, language: doc.languageId });
      } catch {
        // arquivo inexistente: o agente deve usar "criar"
      }
    }
    return items;
  }

  private async undo(id: string): Promise<void> {
    const snapshots = this.undoStack.get(id);
    if (!snapshots) {
      return;
    }
    if (await restoreSnapshots(snapshots)) {
      this.undoStack.delete(id);
      this.post({ type: 'undone', id });
      this.note('↩️ Alterações desfeitas.');
    } else {
      vscode.window.showErrorMessage('Não foi possível desfazer as alterações.');
    }
  }

  // ---------------------------------------------------------------- referências somente leitura

  /**
   * Libera os caminhos fora do projeto citados no texto e devolve o contexto delas para esta mensagem:
   * estrutura/conteúdo na primeira vez (ou após trocar de modelo/reabrir), depois só um lembrete curto.
   */
  private async referenceContext(text: string): Promise<{ items: ContextItem[]; notes: string[] }> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { added, problems } = await detectReferences(text, this.references, root);
    const notes = problems.map((p) => `⚠️ Referência não liberada: ${p}.`);
    if (added.length) {
      this.references.push(...added);
      this.postReferences();
    }
    const items: ContextItem[] = [];
    for (const ref of this.references.filter((r) => !this.referencesSent.has(r.path))) {
      const { item, detail } = await referenceItem(ref, this.budget);
      items.push(item);
      this.referencesSent.add(ref.path);
      if (added.includes(ref)) {
        notes.push(`🔒 Referência somente leitura: ${ref.path} (${detail}). O agente pode consultar, mas não alterar.`);
      }
    }
    if (!items.length && this.references.length) {
      items.push(referencesReminder(this.references));
    }
    return { items, notes };
  }

  private removeReference(fsPath: string): void {
    const ref = this.references.find((r) => r.path === fsPath);
    if (!ref) {
      return;
    }
    this.references = this.references.filter((r) => r !== ref);
    this.referencesSent.delete(ref.path);
    this.postReferences();
    this.note(`🔓 Referência removida: ${ref.path}. O agente deixa de ter acesso a ela.`);
  }

  /** Inserir/Aplicar do chat também não escrevem em arquivo de referência aberto no editor. */
  private refusesWrite(uri: vscode.Uri | undefined): boolean {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!uri || uri.scheme !== 'file' || (root && isInside(uri.fsPath, root)) || !findReference(uri.fsPath, this.references)) {
      return false;
    }
    vscode.window.showWarningMessage(
      'Este arquivo é uma referência somente leitura desta conversa. Abra o arquivo do projeto onde a alteração deve entrar.'
    );
    return true;
  }

  // ---------------------------------------------------------------- anexos

  /** Anexa arquivos ao próximo pedido. Sem argumentos, abre o seletor de arquivos. */
  async attach(uris?: vscode.Uri[]): Promise<void> {
    if (!uris?.length) {
      uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Anexar',
        title: 'Delp Copilot — anexar arquivos ou imagens ao próximo pedido',
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      });
    }
    if (!uris?.length) {
      return;
    }
    for (const uri of uris) {
      if (!this.attachments.some((a) => a.toString() === uri.toString())) {
        this.attachments.push(uri);
      }
    }
    await this.reveal();
    this.postAttachments();
  }

  private postAttachments(): void {
    this.post({ type: 'attachments', items: this.attachments.map((u) => vscode.workspace.asRelativePath(u, false)) });
  }

  /** Lê os anexos (texto vira contexto; imagem vai como imagem) e limpa a lista. */
  private async consumeAttachments(): Promise<{ items: ContextItem[]; images: ChatImage[] }> {
    const items: ContextItem[] = [];
    const images: ChatImage[] = [];
    const skipped: string[] = [];
    for (const uri of this.attachments) {
      const name = vscode.workspace.asRelativePath(uri, false);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type & vscode.FileType.Directory) {
          skipped.push(name);
          continue;
        }
        if (IMAGE_FILE.test(name)) {
          if (stat.size > MAX_IMAGE_BYTES) {
            skipped.push(name);
            continue;
          }
          const ext = name.split('.').pop()!.toLowerCase();
          const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
          images.push({ name, mime, data: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('base64') });
          continue;
        }
        if (stat.size > 500_000) {
          skipped.push(name);
          continue;
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        items.push({ label: `Anexo ${name}`, text: doc.getText(), language: doc.languageId });
      } catch {
        skipped.push(name); // binário ou ilegível
      }
    }
    if (skipped.length) {
      vscode.window.showWarningMessage(`Anexos ignorados (pasta, binário ou grande demais): ${skipped.join(', ')}`);
    }
    this.attachments = [];
    this.postAttachments();
    return { items, images };
  }

  /** Ponte manual: usa a resposta do Copilot que está na área de transferência. */
  async pasteReply(): Promise<void> {
    if (this.provider instanceof CopilotWebProvider) {
      await this.provider.pasteFromClipboard();
    } else {
      vscode.window.showInformationMessage('"Colar resposta" só é usado com o provedor Copilot Web (ponte manual).');
    }
  }

  // ---------------------------------------------------------------- mensagens do webview

  private async onMessage(msg: FromWebview): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.post({ type: 'restore', turns: this.turns, provider: this.providerLabel });
        this.postAttachments();
        this.postModels();
        this.postSettings();
        this.postUsage();
        this.postPlan();
        this.postReferences();
        this.postConversation();
        this.resolveReady?.();
        break;
      case 'send': {
        const text = msg.text.trim();
        if (!text && !msg.images?.length) {
          return;
        }
        const editor =
          vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'file');
        const ctx = msg.includeContext && editor ? editorContext(editor) : undefined;
        const context = ctx ? [ctx.item] : [];
        // Pergunta sobre o projeto, ou nenhum arquivo aberto: envia a estrutura e os arquivos-chave do workspace.
        if (msg.includeContext && (!ctx || PROJECT_QUESTION.test(text))) {
          context.push(...(await projectContext()));
        }
        const prompt = text || 'Analise a(s) imagem(ns) anexada(s).';
        await this.ask(prompt, context, prompt, ctx?.target, false, false, { images: msg.images });
        break;
      }
      case 'stop':
        this.stopPlan = true;
        this.pending?.cancel();
        break;
      case 'newChat':
        this.newChat();
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(msg.code);
        vscode.window.setStatusBarMessage('Código copiado.', 2000);
        break;
      case 'insert':
        if (!this.refusesWrite(fallbackEditor()?.document.uri)) {
          await insertAtCursor(msg.code);
        }
        break;
      case 'apply':
        if (!this.refusesWrite(this.lastTarget?.uri ?? fallbackEditor()?.document.uri)) {
          await applyWithDiff(this.proposals, msg.code, this.lastTarget);
        }
        break;
      case 'attach':
        await this.attach();
        break;
      case 'applyEdits':
        await this.applyEditBlocks(msg.blocks);
        break;
      case 'selectModel':
        if (msg.label === '__add__') {
          this.postModels();
          await vscode.commands.executeCommand('delpCopilot.addModel');
        } else {
          await this.selectModel(msg.label);
        }
        break;
      case 'setAutoApply':
        await this.setAutoApply(msg.value);
        break;
      case 'setMode':
        await this.setMode(msg.mode);
        break;
      case 'planAction':
        if (msg.action === 'discard') {
          this.plan = undefined;
          this.postPlan();
          this.note('🗑 Plano descartado.');
        } else {
          await this.runPlan(msg.action === 'all' ? 0 : msg.index ?? 0, msg.action === 'all');
        }
        break;
      case 'specAction':
        if (msg.action === 'save') {
          await this.saveSpec();
        } else {
          await this.planFromSpec();
        }
        break;
      case 'undo':
        await this.undo(msg.id);
        break;
      case 'removeAttachment':
        this.attachments.splice(msg.index, 1);
        this.postAttachments();
        break;
      case 'removeReference':
        this.removeReference(msg.path);
        break;
      case 'listHistory':
        await this.postHistory();
        break;
      case 'openConversation':
        await this.openConversation(msg.id);
        break;
      case 'renameConversation':
        await this.renameConversation(msg.id, msg.title);
        break;
      case 'archiveConversations':
        await this.flushSave();
        await this.history.setArchived(msg.ids, msg.archived);
        await this.postHistory();
        break;
      case 'deleteConversation':
        await this.deleteConversation(msg.id);
        break;
      case 'manual':
        if (this.provider instanceof CopilotWebProvider) {
          if (msg.action === 'paste') {
            await this.provider.pasteFromClipboard();
          } else if (msg.action === 'copyPrompt') {
            await this.provider.copyPromptAgain();
          } else {
            await this.provider.openWeb();
          }
        }
        break;
      case 'command':
        if (msg.command.startsWith('delpCopilot.')) {
          await vscode.commands.executeCommand(msg.command);
        }
        break;
    }
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chat.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'chat.js'));
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'logo.svg'));
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css}" rel="stylesheet">
  <title>Delp Copilot</title>
</head>
<body>
  <div id="splash" class="splash" aria-hidden="true">
    <svg class="splash__logo" viewBox="0 0 120 120" width="112" height="112">
      <defs>
        <linearGradient id="dcSplashTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#E3292A"/>
          <stop offset="1" stop-color="#A80C0D"/>
        </linearGradient>
      </defs>
      <rect class="splash__tile" x="6" y="6" width="108" height="108" rx="26" fill="url(#dcSplashTile)"/>
      <path class="splash__bubble" pathLength="100" d="M30 34h60a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10H58L42 96V82H30a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10z"
            fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round"/>
      <path class="splash__code" d="M47 50l-9 8 9 8M73 50l9 8-9 8M64 47l-8 22" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="splash__spark" d="M95 14l3.2 7.8L106 25l-7.8 3.2L95 36l-3.2-7.8L84 25l7.8-3.2z" fill="#FFFFFF"/>
    </svg>
    <div class="splash__word"><span class="splash__delp">delp</span> copilot</div>
    <div class="splash__tag">assistente de código da Delp</div>
    <div class="splash__bar"><span></span></div>
  </div>
  <header id="topbar">
    <button type="button" id="convTitle" class="topbar__title" title="Nova conversa" disabled>
      <span id="convTitleText" class="topbar__titleText">Nova conversa</span>
      <span class="topbar__editHint" data-icon="pencil"></span>
    </button>
    <span class="spacer"></span>
    <button type="button" id="historyBtn" class="ghost-btn" title="Histórico de conversas" aria-label="Histórico de conversas" aria-haspopup="dialog" aria-expanded="false" data-icon="history"></button>
    <button type="button" id="newChatBtn" class="ghost-btn" title="Nova conversa" aria-label="Nova conversa" data-icon="plus"></button>
  </header>
  <main id="messages" aria-live="polite"></main>
  <section id="welcome">
    <img class="welcome__logo" src="${logo}" alt="Delp Copilot">
    <h2>Delp Copilot</h2>
    <p>Escolha o modo no rodapé: <b>⚡ Corrido</b> entrega tudo de uma vez, <b>🧭 Planejado</b> monta um plano e entrega por etapas, <b>💡 Planejamento</b> ajuda a definir a ideia antes de desenvolver.</p>
    <div class="chips">
      <button class="chip" data-command="delpCopilot.explain">Explicar seleção</button>
      <button class="chip" data-command="delpCopilot.refactor">Refatorar</button>
      <button class="chip" data-command="delpCopilot.fix">Corrigir problemas</button>
      <button class="chip" data-command="delpCopilot.generateTests">Gerar testes</button>
      <button class="chip" data-command="delpCopilot.document">Documentar</button>
    </div>
    <div class="chips">
      <button class="chip" data-command="delpCopilot.fluig.newWidget">Novo widget Fluig</button>
      <button class="chip" data-command="delpCopilot.fluig.newForm">Novo formulário Fluig</button>
      <button class="chip" data-command="delpCopilot.fluig.newDataset">Novo dataset Fluig</button>
      <button class="chip" data-command="delpCopilot.history">Histórico de conversas</button>
    </div>
    <p class="note">Para seguir o padrão de outra aplicação, cite o caminho dela na mensagem (ex.: <code>C:\\Projetos\\outra-app</code>): o agente consulta, sem alterar.</p>
    <p class="note">Cole imagens com Ctrl+V. Respostas geradas por IA podem conter erros: revise antes de publicar.</p>
  </section>
  <div id="plan" hidden></div>
  <form id="composer">
    <div id="references"></div>
    <div id="attachments"></div>
    <div id="images"></div>
    <textarea id="input" rows="3" placeholder="Peça algo ao agente... (Enter envia, Shift+Enter quebra linha, Ctrl+V cola imagem)"></textarea>
    <div class="composer-bar">
      <button type="button" id="attach" class="icon-btn" title="Anexar arquivos ou imagens ao próximo pedido">📎 Anexar</button>
      <label class="ctx"><input type="checkbox" id="includeContext" checked> Arquivo/seleção atual</label>
      <span class="spacer"></span>
      <button type="submit" id="send" class="primary">Enviar</button>
    </div>
    <div class="composer-meta">
      <select id="mode" title="Modo de trabalho">
        <option value="corrido">⚡ Corrido</option>
        <option value="planejado">🧭 Planejado</option>
        <option value="ideacao">💡 Planejamento</option>
      </select>
      <select id="model" title="Modelo (agente do Copilot Studio). Trocar mantém o histórico da conversa."></select>
      <span id="provider"></span>
      <label class="ctx" title="Grava as alterações do agente sem pedir confirmação (com botão Desfazer)"><input type="checkbox" id="autoApply"> ⚡ Aplicar automaticamente</label>
      <a id="usage" href="#" title="Consumo estimado — clique para detalhes"></a>
    </div>
  </form>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
