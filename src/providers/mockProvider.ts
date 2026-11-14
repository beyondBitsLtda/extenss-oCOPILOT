import * as vscode from 'vscode';
import { fence } from '../prompts';
import { ChatProvider, ChatRequest } from './types';

/** Provedor de simulação: nenhuma chamada externa. Serve para testar a interface e o fluxo de aplicar código. */
export class MockProvider implements ChatProvider {
  readonly label = 'Simulação';
  readonly local = true;
  private turn = 0;

  reset(): void {
    this.turn = 0;
  }

  async send(req: ChatRequest, onText: (text: string) => void, token: vscode.CancellationToken): Promise<string> {
    this.turn++;
    const ctx = req.context[0];
    let reply =
      `**Modo simulação** (mensagem ${this.turn}) — nenhuma chamada externa foi feita.\n\n` +
      `Pedido recebido: _${req.prompt.slice(0, 200).replace(/\n/g, ' ')}_\n\n`;
    if (ctx) {
      reply +=
        `Contexto: \`${ctx.label}\`\n\n` +
        `${fence(ctx.text.replace('<<CURSOR>>', ''), ctx.language)}\n\n` +
        'Use os botões do bloco acima para testar **Copiar**, **Inserir** e **Aplicar**.';
    } else {
      reply += 'Nenhum código foi enviado como contexto.';
    }

    let shown = '';
    for (const chunk of reply.match(/[\s\S]{1,24}/g) ?? []) {
      if (token.isCancellationRequested) {
        break;
      }
      shown += chunk;
      onText(shown);
      await new Promise((r) => setTimeout(r, 15));
    }
    return shown;
  }
}
