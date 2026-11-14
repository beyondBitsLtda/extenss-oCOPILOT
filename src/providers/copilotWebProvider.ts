import * as vscode from 'vscode';
import { composeInline, fence } from '../prompts';
import { ChatProvider, ChatRequest } from './types';

// Limite aproximado de caracteres da caixa de mensagem do Copilot Chat web.
const WEB_INPUT_LIMIT = 16000;

interface Waiting {
  prompt: string;
  finish: (text: string) => void;
}

/**
 * Ponte manual com o Copilot Chat na web: a extensão monta o pedido e copia para a área
 * de transferência; o usuário cola no Copilot e copia a resposta. A extensão detecta a
 * resposta ao voltar o foco para o VS Code. Nenhuma automação da página web é feita.
 */
export class CopilotWebProvider implements ChatProvider {
  readonly label = 'Copilot Web (ponte manual)';
  private waiting: Waiting | undefined;
  private opened = false;
  private readonly stateEmitter = new vscode.EventEmitter<boolean>();

  /** Dispara quando começa (true) ou termina (false) a espera pela resposta colada. */
  readonly onDidChangeWaiting = this.stateEmitter.event;

  reset(): void {
    this.opened = false;
  }

  get isWaiting(): boolean {
    return this.waiting !== undefined;
  }

  async send(req: ChatRequest, onText: (text: string) => void, token: vscode.CancellationToken): Promise<string> {
    const cfg = vscode.workspace.getConfiguration('delpCopilot');
    const maxChars = cfg.get<number>('maxContextChars', 40000);
    const context = req.context.map((c) =>
      c.text.length > maxChars ? { ...c, text: `${c.text.slice(0, maxChars)}\n... [truncado]` } : c
    );
    const prompt = composeInline(req.prompt, context);

    await vscode.env.clipboard.writeText(prompt);
    const firstTime = !this.opened;
    if (firstTime) {
      await this.openWeb();
    }
    onText(instructions(prompt.length, firstTime));

    const reply = await new Promise<string>((resolve, reject) => {
      const subs: vscode.Disposable[] = [];
      const done = () => {
        subs.forEach((s) => s.dispose());
        this.waiting = undefined;
        this.stateEmitter.fire(false);
      };
      this.waiting = {
        prompt,
        finish: (text) => {
          done();
          resolve(text);
        },
      };
      // Ao voltar para o VS Code, verifica se o usuário copiou a resposta do Copilot.
      subs.push(
        vscode.window.onDidChangeWindowState((s) => {
          if (s.focused) {
            void this.pasteFromClipboard(true);
          }
        }),
        token.onCancellationRequested(() => {
          done();
          reject(new Error('Cancelado.'));
        })
      );
      this.stateEmitter.fire(true);
    });

    return normalizeReply(reply, req.expectsCode ? req.context[0]?.language : undefined);
  }

  /**
   * Usa o conteúdo da área de transferência como resposta, se ele não for o próprio pedido.
   * @param silent não avisa quando a área de transferência ainda tem o pedido (detecção automática).
   */
  async pasteFromClipboard(silent = false): Promise<boolean> {
    if (!this.waiting) {
      if (!silent) {
        vscode.window.showInformationMessage('Nenhum pedido aguardando resposta do Copilot.');
      }
      return false;
    }
    const text = (await vscode.env.clipboard.readText()).trim();
    if (!text || text === this.waiting.prompt.trim()) {
      if (!silent) {
        vscode.window.showInformationMessage('A área de transferência ainda contém o pedido. Copie a resposta do Copilot primeiro.');
      }
      return false;
    }
    this.waiting.finish(text);
    return true;
  }

  async copyPromptAgain(): Promise<void> {
    if (this.waiting) {
      await vscode.env.clipboard.writeText(this.waiting.prompt);
      vscode.window.setStatusBarMessage('Pedido copiado novamente.', 2000);
    }
  }

  async openWeb(): Promise<void> {
    const url = vscode.workspace.getConfiguration('delpCopilot').get<string>('web.url', 'https://m365.cloud.microsoft/chat');
    this.opened = await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  dispose(): void {
    this.stateEmitter.dispose();
  }
}

function instructions(promptLength: number, openedNow: boolean): string {
  const lines = [
    '**Pedido copiado para a área de transferência.**',
    '',
    `1. ${openedNow ? 'No Copilot que abriu no navegador' : 'Na aba do Copilot no navegador'}, cole com **Ctrl+V** e envie.`,
    '2. Quando ele responder, clique no botão **Copiar** da resposta (ou do bloco de código).',
    '3. Volte para o VS Code: a resposta é detectada automaticamente. Se não for, use **Colar resposta** abaixo ou `Ctrl+Alt+V`.',
  ];
  if (promptLength > WEB_INPUT_LIMIT) {
    lines.push(
      '',
      `> ⚠️ O pedido tem ${promptLength.toLocaleString('pt-BR')} caracteres e pode passar do limite do Copilot web. Se ele recusar, selecione um trecho menor.`
    );
  }
  return lines.join('\n');
}

/**
 * Se a resposta colada não tiver blocos de código mas o pedido esperava código
 * (ex.: o usuário copiou só o bloco), trata o texto inteiro como código.
 */
export function normalizeReply(text: string, codeLanguage: string | undefined): string {
  const hasFence = /^\s*(```|~~~)/m.test(text);
  if (hasFence || codeLanguage === undefined) {
    return text;
  }
  return fence(text, codeLanguage);
}
