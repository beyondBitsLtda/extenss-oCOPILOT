import * as vscode from 'vscode';

/**
 * Consumo ESTIMADO de tokens (≈ 4 caracteres por token). O Copilot Studio não informa tokens
 * nas respostas e cobra em Copilot Credits por mensagem; o consumo oficial fica no
 * Centro de Administração do Power Platform.
 */
export interface UsageStats {
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

const CHARS_PER_TOKEN = 4;
const empty = (): UsageStats => ({ requests: 0, tokensIn: 0, tokensOut: 0 });
const total = (s: UsageStats) => s.tokensIn + s.tokensOut;

export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export class UsageTracker implements vscode.Disposable {
  private conversation = empty();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly state: vscode.Memento) {}

  dispose(): void {
    this.emitter.dispose();
  }

  private static dayKey(d = new Date()): string {
    return `usage.day.${d.toISOString().slice(0, 10)}`;
  }

  private static monthKey(d = new Date()): string {
    return `usage.month.${d.toISOString().slice(0, 7)}`;
  }

  get today(): UsageStats {
    return this.state.get<UsageStats>(UsageTracker.dayKey(), empty());
  }

  get month(): UsageStats {
    return this.state.get<UsageStats>(UsageTracker.monthKey(), empty());
  }

  get current(): UsageStats {
    return this.conversation;
  }

  /** Registra uma ida e volta com o modelo (em caracteres enviados/recebidos). */
  async record(charsIn: number, charsOut: number): Promise<void> {
    const add = (s: UsageStats): UsageStats => ({
      requests: s.requests + 1,
      tokensIn: s.tokensIn + Math.ceil(charsIn / CHARS_PER_TOKEN),
      tokensOut: s.tokensOut + Math.ceil(charsOut / CHARS_PER_TOKEN),
    });
    this.conversation = add(this.conversation);
    await this.state.update(UsageTracker.dayKey(), add(this.today));
    await this.state.update(UsageTracker.monthKey(), add(this.month));
    this.emitter.fire();
  }

  resetConversation(): void {
    this.conversation = empty();
    this.emitter.fire();
  }

  async resetAll(): Promise<void> {
    for (const key of this.state.keys().filter((k) => k.startsWith('usage.'))) {
      await this.state.update(key, undefined);
    }
    this.conversation = empty();
    this.emitter.fire();
  }

  get dailyLimit(): number {
    return vscode.workspace.getConfiguration('delpCopilot').get<number>('usage.dailyTokenLimit', 0);
  }

  get overDailyLimit(): boolean {
    return this.dailyLimit > 0 && total(this.today) >= this.dailyLimit;
  }

  /** Linha curta para o rodapé do chat. */
  get shortText(): string {
    const limit = this.dailyLimit ? ` / ${formatTokens(this.dailyLimit)}` : '';
    return `≈ ${formatTokens(total(this.conversation))} tokens nesta conversa · ${formatTokens(total(this.today))}${limit} hoje`;
  }

  get detailText(): string {
    const line = (name: string, s: UsageStats) =>
      `${name}: ${s.requests} mensagens · ≈ ${formatTokens(s.tokensIn)} enviados + ${formatTokens(s.tokensOut)} recebidos = ${formatTokens(total(s))} tokens`;
    return [
      line('Conversa atual', this.conversation),
      line('Hoje', this.today),
      line('Este mês', this.month),
      `Limite diário: ${this.dailyLimit ? `${formatTokens(this.dailyLimit)} tokens` : 'sem limite'}`,
      '',
      'Valores estimados (≈ 4 caracteres por token). O Copilot Studio cobra em Copilot Credits por mensagem; o consumo oficial fica no Centro de Administração do Power Platform.',
    ].join('\n');
  }
}
