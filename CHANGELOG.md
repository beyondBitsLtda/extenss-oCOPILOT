# Histórico de versões

## 0.7.0 — 29/10/2026

- **Referências de outras aplicações (somente leitura)**: cite na mensagem o caminho de outra pasta ou arquivo fora do projeto (ex.: `siga o padrão de C:\Projetos\portal-rh\wcm`) e o agente passa a consultá-lo com `@ler`, `@listar` e `@buscar` para seguir o padrão ou imitar o recurso — sem botão novo, integrado ao chat. A referência nunca é alterada: edições com caminho absoluto são recusadas e devolvidas ao agente, e *Inserir/Aplicar* não gravam em arquivo de referência aberto no editor. As referências ativas aparecem como etiquetas 🔒 acima do campo de texto (com × para remover) e ficam salvas na conversa. Arquivos sensíveis continuam bloqueados; raiz de disco e pasta do usuário são recusadas por serem amplas demais; até 5 referências por conversa.
- **Histórico de conversas no estilo do Claude Code**: cabeçalho no topo do chat com o título da conversa (clique para renomear), botão de histórico e **+** nova conversa. O histórico abre uma lista suspensa com busca (trecho destacado), navegação por teclado (↑ ↓ Enter Esc), tempo relativo ("agora", "5 min", "3 h", "2 d"), ações ao passar o mouse (renomear, arquivar) e a seção recolhível **Conversas arquivadas** (desarquivar, desarquivar todas e excluir com confirmação). Renomear e arquivar não reordenam a lista; continuar uma conversa mantém o nome e o arquivamento.
- Os botões de histórico e nova conversa saíram da barra de título da view (agora ficam no cabeçalho do chat). O comando **Delp Copilot: Histórico de conversas** abre a mesma lista suspensa.
- Correção: ao iniciar uma nova conversa logo após uma resposta, as últimas mensagens da conversa anterior podiam não ser gravadas no histórico.

## 0.6.0 — 02/10/2026

- **Gráficos no padrão DELP por construção**: o widget gerado traz `chartHelper.js` (`<ns>.grafico.barras / linha / rosca`) e o **Chart.js v4 real** em `lib/` (vários repositórios tinham um placeholder de poucos bytes, que derrubava os gráficos para um desenho simplificado). O helper aplica a paleta validada para daltonismo (Subsea → Indústria → Mooring → Serviços, máximo 4 séries + "Outros" em cinza, Delp Red só como destaque), barras finas com cantos de 4px, linhas de 2px, grade discreta, rótulos diretos seletivos, tooltip, botão **Ver tabela**, estado vazio, tema escuro e plano B sem a biblioteca.
- O modelo de widget já vem com um gráfico de exemplo ("Maiores valores") na aba Início, e o Controller redesenha os gráficos ao trocar o tema.
- **Guia de design DELP** (`knowledge/design.md`) enviado automaticamente quando o pedido fala de tela, gráfico, dashboard, KPI, CSS, layout etc., ou quando traz um print: escolha da forma, cores, especificações de marca, layout, estados, acessibilidade, antipadrões e roteiro de **revisão de design por print**. Depois, só um lembrete curto.
- **Validação de design** no portão de qualidade (arquivos de widget): cor fora da paleta DELP, `style="..."` inline em .ftl/.html, `new Chart` fora do chartHelper e `alert/confirm/prompt`. Só é cobrado o que a entrega introduziu; problema que já existia no arquivo não trava a correção.
- Guia Fluig atualizado (ordem de carga com chartHelper) e correção de um caractere invisível no guia.

## 0.5.0 — 01/10/2026

- **Modos de trabalho** no chat: ⚡ *Corrido* (entrega tudo de uma vez), 🧭 *Planejado* (gera um plano em etapas e executa etapa por etapa, com cartão de progresso) e 💡 *Planejamento* (ajuda a definir a ideia e gera a especificação, que pode ser salva em `docs/planejamento/` ou virar plano).
- **Escopo completo**: o agente fecha cada entrega com checklist; itens pendentes são cobrados automaticamente; respostas cortadas no meio de um bloco são continuadas; **validação automática** do resultado (sintaxe JS, ES5/Rhino, application.info, SuperWidget) devolve problemas ao agente.
- **Histórico de conversas por repositório** (botão Histórico): reabrir, continuar, excluir.
- **Imagens no chat**: colar com Ctrl+V, arrastar ou anexar (enviadas ao agente do Copilot Studio).
- **Estrutura gerada já configurada**: datasource, base, developer.code e developer.name detectados dos datasets/widgets do projeto, ou padrão da equipe (`/jdbc/FluigDS`, `FLUIG`, `DELP0216`).
- Animação de abertura com a logo do Delp Copilot.

## 0.4.1 — 01/10/2026

- Tempo limite do Copilot Studio passa a ser por **inatividade** (padrão 5 min sem nenhum sinal do agente, configurável em `delpCopilot.studio.timeoutSeconds`), renovado a cada parte da resposta, com teto de 20 min. Antes era fixo em 3 min e cortava respostas longas.
- Quando uma resposta falha no meio, o texto já recebido fica no chat (marcado como incompleto).
- Mensagem de tempo limite explica como continuar.

## 0.4.0 — 01/10/2026

- **Gerador de estrutura padrão Delp** (`templates/`): widget completo (application.info, view.ftl, edit.ftl, .properties, WEB-INF, Objects/Componentes/Permissoes/ds*/integre*/Controller/main.function, CSS com tokens, build-widget.js), dataset (LISTAR/OBTER/SALVAR/EXCLUIR + SQL idempotente) e formulário moderno (core, dataset, mask, validator, app, eventos).
- Atalhos **Novo widget/formulário/dataset Fluig** agora geram a estrutura pelos modelos e o agente só implementa a regra de negócio.
- Nova ferramenta do agente **`@gerar`**: ao pedir um artefato novo no chat, o próprio agente dispara o gerador.
- O guia Fluig é enviado também quando a mensagem fala de Fluig/widget/dataset/formulário ou vem de um atalho, mesmo fora de um projeto detectado como Fluig.
- Correção: a detecção de perguntas sobre o projeto ("o que este projeto faz") não funcionava.

## 0.3.0 — 01/10/2026

- Guia de arquitetura Fluig da Delp embutido (`knowledge/fluig.md`), extraído dos projetos da equipe: widgets, formulários, datasets, workflow, Rhino, padrão visual, segurança e Gito. Enviado automaticamente quando o workspace é um projeto Fluig.
- Envio automático de `DELP-COPILOT.md`, `CLAUDE.md` e `GITO.md` da raiz do projeto.
- Atalhos **Novo widget Fluig**, **Novo formulário Fluig** e **Novo dataset Fluig**.
- Arquivos alheios à extensão excluídos do pacote.

## 0.2.0 — 30/09/2026

- Edições aplicadas em sequência por arquivo (sem sobreposição; versões repetidas tratadas; edição já aplicada reconhecida).
- Autocorreção: trechos que não batem voltam ao agente com o conteúdo atual do arquivo.
- Remoção de marcadores de chamada de ferramenta vazados pelo modelo.
- Troca de modelo durante a conversa (um agente do Copilot Studio por modelo; histórico levado junto).
- **⚡ Aplicar automaticamente** com botão Desfazer.
- Consumo estimado de tokens (conversa/dia/mês) e limite diário.
- Arquivos grandes em partes (`@ler: arquivo#Linicio-fim`) e busca no projeto (`@buscar`).

## 0.1.0 — 30/09/2026

- Chat lateral, ações no editor (explicar, refatorar, corrigir, documentar, testes, gerar no cursor), quick fix.
- Provedor **Copilot Studio** (Agents SDK, login Entra com `CopilotStudio.Copilots.Invoke`).
- Provedores opcionais: Microsoft 365 Copilot Chat API (`m365`), ponte manual (`copilotWeb`) e simulação (`mock`).
- Modo agente: leitura de arquivos sob demanda e blocos de edição/criação com pré-visualização de refatoração.
- Anexos, contexto do projeto, aplicar com diff e localização de trecho.
