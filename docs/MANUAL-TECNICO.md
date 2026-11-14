# Manual técnico — Delp Copilot

Público: quem mantém, audita ou evolui a extensão.

## 1. Visão geral

Extensão do VS Code escrita em TypeScript, sem dependências de runtime (só `fetch` e APIs do VS Code). O modelo de IA fica no **Microsoft Copilot Studio**; a extensão monta o contexto, conversa com o agente, executa o "ciclo do agente" (leituras e edições) e aplica as alterações no workspace.

```
VS Code (extensão)                                   Microsoft (nuvem)
┌──────────────────────────────────────┐            ┌────────────────────────────────┐
│ Webview do chat (media/)             │            │ Entra ID (login, token)         │
│   ↕ postMessage                      │            └────────────────────────────────┘
│ ChatViewProvider ── ciclo do agente  │  token     ┌────────────────────────────────┐
│   │  ├─ agent.ts (leituras/edições)  │ ─────────► │ Power Platform API              │
│   │  ├─ knowledge.ts (guia Fluig)    │  HTTPS/SSE │   Copilot Studio: agente        │
│   │  └─ usage.ts (consumo)           │ ◄───────── │   "Delp Copilot Codigo" (Claude)│
│   └─ ChatProvider (providers/)       │            └────────────────────────────────┘
│ auth.ts → provedor "microsoft" do VS Code (sessão e renovação de token)            │
└──────────────────────────────────────┘
```

## 2. Estrutura do repositório

```
src/
  extension.ts            ativação: status bar, registros, contadores
  chatViewProvider.ts     painel de chat, histórico, ciclo do agente, aplicar/desfazer, seletor de modelo
  commands.ts             comandos do editor, atalhos Fluig, troca de modelo, consumo, quick fix
  agent.ts                protocolo @ler/@buscar/@listar/editar/criar, leitura segura, edições sequenciais
  apply.ts                inserir código, diff + aplicar bloco simples, localizar trecho no arquivo
  editorContext.ts        contexto do editor, diagnósticos, estrutura do projeto
  knowledge.ts            guia Fluig e instruções do projeto
  scaffold.ts             gerador de estrutura a partir de templates/ (atalhos Fluig e @gerar) + projectDefaults()
  planner.ts              leitura dos blocos ```plano e ```checklist e de resposta cortada
  validate.ts             portão de qualidade (sintaxe, ES5, application.info, SuperWidget, design)
  history.ts              histórico de conversas por repositório (workspaceState): arquivar, renomear, referências
  references.ts           referências somente leitura: detecção de caminhos na mensagem, contenção, listagem
  prompts.ts              instruções enviadas ao modelo em cada mensagem e templates de tarefa
  studioAgents.ts         lista de agentes/modelos do Copilot Studio
  usage.ts                consumo estimado (globalState)
  auth.ts                 escopos e sessão Microsoft
  providers/
    types.ts              contrato ChatProvider
    copilotStudioProvider.ts  padrão: Copilot Studio (Agents SDK)
    copilotWebProvider.ts     ponte manual por área de transferência
    m365Provider.ts           Microsoft 365 Copilot Chat API (Graph /beta) — requer consentimento de admin
    mockProvider.ts           simulação local
media/                    webview (chat.js sem dependências, chat.css, icon.svg)
knowledge/                fluig.md (guia completo) e fluig-essentials.md (lembrete);
                          design.md (guia de design) e design-essentials.md (lembrete)
templates/                modelos de widget, dataset e formulário usados pelo gerador
sandbox/                  pasta aberta pelo F5
test/                     testes (Node puro, dublê do módulo vscode)
docs/                     documentação
```

## 3. Provedores

Selecionado por `delpCopilot.provider`. Todos implementam:

```ts
interface ChatProvider {
  readonly label: string;
  readonly model?: string;
  readonly local?: boolean;            // simulação: não conta consumo
  send(req: ChatRequest, onText: (textoAcumulado: string) => void, token: CancellationToken): Promise<string>;
  reset(): void;                       // descarta a conversa
}
```

### 3.1 `copilotStudio` (padrão)

Mesmo protocolo do pacote oficial `@microsoft/agents-copilotstudio-client` (implementado com `fetch`, sem a dependência):

| Passo | Requisição |
| --- | --- |
| Token | Provedor `microsoft` do VS Code, escopo `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke` + `VSCODE_CLIENT_ID:<app>` + `VSCODE_TENANT:<tenant>` |
| Iniciar conversa | `POST <base>/conversations?api-version=2022-03-01-preview` corpo `{"emitStartConversationEvent":true}`; ID da conversa no cabeçalho `x-ms-conversationid` (as boas-vindas do agente são descartadas) |
| Mensagem | `POST <base>/conversations/<id>?api-version=...` corpo `{"activity":{"type":"message","text":"...","conversation":{"id":"<id>"},"locale":"pt-BR"}}` |
| Resposta | SSE: eventos `activity` (JSON) e `end`. `typing` com entidade `streaminfo` (`streamId`, `streamSequence`) = pedaços em streaming; `message` = texto final |

- A URL base vem do agente ativo (`delpCopilot.studio.agents` + `delpCopilot.studio.activeAgent`). Ao trocar de agente, a conversa é reiniciada.
- Erros: 401 → renova a sessão e tenta uma vez; 404 com conversa ativa → nova conversa e tenta uma vez; 403/404/429 com mensagens orientativas; texto "GitHub Copilot harness" → orientação para recriar o agente como Standard.
- Tempo limite por inatividade (`delpCopilot.studio.timeoutSeconds`, padrão 300 s), renovado a cada evento SSE recebido, com teto de 20 min; ao esgotar, o texto parcial fica no chat. Cancelamento pelo botão Parar.

### 3.2 `m365` (opcional)

Microsoft 365 Copilot Chat API (`/beta/copilot/conversations`, `/chat`, `/chatOverStream`). Exige 7 permissões delegadas do Graph, 4 com consentimento de administrador (pendente). Busca web desligada por padrão (`contextualResources.webContext.isWebEnabled=false`). API em preview.

### 3.3 `copilotWeb` (ponte manual)

Copia o pedido para a área de transferência e abre o Copilot Chat no navegador; detecta a resposta copiada quando a janela do VS Code volta ao foco. Não automatiza a página web (isso violaria os termos da Microsoft e contornaria controles do tenant).

### 3.4 `mock`

Respostas simuladas, sem rede. Para testar a interface.

## 4. Montagem da mensagem

Cada envio ao modelo = `PREAMBLE` (regras + protocolo de ferramentas, em `prompts.ts`) + tarefa + itens de contexto em blocos markdown com cerca dinâmica. Itens de contexto, na ordem:

1. **Conhecimento** (`knowledge.ts`): guia Fluig completo uma vez por conversa quando o workspace é Fluig **ou** a mensagem fala de Fluig/widget/dataset/formulário (`FLUIG_HINT`) **ou** vem de um atalho Fluig; depois, só o lembrete curto. `DELP-COPILOT.md`/`CLAUDE.md`/`GITO.md` da raiz vão na primeira mensagem da conversa. Guia de design (`knowledge/design.md`) uma vez por conversa quando a mensagem casa com `DESIGN_HINT` (gráfico, dashboard, painel, tela, layout, design, KPI, CSS, cores, widget...) ou traz imagem; depois, `design-essentials.md`.
2. **Histórico de outro modelo** (após troca de modelo; últimas 12 mensagens).
3. **Editor** (seleção ou arquivo inteiro) ou **estrutura do projeto** + arquivos-chave (até 400 arquivos listados; exclui `node_modules`, `.git`, `out`, `dist`, `build`, `bin`, `obj`, `target`, `.venv`, `__pycache__`, `.env*`, `*.pem`, `*.key`).
4. **Anexos** (até 500 KB por arquivo; binários ignorados).
5. **Referências somente leitura** (`references.ts` + `referenceItem` em `agent.ts`): regras de uso + lista de arquivos (pasta) ou conteúdo (arquivo) na primeira mensagem após liberar, trocar de modelo ou reabrir; nas seguintes, só o lembrete `Referências somente leitura`.

Cada item é truncado em `delpCopilot.maxContextChars` (padrão 40.000).

Detecção de workspace Fluig: existe algum `application.info`, `*.ftl`, `forms/**/*.html`, `events/*.js`, `datasets/*.js`, `workflow/scripts/*.js` ou `wcm/**`.

## 5. Ciclo do agente (`agent.ts` + `chatViewProvider.ts`)

Protocolo em texto, descrito ao modelo no `PREAMBLE`:

| Ferramenta | Formato (linha fora de bloco de código) |
| --- | --- |
| Ler arquivo | `@ler: caminho/arquivo.ext` |
| Ler intervalo | `@ler: caminho/arquivo.ext#L800-1200` |
| Buscar texto | `@buscar: texto` → `arquivo:linha: trecho` (até 60 ocorrências) |
| Listar pasta | `@listar: pasta` |
| Editar | bloco ` ```editar caminho ` com pares `<<<<<<< BUSCAR` / `=======` / `>>>>>>> SUBSTITUIR` |
| Criar | bloco ` ```criar caminho ` com o conteúdo completo |
| Gerar estrutura | `@gerar: widget <código> [ns]`, `@gerar: dataset <dsNome>`, `@gerar: formulario <prefixo> <Título>` → executa o gerador (seção 5.3) |

Algoritmo por pedido do usuário:

```
para rodada = 1..10:
    resposta = provider.send(pedido)
    chamadas = parseToolCalls(resposta)
    se há edições:
        problemas = autoApply ? aplicar(edições) : validar(edições)
    se não há problemas e não há leituras: fim
    se há problemas: pedido = "corrija" + conteúdo atual dos arquivos com problema; continua
    senão: pedido = conteúdo lido (fulfillReads); continua
```

Limites e salvaguardas:

- Leitura dentro da pasta do workspace ou, por caminho absoluto, dentro das referências liberadas na conversa; demais caminhos absolutos e `..` recusados.
- Escrita (blocos editar/criar, snapshots, Desfazer) só por caminho relativo dentro do workspace (`resolveInWorkspace`); caminho absoluto volta ao agente como "somente leitura". Inserir/Aplicar do chat recusam arquivo de referência (`refusesWrite`).
- Nunca enviados: `.env*`, `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa*`, nomes com `secret` ou `credential`.
- Até 8 arquivos por rodada; até 2 MB por arquivo; arquivos acima do orçamento (`maxContextChars − 2000`) vão em partes, com instrução de como pedir o restante; orçamento total por rodada = 3 × orçamento por arquivo.
- Tags de chamada de ferramenta vazadas pelo modelo (`</parameter>` etc.) são removidas dos blocos.

### 5.1 Aplicação das edições

`applyBlocksToText` aplica os blocos de cada arquivo **em sequência**, cada um sobre o resultado do anterior (evita sobreposição e trata versões repetidas). Para cada `BUSCAR`:

1. busca exata;
2. busca tolerante linha a linha, ignorando espaços nas pontas;
3. se o `SUBSTITUIR` já está no texto, considera aplicado;
4. senão, registra problema (que volta ao agente para correção).

`buildEdits` gera um `WorkspaceEdit` com **uma substituição por arquivo** (ou `createFile`), respeitando o EOL do documento.

- Modo revisão: entradas com `needsConfirmation: true` → o VS Code abre a pré-visualização de refatoração.
- Modo automático (`delpCopilot.agent.autoApply`): aplica, salva e guarda um snapshot (conteúdo anterior, ou "não existia") para o botão **Desfazer**. A primeira ativação pede confirmação explícita (registrada em `globalState`).

### 5.2 Blocos de código simples

`apply.ts`: **Aplicar** abre `vscode.diff` entre o arquivo e um documento virtual (`delp-copilot-proposal:`) e confirma. Se o alvo é o arquivo inteiro e a resposta é bem menor, `locateSnippet` acha o bloco correspondente (pela linha da declaração ou pelo nome declarado, estendendo pela indentação).

### 5.3 Gerador de estrutura (`scaffold.ts` + `templates/`)

Modelos embutidos na extensão, com placeholders `{{NOME}}` no caminho e no conteúdo:

| Modelo | Placeholders | Conteúdo |
| --- | --- | --- |
| `templates/widget` | `CODE`, `NS`, `TITULO`, `TITULO_ASCII`, `DESCRICAO`, `DESCRICAO_ASCII`, `DATA`, `DATASET` | widget completa no padrão portalTestes/devToolsKit + `build-widget.js` genérico (Node puro; valida recursos, chaves repetidas, nome do SuperWidget, caracteres invisíveis e versão) |
| `templates/dataset` | `DATASET`, `TABELA`, `TITULO`, `DESCRICAO`, `DATA` | dataset multi-ação compatível com a camada `ds*.js` do widget (colunas `ID, CODIGO, NOME, VALOR, ATIVO` + auditoria; `SALVAR` via `_PAYLOAD`) e DDL idempotente |
| `templates/form` | `FORM_FOLDER`, `FORM`, `PX`, `PX_UPPER`, `TITULO`, `DATA` | formulário moderno (padrão GO) |

`scaffold()` lista os arquivos do modelo, substitui os placeholders e grava com `workspace.fs` (cria pastas; **nunca sobrescreve**, devolve `created`/`skipped`). `widgetVars`/`datasetVars`/`formVars` derivam os nomes pelas convenções da equipe; `runGenerate` atende o `@gerar` do agente. O `application.info` usa as variantes `_ASCII` (arquivo lido em ISO-8859-1).

Para alterar um modelo: edite os arquivos em `templates/`, rode `npm test` (o teste `scaffold.test.js` gera tudo numa pasta temporária, confere ES5/sintaxe/placeholders e roda o `build-widget.js`) e gere nova versão.

### 5.4 Modos e cobrança de escopo

| Fase | Prefixo enviado | Edita arquivos | Cobra escopo |
| --- | --- | --- | --- |
| `corrido` | `MODE_CORRIDO` | sim | sim |
| `planejado` (plano) | `MODE_PLANO` (só o plano) | não | não |
| `etapa` (execução de etapa) | `stepPrompt()` | sim | sim |
| `ideacao` | `MODE_IDEIA` (especificação) | não (blocos ignorados) | não |
| `livre` (ações do editor) | — | sim | não |

Ordem de decisão a cada rodada do `agentLoop`: (1) problemas de edição/validação → correção; (2) leituras/`@gerar` → resultado; (3) resposta cortada (`truncatedFence`) → continuação (até 3x); (4) houve edições e não veio checklist → pede checklist (1x); (5) checklist com `[ ]` → cobra pendentes (até 4x); senão conclui. Limite total: 15 rodadas por pedido.

Validação (`validateFiles`) roda sobre o conteúdo final calculado por `buildEdits` (também no modo revisão, antes de aplicar).

**Design** (`designProblems`, só arquivos em `wcm/widget/`, ignorando `lib/` e `*.min.*`): hex fora da paleta DELP em valores de declaração CSS e em strings JS (aceita forma curta e alfa de 8 dígitos), `style="` em .ftl/.html, `new Chart(` fora de `chartHelper.js` e `alert/confirm/prompt`. O validador compara com o conteúdo atual do disco e só devolve o que a entrega introduziu.

### 5.4.1 Gráficos do modelo de widget

`templates/widget/.../resources/js/chartHelper.js` (ES5, `<ns>.grafico`) é o ponto único de gráficos: `barras`, `linha`, `rosca`, `redesenhar`, `corDaSerie`, `formatar`, `rampa`, `alfa`, `disponivel`. Paleta e ordem (`ORDEM = Subsea, Indústria, Mooring, Serviços`, `MAX_SERIES = 4`) validadas com o validador de paleta (CVD) — não reordenar. `lib/chart.umd.min.js` é o Chart.js v4.4.1 (MIT) e carrega como `js.1` no `application.info`; o chartHelper é o `js.5` (depois de Permissoes). Sem a biblioteca, o helper desenha barras em HTML e avisa no console. Estilos em `.<ns>-grafico*` (seção 10b do CSS). O teste `scaffold.test.js` confere a biblioteca real (>100 KB), a lógica de cor/formatação e que todos os arquivos do modelo passam em `designProblems`.

### 5.5 Histórico e imagens

`ConversationStore` grava em `workspaceState` (`delpCopilot.history`, por pasta): até 40 conversas, 300 mensagens, 20.000 caracteres por mensagem. Campos além das mensagens: `archived` e `references`. `rename`/`setArchived` não alteram `updated` (a lista é ordenada por ele). Ao reabrir, a transcrição das últimas 12 mensagens vai como item de contexto na próxima pergunta (o agente inicia conversa nova) e as referências salvas são liberadas de novo.

Interface (estilo da extensão do Claude Code): cabeçalho `#topbar` no webview (título renomeável, histórico, nova conversa) e lista suspensa montada em `chat.js` (busca, ↑ ↓ Enter Esc, tempo relativo, renomear/arquivar/desarquivar/excluir, seção de arquivadas recolhível com estado em `vscode.setState`). Mensagens webview → extensão: `listHistory`, `openConversation`, `renameConversation`, `archiveConversations`, `deleteConversation` (confirmação modal na extensão); extensão → webview: `history`, `conversation`, `openHistory`. A gravação é adiada 400 ms (`scheduleSave`) e forçada (`flushSave`) antes de listar, renomear, abrir outra conversa ou iniciar uma nova.

### 5.5.1 Referências somente leitura

`pathMentions` acha caminhos absolutos no texto do usuário (fora de blocos de código): `C:\`, `C:/`, `\\servidor\` (e `/`, `~/` fora do Windows). Sem aspas, gera candidatos de até 8 palavras (caminhos com espaço) e `detectReferences` fica com o mais longo que existe. Ignora o que está dentro do workspace ou já coberto; recusa raiz de disco, pasta do usuário e mais de 5 por conversa; avisa quando um caminho do Windows não existe (exceto `arquivo:linha` de stack trace). `walkFiles` lista em largura (até 300 arquivos, sem `node_modules`, `.git`, builds); a busca usa até 1.500 arquivos e 40 ocorrências. Comparação de caminhos sem diferenciar maiúsculas no Windows. Referências de arquivo são lidas do disco (`fs.readFile`), sem abrir documento.

Imagens chegam do webview em base64 (reduzidas para lado máximo de 1.600 px) e vão no `activity.attachments` (`contentType` + `contentUrl` data URI) do Copilot Studio. Outros provedores ignoram imagens.

### 5.6 Configuração gerada

`projectDefaults()` conta, nos `datasets/**/*.js` do workspace, os JNDI (peso 10 quando o arquivo usa tabelas `Z_DELP_`) e os qualificadores `<BASE>.dbo.Z_DELP_`; lê `developer.code/name` de `application.info` existentes. Sem referência, usa `delpCopilot.fluig.datasource` (`/jdbc/FluigDS`), `fluig.database` (`FLUIG`), `fluig.developerCode` (`DELP0216`) e `fluig.developerName` (usuário do Windows). Placeholders: `DS_JNDI`, `BASE`, `DEV_CODE`, `DEV_NAME`.

## 6. Autenticação e dados

- Login pelo provedor nativo `microsoft` do VS Code com o app próprio do Entra (escopos especiais `VSCODE_CLIENT_ID`/`VSCODE_TENANT`). O VS Code armazena e renova a sessão; a extensão não grava tokens.
- Permissão usada no padrão: `CopilotStudio.Copilots.Invoke` (delegada, sem consentimento de administrador).
- Dados enviados: apenas o contexto descrito na seção 4, para o endpoint do ambiente Power Platform da Delp (`*.environment.api.powerplatform.com`). Sem telemetria própria.
- Processamento: pelo agente do Copilot Studio e pelo modelo configurado nele (hoje Claude Opus 4.8). Confirme com a TI/Governança a política do tenant para modelos de terceiros: a Microsoft documenta que modelos de outros fornecedores podem ser processados fora do ambiente gerenciado pela Microsoft e sob os termos do fornecedor.
- Consumo: Copilot Credits do ambiente; a estimativa local fica em `globalState` (`usage.day.AAAA-MM-DD`, `usage.month.AAAA-MM`).

## 7. Configurações

| Chave | Padrão | Descrição |
| --- | --- | --- |
| `delpCopilot.provider` | `copilotStudio` | `copilotStudio`, `copilotWeb`, `m365` ou `mock` |
| `delpCopilot.studio.agents` | agente Claude Opus 4.8 | Lista `{label, connectionString}` do seletor de modelo |
| `delpCopilot.studio.activeAgent` | `Claude Opus 4.8` | Rótulo do agente ativo |
| `delpCopilot.studio.timeoutSeconds` | `300` | Espera máxima sem sinal do agente (teto de 20 min por resposta) |
| `delpCopilot.fluig.datasource` / `fluig.database` | `/jdbc/FluigDS` / `FLUIG` | Banco dos artefatos gerados (sem referência no projeto) |
| `delpCopilot.fluig.developerCode` / `fluig.developerName` | `DELP0216` / usuário do Windows | application.info das widgets geradas |
| `delpCopilot.agent.autoApply` | `false` | Aplica e salva edições sem confirmação (com Desfazer) |
| `delpCopilot.usage.dailyTokenLimit` | `0` | Limite diário estimado (0 = sem limite) |
| `delpCopilot.knowledge.fluig` | `auto` | `auto`, `always` ou `never` |
| `delpCopilot.knowledge.projectFiles` | `DELP-COPILOT.md`, `CLAUDE.md`, `GITO.md` | Arquivos da raiz enviados como instruções |
| `delpCopilot.maxContextChars` | `40000` | Máximo de caracteres por item de contexto |
| `delpCopilot.auth.clientId` / `auth.tenantId` | app/tenant Delp | Identificadores do app no Entra |
| `delpCopilot.web.url` | Copilot Chat M365 | URL do modo `copilotWeb` |
| `delpCopilot.m365.webSearch` / `streaming` / `contextMode` | `false` / `true` / `inline` | Provedor `m365` |
| `delpCopilot.timeZone` | fuso do sistema | Provedor `m365` |

## 8. Comandos

| Comando | Atalho |
| --- | --- |
| `delpCopilot.openChat` | `Ctrl+Alt+C` |
| `delpCopilot.newChat`, `history` | cabeçalho do chat (também na paleta) |
| `delpCopilot.switchModel`, `addModel`, `showUsage` | barra de título da view |
| `delpCopilot.explain`, `refactor`, `fix`, `document`, `generateTests`, `askSelection` | menu do editor |
| `delpCopilot.generate` | `Ctrl+Alt+G` |
| `delpCopilot.attachFiles` | menu do Explorer |
| `delpCopilot.fluig.newWidget`, `newForm`, `newDataset` | tela inicial do chat |
| `delpCopilot.pasteReply` | `Ctrl+Alt+V` (modo `copilotWeb`) |
| `delpCopilot.signIn` | paleta |

## 9. Build, testes e publicação

```bash
npm install            # dependências de desenvolvimento (TypeScript, @vscode/vsce)
npm run compile        # tsc → out/
npm test               # compila e roda test/*.test.js (Node puro)
npm run package        # vsce package → delp-copilot-<versão>.vsix
```

- `F5`: abre uma janela de desenvolvimento com a pasta `sandbox/` (`.vscode/launch.json`).
- Testes: cada arquivo substitui o módulo `vscode` por um dublê e testa o código compilado (protocolos SSE, montagem de requisições, parser do agente, edições sequenciais, faixas de leitura, agentes/consumo, base de conhecimento, renderizador markdown do webview).
- `.vscodeignore` exclui `src`, `test`, `docs`, `sandbox` e mapas do pacote.

**Nova versão:**

1. Atualize `version` no `package.json` (SemVer).
2. Registre no `CHANGELOG.md`.
3. `npm test` e `npm run package`.
4. Distribua o `.vsix` (Teams/OneDrive ou release do repositório). Os usuários instalam por cima.

**Manter o guia de design:** edite `knowledge/design.md` e `knowledge/design-essentials.md`; se mudar a paleta ou a ordem das cores, atualize também `chartHelper.js` e `PALETA_DELP` em `validate.ts`.

**Manter o guia Fluig:** edite `knowledge/fluig.md` (mantenha abaixo de ~38.000 caracteres por causa do limite por item) e `knowledge/fluig-essentials.md`; gere nova versão.

## 10. Limitações conhecidas

- Sem sugestões enquanto digita (autocomplete): a API do agente é de conversa.
- O agente precisa ser do harness padrão (Standard) no Copilot Studio.
- O nome do modelo exibido é o rótulo cadastrado; a API não informa o modelo.
- Consumo de tokens é estimado; o oficial é em Copilot Credits.
- O protocolo de ferramentas depende de o modelo seguir o formato; respostas fora do padrão viram texto comum.
- Provedor `m365` depende de consentimento de administrador e de API em preview.

## 11. Governança

Uso atual: piloto na equipe de desenvolvimento. Antes de ampliar o uso, a solução deve passar por avaliação de **Governança e Compliance** (PSI Delp / ISO 27001 / LGPD), com apoio da TI, cobrindo: dados enviados ao Copilot Studio, modelos habilitados no tenant, permissões do app no Entra, consumo de créditos e regras de uso (não enviar dados pessoais sensíveis nem credenciais).
