import * as vscode from 'vscode';
import { ReferenceRoot } from './references';

/** Histórico de conversas por repositório (workspaceState: cada pasta tem o seu). */

export interface StoredTurn {
  role: 'user' | 'assistant' | 'error' | 'note';
  text: string;
  contextLabel?: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  created: string;
  updated: string;
  model?: string;
  mode?: string;
  /** Arquivada pelo usuário: sai da lista principal e vai para "Conversas arquivadas". */
  archived?: boolean;
  /** Referências somente leitura liberadas na conversa (voltam ao reabrir). */
  references?: ReferenceRoot[];
  turns: StoredTurn[];
}

const KEY = 'delpCopilot.history';
const MAX_CONVERSATIONS = 40;
const MAX_TURNS = 300;
const MAX_TEXT = 20_000;

export class ConversationStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): StoredConversation[] {
    return [...this.state.get<StoredConversation[]>(KEY, [])].sort((a, b) => b.updated.localeCompare(a.updated));
  }

  get(id: string): StoredConversation | undefined {
    return this.list().find((c) => c.id === id);
  }

  async save(conv: StoredConversation): Promise<void> {
    const trimmed: StoredConversation = {
      ...conv,
      turns: conv.turns.slice(-MAX_TURNS).map((t) => ({
        ...t,
        text: t.text.length > MAX_TEXT ? `${t.text.slice(0, MAX_TEXT)}\n… [truncado no histórico]` : t.text,
      })),
    };
    const others = this.list().filter((c) => c.id !== conv.id);
    await this.state.update(KEY, [trimmed, ...others].slice(0, MAX_CONVERSATIONS));
  }

  async delete(id: string): Promise<void> {
    await this.state.update(KEY, this.list().filter((c) => c.id !== id));
  }

  async rename(id: string, title: string): Promise<void> {
    await this.patch([id], { title });
  }

  async setArchived(ids: string[], archived: boolean): Promise<void> {
    await this.patch(ids, { archived });
  }

  /** Altera campos sem mexer em "updated": renomear ou arquivar não reordena a lista. */
  private async patch(ids: string[], change: Partial<StoredConversation>): Promise<void> {
    await this.state.update(
      KEY,
      this.state.get<StoredConversation[]>(KEY, []).map((c) => (ids.includes(c.id) ? { ...c, ...change } : c))
    );
  }
}

export function newConversationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function conversationTitle(firstUserText: string): string {
  const t = firstUserText.replace(/\s+/g, ' ').trim();
  return t.length > 70 ? `${t.slice(0, 67)}…` : t || 'Conversa';
}

/** Texto das últimas mensagens para o agente retomar o contexto ao reabrir uma conversa. */
export function transcript(turns: StoredTurn[], max = 12): string {
  return turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .slice(-max)
    .map((t) => `${t.role === 'user' ? 'Usuário' : 'Assistente'}: ${t.text.slice(0, 3000)}`)
    .join('\n\n');
}
