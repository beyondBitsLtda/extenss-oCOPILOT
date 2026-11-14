import * as vscode from 'vscode';
import { adminConsentUrl, AuthConfigError, getGraphToken } from '../auth';
import { composeInline, composeWithoutContext, fence } from '../prompts';
import { ChatProvider, ChatRequest } from './types';

// Microsoft 365 Copilot Chat API (preview, Graph /beta).
// https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview
const BASE_URL = 'https://graph.microsoft.com/beta/copilot/conversations';
const REQUEST_TIMEOUT_MS = 600_000;

interface CopilotMessage {
  id?: string;
  text?: string;
}

interface CopilotConversation {
  id: string;
  messages?: CopilotMessage[];
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class M365CopilotProvider implements ChatProvider {
  readonly label = 'Microsoft 365 Copilot';
  readonly model = 'modelo gerenciado pela Microsoft';
  private conversationId: string | undefined;

  reset(): void {
    this.conversationId = undefined;
  }

  async send(req: ChatRequest, onText: (text: string) => void, token: vscode.CancellationToken): Promise<string> {
    try {
      return await this.sendOnce(req, onText, token, false);
    } catch (err) {
      // Conversa expirada/inexistente: começa outra e tenta de novo uma única vez.
      if (err instanceof GraphError && err.status === 404 && this.conversationId) {
        this.reset();
        return this.sendOnce(req, onText, token, false);
      }
      // Token recusado: força uma nova sessão e tenta de novo uma única vez.
      if (err instanceof GraphError && err.status === 401) {
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
    let accessToken: string;
    try {
      accessToken = await getGraphToken(forceNewSession);
    } catch (err) {
      if (err instanceof AuthConfigError) {
        throw err;
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Não foi possível entrar com a conta Microsoft 365 (${reason}). ` +
          'Se o login pediu "aprovação do administrador", o app ainda não tem consentimento para as permissões do Graph. ' +
          `Link para o administrador aprovar: ${adminConsentUrl()}`
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Tempo limite excedido.')), REQUEST_TIMEOUT_MS);
    const cancelSub = token.onCancellationRequested(() => controller.abort(new Error('Cancelado.')));

    try {
      if (!this.conversationId) {
        const created = await this.post<CopilotConversation>(BASE_URL, {}, accessToken, controller.signal);
        this.conversationId = created.id;
      }

      const cfg = vscode.workspace.getConfiguration('delpCopilot');
      const body = this.buildBody(req, cfg);
      const conversationUrl = `${BASE_URL}/${encodeURIComponent(this.conversationId)}`;

      if (cfg.get<boolean>('m365.streaming', true)) {
        return await this.stream(`${conversationUrl}/chatOverStream`, body, accessToken, controller.signal, onText);
      }
      const conv = await this.post<CopilotConversation>(`${conversationUrl}/chat`, body, accessToken, controller.signal);
      const text = cleanReply(pickReply(conv, body.message.text));
      onText(text);
      return text;
    } finally {
      clearTimeout(timer);
      cancelSub.dispose();
    }
  }

  private buildBody(req: ChatRequest, cfg: vscode.WorkspaceConfiguration) {
    const maxChars = cfg.get<number>('maxContextChars', 40000);
    const context = req.context.map((c) => ({ ...c, text: truncate(c.text, maxChars) }));
    const mode = cfg.get<string>('m365.contextMode', 'inline');
    const timeZone = cfg.get<string>('timeZone', '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const webSearch = cfg.get<boolean>('m365.webSearch', false);

    const useInline = mode === 'inline' || context.length === 0;
    return {
      message: { text: useInline ? composeInline(req.prompt, context) : composeWithoutContext(req.prompt) },
      ...(useInline ? {} : { additionalContext: context.map((c) => ({ text: `${c.label}\n${fence(c.text, c.language)}` })) }),
      locationHint: { timeZone },
      // A desativação da busca web vale só para esta mensagem, então é enviada em toda chamada.
      ...(webSearch ? {} : { contextualResources: { webContext: { isWebEnabled: false } } }),
    };
  }

  private async post<T>(url: string, body: unknown, accessToken: string, signal: AbortSignal): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      throw await toGraphError(res);
    }
    return (await res.json()) as T;
  }

  private async stream(
    url: string,
    body: { message: { text: string } },
    accessToken: string,
    signal: AbortSignal,
    onText: (text: string) => void
  ): Promise<string> {
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
    if (!res.ok) {
      throw await toGraphError(res);
    }
    if (!res.body) {
      throw new Error('A resposta do Copilot veio sem conteúdo.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let latest = '';

    const handleEvent = (raw: string) => {
      const conv = parseSseEvent(raw);
      if (!conv) {
        return;
      }
      // Cada evento traz a conversa com o texto acumulado até o momento (não é delta).
      const reply = pickReply(conv, body.message.text);
      if (reply && reply !== latest) {
        latest = reply;
        onText(cleanReply(latest));
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let sep: RegExpExecArray | null;
      while ((sep = /\r?\n\r?\n/.exec(buffer))) {
        handleEvent(buffer.slice(0, sep.index));
        buffer = buffer.slice(sep.index + sep[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      handleEvent(buffer);
    }
    if (!latest) {
      throw new Error('O Copilot não retornou texto para esta mensagem.');
    }
    return cleanReply(latest);
  }
}

/** Extrai o JSON de um evento SSE (tolerante a JSON quebrado em várias linhas). */
function parseSseEvent(raw: string): CopilotConversation | undefined {
  const payload = raw
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(':') && !/^(event|id|retry):/.test(line))
    .map((line) => line.replace(/^data: ?/, ''))
    .join('\n')
    .trim();
  if (!payload.startsWith('{')) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as CopilotConversation;
  } catch {
    return undefined;
  }
}

/** A conversa retornada inclui o eco da pergunta; a resposta é a última mensagem diferente dela. */
function pickReply(conv: CopilotConversation, promptText: string): string {
  const messages = conv.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].text;
    if (text && text !== promptText) {
      return text;
    }
  }
  return '';
}

/**
 * Remove marcações de entidade (<Person>, <File>...) e citações [^1^] que o Copilot
 * insere no texto — apenas fora de blocos e trechos de código, para não quebrar
 * código como `List<File>`.
 */
export function cleanReply(text: string): string {
  return text
    .split(/(^`{3,}[^\n]*\n[\s\S]*?^`{3,}[ \t]*$)/m)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment
            .split(/(`[^`\n]+`)/)
            .map((part, j) =>
              j % 2 === 1
                ? part
                : part
                    .replace(/\[\^\d+\^\]/g, '')
                    .replace(/<\/?(Event|Person|File|Organization|Message|Meeting|Email|Chat|Channel|Site|Team|Group)>/g, '')
            )
            .join('')
    )
    .join('');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n... [truncado: ${text.length - max} caracteres omitidos]`;
}

async function toGraphError(res: Response): Promise<GraphError> {
  let detail = '';
  try {
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    detail = [json.error?.code, json.error?.message].filter(Boolean).join(': ');
  } catch {
    // corpo não-JSON
  }
  const hints: Record<number, string> = {
    401: 'Sessão inválida ou expirada.',
    403:
      'Acesso negado. Confirme se o usuário tem licença Microsoft 365 Copilot e se o app tem consentimento de administrador ' +
      `para todas as permissões do Graph (link para o administrador: ${adminConsentUrl()}).`,
    429: `Limite de requisições atingido.${res.headers.get('Retry-After') ? ` Tente novamente em ${res.headers.get('Retry-After')}s.` : ' Aguarde alguns instantes.'}`,
    504: 'O Copilot demorou demais para responder (gateway timeout). Tente um trecho de código menor.',
  };
  const message = [hints[res.status] ?? `Erro ${res.status} na Copilot Chat API.`, detail].filter(Boolean).join(' ');
  return new GraphError(message, res.status);
}
