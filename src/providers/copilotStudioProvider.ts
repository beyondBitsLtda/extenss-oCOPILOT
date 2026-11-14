import * as vscode from 'vscode';
import { AuthConfigError, getToken, POWER_PLATFORM_SCOPES } from '../auth';
import { composeInline } from '../prompts';
import { activeAgent } from '../studioAgents';
import { ChatProvider, ChatRequest } from './types';

// Agente do Copilot Studio via protocolo do Microsoft 365 Agents SDK (mesmo usado por @microsoft/agents-copilotstudio-client).
// https://learn.microsoft.com/microsoft-copilot-studio/publication-integrate-web-or-native-app-m365-agents-sdk
const API_VERSION = '2022-03-01-preview';

// Agentes da "nova experiência" (GitHub Copilot harness) não aceitam o protocolo do Agents SDK.
const HARNESS_ERROR = /GitHub Copilot harness/i;
const HARNESS_HINT =
  'Este agente foi criado na "nova experiência" do Copilot Studio (GitHub Copilot harness), que não aceita conexão por aplicativo. ' +
  'Recrie o agente com o harness padrão (desligue "Nova experiência" na página inicial ou use "Outras formas de criar") ' +
  'e atualize a cadeia de conexão em "delpCopilot.studio.agents".';
/** Teto absoluto por requisição, mesmo com o agente ainda respondendo. */
const MAX_REQUEST_MS = 20 * 60_000;

export class StudioTimeoutError extends Error {
  constructor(readonly seconds: number) {
    super(
      `O agente ficou ${seconds >= 120 ? `${Math.round(seconds / 60)} minutos` : `${seconds} segundos`} sem responder e a espera foi encerrada. ` +
        'Isso costuma acontecer em pedidos muito grandes (muitos arquivos ou um artefato inteiro de uma vez). ' +
        'A conversa continua: peça "continue" ou divida o pedido em partes. ' +
        'O tempo de espera pode ser ajustado em delpCopilot.studio.timeoutSeconds.'
    );
  }
}

interface Activity {
  type?: string;
  text?: string;
  conversation?: { id?: string };
  from?: { role?: string };
  entities?: { type?: string; streamType?: string; streamId?: string; streamSequence?: number }[];
  channelData?: { streamType?: string; streamId?: string; streamSequence?: number };
}

export class StudioError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class CopilotStudioProvider implements ChatProvider {
  readonly label = 'Copilot Studio';

  // A API do agente não informa o modelo; o nome vem do rótulo do agente ativo em "delpCopilot.studio.agents".
  get model(): string | undefined {
    return activeAgent()?.label;
  }
  private conversationId: string | undefined;
  private conversationUrl: string | undefined;

  reset(): void {
    this.conversationId = undefined;
  }

  async send(req: ChatRequest, onText: (text: string) => void, token: vscode.CancellationToken): Promise<string> {
    try {
      return await this.sendOnce(req, onText, token, false);
    } catch (err) {
      // Conversa expirada: começa outra e tenta de novo uma única vez.
      if (err instanceof StudioError && err.status === 404 && this.conversationId) {
        this.reset();
        return this.sendOnce(req, onText, token, false);
      }
      if (err instanceof StudioError && err.status === 401) {
        return this.sendOnce(req, onText, token, true);
      }
      throw err;
    }
  }

  private async sendOnce(
    req: ChatRequest,
    onText: (text: string) => void,
    token: vscode.CancellationToken,
    forceNewSession: boolean
  ): Promise<string> {
    const base = connectionUrl();
    // Trocou de agente/modelo: a conversa anterior pertence ao outro agente.
    if (this.conversationUrl !== base) {
      this.reset();
      this.conversationUrl = base;
    }
    let accessToken: string;
    try {
      accessToken = await getToken(POWER_PLATFORM_SCOPES, forceNewSession);
    } catch (err) {
      if (err instanceof AuthConfigError) {
        throw err;
      }
      throw new Error(`Não foi possível entrar com a conta Microsoft 365 (${err instanceof Error ? err.message : String(err)}).`);
    }

    // Tempo limite por INATIVIDADE: renovado a cada sinal do agente (resposta HTTP e cada evento SSE),
    // com um teto absoluto. Respostas longas que continuam chegando não são cortadas.
    const idleSeconds = Math.max(60, vscode.workspace.getConfiguration('delpCopilot').get<number>('studio.timeoutSeconds', 300));
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => controller.abort(new StudioTimeoutError(idleSeconds)), idleSeconds * 1000);
    };
    touch();
    const hardTimer = setTimeout(() => controller.abort(new StudioTimeoutError(MAX_REQUEST_MS / 1000)), MAX_REQUEST_MS);
    const cancelSub = token.onCancellationRequested(() => controller.abort(new Error('Cancelado.')));
    try {
      if (!this.conversationId) {
        // Inicia a conversa; as mensagens de boas-vindas do agente são descartadas.
        const started = await this.post(buildUrl(base), { emitStartConversationEvent: true }, accessToken, controller.signal, touch);
        this.conversationId = started.conversationId;
        if (!this.conversationId) {
          throw new Error('O Copilot Studio não retornou o identificador da conversa.');
        }
      }

      const cfg = vscode.workspace.getConfiguration('delpCopilot');
      const maxChars = cfg.get<number>('maxContextChars', 40000);
      const context = req.context.map((c) =>
        c.text.length > maxChars ? { ...c, text: `${c.text.slice(0, maxChars)}\n... [truncado]` } : c
      );
      const body = {
        activity: {
          type: 'message',
          text: composeInline(req.prompt, context),
          conversation: { id: this.conversationId },
          locale: 'pt-BR',
          // Imagens como anexos da activity (padrao Bot Framework). O agente precisa aceitar arquivos/imagens.
          ...(req.images?.length
            ? {
                attachments: req.images.map((img) => ({
                  contentType: img.mime,
                  contentUrl: `data:${img.mime};base64,${img.data}`,
                  name: img.name,
                })),
              }
            : {}),
        },
      };
      const result = await this.post(buildUrl(base, this.conversationId), body, accessToken, controller.signal, touch, onText);
      if (HARNESS_ERROR.test(result.reply)) {
        throw new Error(HARNESS_HINT);
      }
      if (!result.reply) {
        throw new Error('O agente não retornou texto para esta mensagem.');
      }
      return result.reply;
    } finally {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      clearTimeout(hardTimer);
      cancelSub.dispose();
    }
  }

  /** Faz o POST e lê o stream SSE de activities. Devolve o texto das mensagens do agente. */
  private async post(
    url: string,
    body: unknown,
    accessToken: string,
    signal: AbortSignal,
    touch: () => void,
    onText?: (text: string) => void
  ): Promise<{ reply: string; conversationId?: string }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });
    touch();
    if (!res.ok) {
      throw await toStudioError(res);
    }

    let conversationId = res.headers.get('x-ms-conversationid') ?? undefined;
    const messages: string[] = [];
    const streams = new Map<string, { text: string; sequence: number }[]>();

    const handle = (activity: Activity) => {
      conversationId ??= activity.conversation?.id;
      if (activity.type === 'message' && activity.text) {
        messages.push(activity.text);
        onText?.(messages.join('\n\n'));
      } else if (activity.type === 'typing') {
        // Respostas em streaming chegam como pedaços numerados (streamId + streamSequence).
        const info = activity.entities?.find((e) => e.type === 'streaminfo') ?? activity.channelData;
        if (info?.streamId && info.streamSequence !== undefined && activity.text !== undefined) {
          const parts = streams.get(info.streamId) ?? [];
          parts.push({ text: activity.text, sequence: info.streamSequence });
          streams.set(info.streamId, parts);
          const partial = parts
            .sort((a, b) => a.sequence - b.sequence)
            .map((p) => p.text)
            .join('');
          onText?.([...messages, partial].join('\n\n'));
        }
      }
    };

    if (res.body) {
      for await (const event of readSse(res.body)) {
        touch();
        if (event.event === 'end') {
          break;
        }
        if (event.event === 'activity' && event.data) {
          try {
            handle(JSON.parse(event.data) as Activity);
          } catch {
            // activity malformada: ignora
          }
        }
      }
    }
    return { reply: messages.join('\n\n'), conversationId };
  }
}

function connectionUrl(): string {
  const url = activeAgent()?.connectionString.trim();
  if (!url) {
    throw new AuthConfigError(
      'Nenhum agente configurado. Use "Delp Copilot: Adicionar modelo" ou configure "delpCopilot.studio.agents" com a cadeia de conexão do agente.'
    );
  }
  return url;
}

/** Mesma regra do SDK oficial: .../conversations[/{id}]?api-version=... */
export function buildUrl(base: string, conversationId?: string): string {
  const url = new URL(base);
  if (!url.searchParams.has('api-version')) {
    url.searchParams.append('api-version', API_VERSION);
  }
  let path = url.pathname.replace(/\/$/, '');
  if (path.includes('/conversations')) {
    path = path.substring(0, path.indexOf('/conversations'));
  }
  path += '/conversations';
  if (conversationId) {
    path += `/${encodeURIComponent(conversationId)}`;
  }
  url.pathname = path;
  return url.href;
}

/** Lê um stream Server-Sent Events e devolve cada evento (campos `event` e `data`). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    return { event, data: data.join('\n') };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let sep: RegExpExecArray | null;
    while ((sep = /\r?\n\r?\n/.exec(buffer))) {
      yield parse(buffer.slice(0, sep.index));
      buffer = buffer.slice(sep.index + sep[0].length);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    yield parse(buffer);
  }
}

async function toStudioError(res: Response): Promise<StudioError> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // sem corpo
  }
  const hints: Record<number, string> = {
    401: 'Sessão inválida ou expirada.',
    403: 'Acesso negado ao agente. Confirme se ele está publicado e compartilhado com você, e se o app tem a permissão CopilotStudio.Copilots.Invoke.',
    404: 'Agente ou conversa não encontrados. Confira a cadeia de conexão e se o agente foi publicado.',
    429: 'Limite de mensagens atingido. Aguarde alguns instantes.',
  };
  if (HARNESS_ERROR.test(detail)) {
    return new StudioError(HARNESS_HINT, res.status);
  }
  const message = [hints[res.status] ?? `Erro ${res.status} no Copilot Studio.`, detail].filter(Boolean).join(' ');
  return new StudioError(message, res.status);
}
