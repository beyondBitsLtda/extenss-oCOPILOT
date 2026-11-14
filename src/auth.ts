import * as vscode from 'vscode';

// A Copilot Chat API exige TODAS estas permissões delegadas (não há suporte a permissões de aplicativo).
// https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chat#permissions
export const GRAPH_SCOPES = [
  'Sites.Read.All',
  'Mail.Read',
  'People.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'Chat.Read',
  'ChannelMessage.Read.All',
  'ExternalItem.Read.All',
].map((p) => `https://graph.microsoft.com/${p}`);

// Copilot Studio (Microsoft 365 Agents SDK): uma única permissão delegada, sem consentimento de administrador.
// https://learn.microsoft.com/microsoft-copilot-studio/publication-integrate-web-or-native-app-m365-agents-sdk
export const POWER_PLATFORM_SCOPES = ['https://api.powerplatform.com/CopilotStudio.Copilots.Invoke'];

export class AuthConfigError extends Error {}

function withAppScopes(resourceScopes: string[]): string[] {
  const cfg = vscode.workspace.getConfiguration('delpCopilot');
  const clientId = cfg.get<string>('auth.clientId', '').trim();
  const tenantId = cfg.get<string>('auth.tenantId', '').trim();
  if (!clientId) {
    throw new AuthConfigError(
      'Configure "delpCopilot.auth.clientId" com o Client ID do app registrado no Entra ID (veja o README), ' +
        'ou use "delpCopilot.provider": "mock" para testar sem autenticação.'
    );
  }
  // Escopos especiais do provedor "microsoft" do VS Code para usar um app próprio em vez do app do VS Code.
  const result = [...resourceScopes, `VSCODE_CLIENT_ID:${clientId}`];
  if (tenantId) {
    result.push(`VSCODE_TENANT:${tenantId}`);
  }
  return result;
}

/**
 * Obtém um access token pela conta Microsoft do VS Code para os escopos informados.
 * O VS Code guarda e renova a sessão; o token nunca é persistido pela extensão.
 */
export async function getToken(resourceScopes: string[], forceNewSession = false): Promise<string> {
  const options: vscode.AuthenticationGetSessionOptions = forceNewSession
    ? { forceNewSession: { detail: 'Sua sessão do Microsoft 365 precisa ser renovada.' } }
    : { createIfNone: true };
  const session = await vscode.authentication.getSession('microsoft', withAppScopes(resourceScopes), options);
  if (!session) {
    throw new Error('Não foi possível obter uma sessão Microsoft 365.');
  }
  return session.accessToken;
}

export const getGraphToken = (forceNewSession = false) => getToken(GRAPH_SCOPES, forceNewSession);

/** Link para um administrador do Entra aprovar as permissões do app para todo o tenant. */
export function adminConsentUrl(): string {
  const cfg = vscode.workspace.getConfiguration('delpCopilot');
  const clientId = cfg.get<string>('auth.clientId', '').trim();
  const tenantId = cfg.get<string>('auth.tenantId', '').trim() || 'organizations';
  return `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${clientId}`;
}

/** Faz o login interativo para o provedor atual e devolve o nome da conta. */
export async function signIn(): Promise<string> {
  const provider = vscode.workspace.getConfiguration('delpCopilot').get<string>('provider', 'copilotStudio');
  const scopes = provider === 'm365' ? GRAPH_SCOPES : POWER_PLATFORM_SCOPES;
  const session = await vscode.authentication.getSession('microsoft', withAppScopes(scopes), { createIfNone: true });
  return session.account.label;
}
