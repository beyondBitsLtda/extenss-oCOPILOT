# Instalação e configuração — Delp Copilot

Este documento tem três partes:

1. **Instalação do usuário** — o que cada pessoa faz para usar a extensão.
2. **Configuração inicial** — feita uma única vez por quem administra a solução (já está pronta; serve para reconstruir ou auditar).
3. **Solução de problemas**.

---

## 1. Instalação do usuário

### Pré-requisitos

| Item | Observação |
| --- | --- |
| VS Code 1.95 ou superior | Se não estiver instalado, abra chamado no GLPI. |
| Conta corporativa Delp | Login Microsoft 365 da empresa. |
| Acesso ao agente "Delp Copilot Codigo" | O responsável compartilha o agente com você no Copilot Studio (seção 2.3). |
| Arquivo `delp-copilot-<versão>.vsix` | Enviado pelo responsável (Teams/OneDrive) ou gerado a partir deste repositório. |

Não é necessário privilégio de administrador: a extensão é instalada no perfil do usuário.

### Passo a passo

1. No VS Code, abra **Extensões** (`Ctrl+Shift+X`).
2. Clique em **⋯** (canto superior do painel) → **Instalar do VSIX...** e selecione o arquivo `.vsix`.
   - Alternativa pelo terminal: `code --install-extension delp-copilot-<versão>.vsix`
3. Recarregue: `Ctrl+Shift+P` → **Reload Window**.
4. Abra a pasta do projeto (**Arquivo → Abrir Pasta**).
5. Abra o chat pelo ícone **Delp Copilot** na barra lateral ou com `Ctrl+Alt+C`.
6. Envie uma mensagem. Na primeira vez, o VS Code pede login Microsoft: entre com a conta Delp e aceite a permissão **"Allows Invoking Copilots"**.

Pronto. Não há configuração obrigatória: o app do Entra ID, o tenant e o agente já vêm embutidos na extensão.

### Atualização

Instale o novo `.vsix` por cima (mesmo procedimento) e recarregue a janela. As configurações pessoais são mantidas.

### Opcional

- **Aplicar automaticamente**: chave **⚡** no rodapé do chat (pede confirmação na primeira vez).
- **Outros modelos**: seletor de modelo no rodapé do chat → **+ Adicionar modelo…** (exige um agente correspondente no Copilot Studio; ver Guia de Uso).
- **Limite diário de consumo**: clique no contador de tokens no rodapé do chat.

---

## 2. Configuração inicial (responsável pela solução)

Já executada em 30/09/2026. Use esta seção para auditar, reconstruir em outro ambiente ou passar a responsabilidade adiante.

### 2.1 App no Entra ID

| Item | Valor |
| --- | --- |
| Nome | Delp Copilot VS Code |
| Application (client) ID | `06d98651-6cf9-4b9d-8fb6-31d030aaef99` |
| Directory (tenant) ID | `087a74d8-5ae1-4e3d-ae04-f3857de214bc` |
| Tipos de conta | Somente este diretório (single tenant) |

Esses identificadores não são segredos; estão como padrão em `package.json` (`delpCopilot.auth.clientId` / `delpCopilot.auth.tenantId`).

**Autenticação** (plataforma *Aplicativos móveis e da área de trabalho*):

- URIs de redirecionamento:
  - `https://vscode.dev/redirect`
  - `http://localhost`
  - `ms-appx-web://Microsoft.AAD.BrokerPlugin/06d98651-6cf9-4b9d-8fb6-31d030aaef99`
- **Permitir fluxos de clientes públicos**: Sim.

**Permissões de API (delegadas)**:

| API | Permissão | Consentimento de admin | Uso |
| --- | --- | --- | --- |
| Power Platform API | `CopilotStudio.Copilots.Invoke` | **Não** | Provedor padrão (Copilot Studio) |
| Microsoft Graph | `User.Read` | Não | Padrão do registro |
| Microsoft Graph | `Sites.Read.All`, `Mail.Read`, `Chat.Read` | Não | Provedor `m365` (opcional) |
| Microsoft Graph | `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `ChannelMessage.Read.All`, `ExternalItem.Read.All` | **Sim (pendente)** | Provedor `m365` (opcional) |

O provedor padrão só precisa de `CopilotStudio.Copilots.Invoke`. As permissões do Graph servem ao provedor opcional `m365` (Microsoft 365 Copilot Chat API), que só funciona após consentimento de administrador:
`https://login.microsoftonline.com/087a74d8-5ae1-4e3d-ae04-f3857de214bc/adminconsent?client_id=06d98651-6cf9-4b9d-8fb6-31d030aaef99`

### 2.2 Agente no Copilot Studio

Portal: https://copilotstudio.microsoft.com

> **Importante:** o agente precisa ser do tipo **Agente (Standard)** — harness padrão. Agentes da "nova experiência" (GitHub Copilot harness) não aceitam conexão por aplicativo e retornam o erro *"This action doesn't support agents built with the GitHub Copilot harness"*. Para criar no padrão: página inicial → **Outras maneiras de criar** → **Agente (Standard)**, ou menu do usuário → **Abrir experiência clássica**.

| Item | Valor atual |
| --- | --- |
| Nome | Delp Copilot Codigo |
| Ambiente | `Default-087a74d8-5ae1-4e3d-ae04-f3857de214bc` |
| Nome do esquema | `cr5d2_DelpCopilotCodigo` |
| Modelo | Claude Opus 4.8 |
| Autenticação | Autenticar com a Microsoft |
| Pesquisa na Web | **Desligada** (evita que trechos de código virem consultas externas) |
| Conhecimento | Nenhum; conhecimento geral da IA ligado |

**Instruções do agente** (Visão geral → Instruções):

```
Você é um assistente de programação usado por desenvolvedores da Delp dentro do VS Code.
- Responda em português do Brasil, de forma direta e técnica.
- Baseie-se no código enviado na mensagem.
- Sempre que propuser código, use blocos markdown com a linguagem (ex.: ```typescript).
- Quando pedirem para reescrever um trecho, devolva o trecho completo em um único bloco de código, pronto para substituir o original, e depois explique as mudanças em tópicos curtos.
- Não invente APIs; se não tiver certeza, diga.
```

As regras detalhadas (protocolo de leitura/edição e guia Fluig) são enviadas pela própria extensão; não precisam estar no agente.

Depois de qualquer alteração no agente: **Publicar**.

**Cadeia de conexão** (configurada em `delpCopilot.studio.agents`):

```
https://default087a74d85ae14e3dae04f3857de214.bc.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr5d2_DelpCopilotCodigo/conversations?api-version=2022-03-01-preview
```

Ela é formada por: ID do ambiente em minúsculas, sem hífens, com os 2 últimos caracteres separados por ponto + `.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/<nome do esquema>/conversations`. O nome do esquema fica em **Configurações → Avançado → Metadados**.

### 2.3 Compartilhar com um novo usuário

1. Copilot Studio → **Agentes** → abra **Delp Copilot Codigo**.
2. **Compartilhar** → adicione a pessoa (ou um grupo do Entra) → **Compartilhar**.
3. A permissão **Acesso do usuário final** é suficiente (não dê acesso de editor).
4. Envie o `.vsix` e o link deste documento.

### 2.4 Consumo e limites

O uso do agente consome **Copilot Credits** do ambiente (saldo compartilhado entre os usuários).

- Por agente: Copilot Studio → agente → **Monitorar** → **Ver cobrança** (créditos, tendência, limite mensal se configurado).
- Por tenant (administradores): Centro de Administração do Power Platform → **Licenciamento → Copilot Studio** → *Gerenciar agentes* / *Ambientes*.

### 2.5 Gerar o `.vsix`

```bash
npm install
npm test
npm run package
```

Detalhes de versão e publicação no `docs/MANUAL-TECNICO.md`.

---

## 3. Solução de problemas

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Ícone do Delp Copilot não aparece | Janela não recarregada | `Ctrl+Shift+P` → Reload Window |
| Login para em "Aprovação do administrador necessária" | Provedor `m365` selecionado (permissões do Graph pendentes) | Use o provedor padrão `copilotStudio` (`delpCopilot.provider`) |
| **403 – Acesso negado ao agente** | Agente não compartilhado com o usuário ou não publicado | Compartilhar (2.3) e publicar |
| **404** | Agente não publicado ou cadeia de conexão errada | Publicar; conferir o nome do esquema |
| "doesn't support agents built with the GitHub Copilot harness" | Agente criado na nova experiência | Recriar como Agente (Standard) e atualizar a cadeia de conexão |
| Erro mencionando licença, capacidade ou créditos | Créditos do ambiente esgotados ou canal premium sem licença | Verificar no Power Platform (2.4) com a TI |
| Resposta sem considerar o código | Nenhum arquivo aberto e pasta não aberta | Abrir a pasta do projeto; anexar arquivos com 📎 |
| "Trecho não encontrado" ao aplicar | Arquivo mudou ou o modelo copiou errado | A extensão pede correção ao agente automaticamente; se persistir, peça de novo em nova conversa |
| "O agente ficou ... sem responder" | Pedido muito grande (muitos arquivos ou artefato inteiro) | Peça "continue" ou divida o pedido; aumente `delpCopilot.studio.timeoutSeconds` se necessário |
| Arquivo grande "parcial" | Limite de caracteres por arquivo | O agente pede as partes que faltam; ou aumente `delpCopilot.maxContextChars` |

Logs: **Ajuda → Alternar Ferramentas de Desenvolvedor → Console**, ou painel **Saída**.
