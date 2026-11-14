import * as vscode from 'vscode';

/**
 * No Copilot Studio o modelo é fixado por agente. Para trocar de modelo durante o uso,
 * cada modelo é um agente publicado (mesmas instruções, modelo diferente) e a extensão
 * alterna entre as cadeias de conexão.
 */
export interface StudioAgent {
  label: string;
  connectionString: string;
}

const section = () => vscode.workspace.getConfiguration('delpCopilot');

export function studioAgents(): StudioAgent[] {
  return section()
    .get<StudioAgent[]>('studio.agents', [])
    .filter((a) => a && typeof a.label === 'string' && typeof a.connectionString === 'string' && a.connectionString.trim());
}

export function activeAgent(): StudioAgent | undefined {
  const agents = studioAgents();
  const name = section().get<string>('studio.activeAgent', '');
  return agents.find((a) => a.label === name) ?? agents[0];
}

export async function setActiveAgent(label: string): Promise<void> {
  await section().update('studio.activeAgent', label, vscode.ConfigurationTarget.Global);
}

/**
 * Adiciona (ou atualiza) um agente. Aceita a cadeia de conexão completa ou só o
 * "Nome do esquema" (Configurações → Avançado → Metadados), reaproveitando o ambiente do agente atual.
 */
export async function addAgent(label: string, schemaOrUrl: string): Promise<StudioAgent> {
  const value = schemaOrUrl.trim();
  let connectionString = value;
  if (!/^https:\/\//i.test(value)) {
    const template = activeAgent()?.connectionString;
    if (!template || !/\/bots\/[^/]+\//.test(template)) {
      throw new Error('Informe a cadeia de conexão completa (não há agente de referência para reaproveitar o ambiente).');
    }
    connectionString = template.replace(/\/bots\/[^/]+\//, `/bots/${encodeURIComponent(value)}/`);
  }
  const agent = { label: label.trim(), connectionString };
  const agents = [...studioAgents().filter((a) => a.label !== agent.label), agent];
  await section().update('studio.agents', agents, vscode.ConfigurationTarget.Global);
  return agent;
}
