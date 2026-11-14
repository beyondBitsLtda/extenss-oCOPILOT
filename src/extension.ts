import * as vscode from 'vscode';
import { PROPOSAL_SCHEME, ProposalStore } from './apply';
import { ChatViewProvider } from './chatViewProvider';
import { FixCodeActionProvider, registerCommands } from './commands';
import { resetKnowledgeCache } from './knowledge';
import { UsageTracker } from './usage';

export function activate(context: vscode.ExtensionContext): void {
  const proposals = new ProposalStore();
  const usage = new UsageTracker(context.globalState);
  const chat = new ChatViewProvider(context.extensionUri, proposals, usage, context.globalState, context.workspaceState);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'delpCopilot.openChat';
  const updateStatus = (busy: boolean) => {
    status.text = busy ? '$(loading~spin) Delp Copilot' : '$(sparkle) Delp Copilot';
    status.tooltip = `Delp Copilot — ${chat.providerLabel}${busy ? ' (respondendo...)' : ''}\n${usage.shortText}`;
  };
  updateStatus(false);
  status.show();

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => resetKnowledgeCache()),
    usage,
    usage.onDidChange(() => updateStatus(false)),
    chat,
    status,
    chat.onDidChangeBusy(updateStatus),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('delpCopilot') && updateStatus(false)),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, proposals),
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new FixCodeActionProvider(), {
      providedCodeActionKinds: FixCodeActionProvider.kinds,
    })
  );

  registerCommands(context, chat);
}

export function deactivate(): void {}
