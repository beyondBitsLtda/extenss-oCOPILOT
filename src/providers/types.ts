import * as vscode from 'vscode';

export interface ContextItem {
  /** Descrição curta mostrada ao modelo, ex.: "src/app.ts (linhas 10–30)". */
  label: string;
  text: string;
  language?: string;
}

export interface ChatRequest {
  prompt: string;
  context: ContextItem[];
  /** O pedido espera código como resposta (refatorar, corrigir, gerar...). */
  expectsCode?: boolean;
  /** Imagens coladas/anexadas pelo usuário (base64, sem o prefixo data:). */
  images?: ChatImage[];
}

export interface ChatImage {
  name: string;
  mime: string;
  data: string;
}

export interface ChatProvider {
  readonly label: string;
  /** Modelo de IA por trás do provedor, quando conhecido. */
  readonly model?: string;
  /** Provedor local (simulação): não conta consumo. */
  readonly local?: boolean;
  /**
   * Envia a mensagem e chama `onText` com o texto acumulado da resposta
   * conforme ele chega. Resolve com o texto final.
   */
  send(req: ChatRequest, onText: (text: string) => void, token: vscode.CancellationToken): Promise<string>;
  /** Descarta a conversa atual; a próxima mensagem inicia uma nova. */
  reset(): void;
}
