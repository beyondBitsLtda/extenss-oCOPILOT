import * as vscode from 'vscode';
import { CopilotStudioProvider } from './copilotStudioProvider';
import { CopilotWebProvider } from './copilotWebProvider';
import { M365CopilotProvider } from './m365Provider';
import { MockProvider } from './mockProvider';
import { ChatProvider } from './types';

export function createProvider(): ChatProvider {
  const id = vscode.workspace.getConfiguration('delpCopilot').get<string>('provider', 'copilotStudio');
  switch (id) {
    case 'copilotWeb':
      return new CopilotWebProvider();
    case 'm365':
      return new M365CopilotProvider();
    case 'mock':
      return new MockProvider();
    default:
      return new CopilotStudioProvider();
  }
}

export { CopilotWebProvider } from './copilotWebProvider';
export * from './types';
