# Guia de uso — Delp Copilot

## 1. Visão geral da tela

O chat fica na barra lateral (ícone **Delp Copilot**, ou `Ctrl+Alt+C`).

| Área | Função |
| --- | --- |
| Barra de título da view | **Trocar modelo** · **Ver consumo** |
| Cabeçalho do chat | Título da conversa (clique para renomear) · 🕘 **Histórico** · **+** Nova conversa |
| Mensagens | Suas perguntas, respostas do agente, notas de leitura (📂) e de aplicação (⚡) |
| 🔒 Etiquetas de referência | Pastas/arquivos de outras aplicações liberados para leitura nesta conversa (× remove) — seção 2.1 |
| 📎 Anexar | Anexa arquivos ao próximo pedido |
| Arquivo/seleção atual | Envia o arquivo aberto (ou o trecho selecionado) junto com a pergunta |
| Seletor de modelo | Troca o agente/modelo a qualquer momento |
| ⚡ Aplicar automaticamente | Grava as edições do agente sem pedir confirmação |
| Contador de tokens | Consumo estimado da conversa e do dia (clique para detalhes e limite) |

`Enter` envia, `Shift+Enter` quebra linha. Enquanto o agente responde, o botão vira **Parar**.

## 1.1 Modos de trabalho

Escolha no seletor do rodapé (fica salvo):

| Modo | Para quê | Como funciona |
| --- | --- | --- |
| ⚡ **Corrido** | Pedidos diretos | O agente entrega todo o escopo numa só execução (lendo o que precisar). |
| 🧭 **Planejado** | Entregas grandes | O agente primeiro devolve um **plano em etapas** (aparece um cartão acima do campo de texto). Use **▶ Executar todas** ou execute etapa por etapa; cada etapa é entregue completa antes da próxima, e o cartão mostra o progresso. Etapas que falharem podem ser repetidas. |
| 💡 **Planejamento** | Definir a ideia antes de desenvolver | O agente atua como analista: faz perguntas, propõe escopo, requisitos, telas, dados e riscos — **sem alterar arquivos**. Ao final, use **💾 Salvar especificação** (gera `docs/planejamento/<data>-<assunto>.md`) ou **🧭 Gerar plano de desenvolvimento** (vai para o modo Planejado). |

As ações do botão direito no editor (explicar, refatorar etc.) sempre rodam direto, sem modo.

### Escopo completo

Em Corrido e Planejado, toda entrega termina com um **📋 checklist do escopo**. A extensão confere:

- itens marcados como pendentes são **cobrados automaticamente** até serem entregues;
- respostas **cortadas no meio** de um bloco são continuadas automaticamente;
- o resultado passa por **validação automática** (sintaxe JavaScript, ES5 para Fluig/Rhino, recursos do application.info, nome do SuperWidget); problemas voltam ao agente para correção.

No chat aparecem notas como **📋 Escopo: 3/5 itens — cobrando os pendentes** e **✅ Escopo completo**.

## 1.2 Histórico

Funciona como na extensão do Claude Code. Cada repositório guarda suas conversas (até 40).

- O **cabeçalho** do chat mostra o título da conversa atual (o início do primeiro pedido). Clique nele para **renomear** (`Enter` grava, `Esc` cancela).
- O botão 🕘 (ou o atalho *Histórico de conversas* da tela inicial) abre a **lista suspensa** com a busca já em foco. Digite para filtrar pelo título; o trecho encontrado fica destacado.
- Cada linha mostra há quanto tempo a conversa teve atividade ("agora", "5 min", "3 h", "2 d", "1 mês"). Passe o mouse para **renomear** (lápis) ou **arquivar** (caixa). Parado sobre a linha, a dica mostra quantos pedidos, o modelo e o modo.
- **Teclado:** `↑` `↓` escolhem, `Enter` abre, `Esc` limpa a busca e, de novo, fecha a lista.
- **Conversas arquivadas** saem da lista principal e ficam numa seção recolhível no fim (abre sozinha durante a busca). Lá é possível **desarquivar**, **desarquivar todas** ou **excluir** (pede confirmação; não tem volta).
- Ao reabrir uma conversa, as últimas mensagens vão como contexto para o agente na próxima pergunta, junto com as referências que estavam liberadas nela.

## 1.3 Imagens

Cole prints com **Ctrl+V** no campo de texto, arraste imagens para o chat ou anexe arquivos de imagem com 📎 (até 4 por pedido; imagens grandes são reduzidas). Elas são enviadas ao agente junto com a mensagem. Se o agente ignorar as imagens, peça ao responsável para conferir, nas configurações de IA generativa do agente no Copilot Studio, se o recebimento de arquivos/imagens está habilitado.

## 2. O que vai como contexto

A extensão monta automaticamente o que o agente precisa saber:

- **Arquivo aberto ou seleção** (caixa "Arquivo/seleção atual" marcada).
- **Estrutura do projeto** na primeira mensagem de cada conversa (lista de arquivos, sem `node_modules`, `.git`, builds e arquivos sensíveis).
- **Arquivos-chave** (README, package.json etc.) quando a pergunta fala do projeto ("o que este projeto faz", "arquitetura"...).
- **Anexos** (📎 ou botão direito no Explorer → **Anexar ao chat**). Valem só para o próximo pedido.
- **Guia Fluig** e instruções do projeto (`DELP-COPILOT.md`, `CLAUDE.md`, `GITO.md`) quando aplicável (seção 6).
- **Guia de design DELP** quando o pedido é sobre aparência ou traz print (seção 6.1).
- **Referências de outras aplicações** citadas na mensagem (seção 2.1).

Arquivos `.env`, chaves (`.pem`, `.key`, `.pfx`) e nomes com "secret"/"credential" nunca são enviados.

## 2.1 Referências de outras aplicações (somente leitura)

Para o agente seguir o padrão de outra aplicação ou imitar um recurso dela, **cite o caminho na própria mensagem** — não há botão nem configuração:

> crie a tela de aprovação seguindo o padrão de C:\Projetos\portal-rh\wcm\widget\aprovacoes
> imite o filtro por período de "C:\Projetos\Painel Obras\src\filtros.js"

O que acontece:

- A extensão reconhece caminhos do Windows (`C:\...`, `D:/...`, `\\servidor\pasta\...`) fora do projeto aberto. Caminhos com espaços funcionam com ou sem aspas.
- Aparece a nota **🔒 Referência somente leitura** e uma etiqueta acima do campo de texto. Pasta: o agente recebe a lista de arquivos e lê o que precisar (`@ler`, `@listar`, `@buscar` também procuram lá). Arquivo: o conteúdo já vai na mensagem.
- **Nada é alterado na referência.** Se o agente tentar editar um arquivo dela, a extensão recusa e pede para aplicar o padrão no projeto. *Inserir* e *Aplicar* do chat também não gravam em arquivo de referência aberto no editor.
- A referência vale para a conversa inteira (e volta ao reabri-la pelo histórico). Clique no **×** da etiqueta para retirar o acesso.
- Limites: até 5 por conversa; raiz de disco (`C:\`) e a pasta do usuário são recusadas por serem amplas demais; os mesmos arquivos sensíveis do projeto (`.env`, chaves, "secret", "credential") nunca são enviados; `node_modules`, `.git` e pastas de build ficam de fora. Caminhos citados dentro de blocos de código são ignorados.
- Se o caminho não existir ou você não tiver acesso, aparece um aviso e nada é liberado.

## 3. Modo agente: pedir alterações

Peça em linguagem natural, como faria a um colega:

> crie um tema vermelho e inclua no ciclo do botão de tema
> adicione validação de CNPJ no formulário de fornecedor
> o dataset dsCapexAprovacao está devolvendo nulo, investigue

O que acontece:

1. O agente pede os arquivos de que precisa. No chat aparecem linhas como **📂 Lendo assets/js/app.js** e **🔎 Buscando setTheme**; a extensão lê e devolve sozinha (até 10 rodadas).
2. Arquivos grandes chegam em partes; o agente pede as linhas que faltam.
3. A resposta traz **blocos de edição** mostrados como diff (vermelho = sai, verde = entra) ou **blocos de criação** de arquivos novos.
4. Se algum trecho não bater com o arquivo, aparece **🔁 pedindo correção ao agente** e ele reenvia corrigido, sem você intervir.

### Aplicar as edições

- **Modo revisão (padrão)**: clique em **Revisar e aplicar** no bloco (ou **Revisar e aplicar todas**). Abre a pré-visualização de refatoração do VS Code: marque/desmarque cada mudança e confirme. Tudo pode ser desfeito com `Ctrl+Z`.
- **⚡ Aplicar automaticamente**: as edições são gravadas e salvas na hora. Cada aplicação aparece no chat com o botão **Desfazer**, que restaura os arquivos (e apaga os criados). Recomenda-se usar Git com essa opção ligada.

### Blocos de código comuns

Respostas com código simples têm três botões:

| Botão | Efeito |
| --- | --- |
| Copiar | Copia o código |
| Inserir | Insere na posição do cursor |
| Aplicar | Mostra diff contra o trecho de origem (seleção) e pede confirmação. Se a resposta é só uma função e o pedido foi sobre o arquivo inteiro, localiza a função no arquivo e substitui só ela |

## 4. Ações no editor

Botão direito no editor → **Delp Copilot**:

| Ação | O que faz |
| --- | --- |
| Explicar código | Explica o trecho/arquivo e aponta riscos |
| Perguntar sobre a seleção... | Pergunta livre sobre o trecho |
| Refatorar | Melhora legibilidade sem mudar comportamento |
| Corrigir problemas | Usa os erros/avisos do VS Code e corrige |
| Documentar | Adiciona documentação no padrão da linguagem |
| Gerar testes | Cria testes unitários |
| Gerar código no cursor... (`Ctrl+Alt+G`) | Gera código a partir de uma descrição |

Na lâmpada (💡) de erros e avisos aparece **Corrigir com Delp Copilot**.

## 5. Modelos e consumo

### Trocar de modelo

No Copilot Studio o modelo é fixado por agente. Para ter outro modelo:

1. Crie outro **Agente (Standard)** com as mesmas instruções e outro modelo; publique.
2. Copie o **Nome do esquema** (Configurações → Avançado → Metadados).
3. No seletor de modelo → **+ Adicionar modelo…** → informe o nome de exibição e o esquema.

A troca pode ser feita no meio da conversa: o histórico vai junto para o novo modelo. O nome exibido é o que você cadastrou (a API não informa o modelo).

### Consumo

O contador mostra uma **estimativa** (≈ 4 caracteres por token). Clique nele para ver conversa/dia/mês, definir um **limite diário** (ao atingir, a extensão pede confirmação antes de enviar) ou zerar contadores. O consumo oficial é em Copilot Credits (Copilot Studio → Monitorar). Cada rodada de leitura do agente conta como uma mensagem.

## 6. Projetos Fluig

Com uma pasta Fluig aberta (tem `wcm/`, `forms/`, `datasets/`, `workflow/`, `application.info` ou `.ftl`), o agente recebe o **guia de arquitetura Fluig da Delp** na primeira mensagem da conversa: estrutura de widgets (Objects → Componentes → ds* → integre* → Controller → main.function), datasets com `_ACAO` e `PreparedStatement`, formulários (hidden de controle, zoom, pai-filho, displayFields, beforeSendValidate), workflow, restrições do Rhino (ES5), padrão visual e Gito.

Atalhos (tela inicial do chat ou `Ctrl+Shift+P`):

- **Novo widget Fluig** — pergunta código, título, namespace e objetivo.
- **Novo formulário Fluig** — pergunta título, prefixo e requisitos (campos, atividades, validações).
- **Novo dataset Fluig** — pergunta o nome e a origem dos dados.

Os atalhos **geram a estrutura padrão da Delp a partir de modelos embutidos** (nada é inventado pelo modelo) e só depois chamam o agente para implementar a regra de negócio:

| Atalho | O que é gerado |
| --- | --- |
| Widget | `wcm/widget/<código>/` completo (application.info, view.ftl, edit.ftl, 4 .properties, WEB-INF, Objects, Componentes, Permissoes, ds*, integreInicio, Controller, main.function, CSS com tokens Delp), `build-widget.js` na raiz e o dataset + SQL do widget |
| Formulário | `forms/000000 - <Título>/` com HTML padrão, eventos, core/dataset/mask/validator/app, CSS e readme (renomeie o `000000` para o documentId após publicar) |
| Dataset | `datasets/<nome>.js` (LISTAR/OBTER/SALVAR/EXCLUIR, PreparedStatement, erro como `ERRO:`) e `sql/01_CREATE_<TABELA>.sql` |

Arquivos que já existem nunca são sobrescritos. Depois de gerar um widget, rode `node build-widget.js` na raiz do projeto para criar o `.war`.

Pedindo direto no chat ("crie um widget de painel de obras"), o agente usa a ferramenta **`@gerar`** para criar a mesma estrutura antes de implementar — no chat aparece **🧱 Estrutura padrão gerada**.

Os arquivos gerados já vêm configurados: **datasource e base** detectados nos datasets do projeto (ou o padrão da equipe: `/jdbc/FluigDS` e `FLUIG.dbo.Z_DELP_...`) e **developer.code/developer.name** das widgets existentes (ou `DELP0216` e o usuário do Windows). Ajustáveis em `delpCopilot.fluig.*`.

**Instruções específicas do repositório**: crie um arquivo `DELP-COPILOT.md` na raiz do projeto com regras próprias (ex.: "datasets deste projeto usam o datasource X", "não alterar a pasta legado/"). Ele é enviado automaticamente.

## 6.1 Telas e gráficos (design)

Quando o pedido fala de **tela, painel, dashboard, gráfico, KPI, layout, CSS, cores** (ou traz um print), o agente recebe o **guia de design DELP**: forma certa para cada dado (KPI, barras, linha, rosca, tabela), paleta validada para daltonismo, marcas finas, estados de carregando/vazio/erro e acessibilidade.

- Todo widget gerado traz o **`chartHelper.js`** e o Chart.js em `lib/`. Os gráficos saem por `<ns>.grafico.barras(...)`, `linha(...)` e `rosca(...)`, sempre com legenda/rótulos, tooltip e o botão **Ver tabela**. Peça, por exemplo: *"adicione um gráfico de barras com o valor por unidade na aba Início"*.
- Cores: **Subsea, Indústria, Mooring, Serviços**, nessa ordem; no máximo 4 séries (o resto vira "Outros" em cinza); **Delp Red** só para destacar um item.
- **Revisão por print**: cole o print da tela (Ctrl+V) e escreva *"revise o design desta tela"*. O agente lista os problemas em ordem de impacto, cada um com a regra que quebra, e corrige o código.
- A validação automática devolve ao agente: cor fora da paleta, `style` inline, `new Chart` direto e `alert/confirm`. Problemas que já existiam no arquivo não são cobrados.
- **Widget antiga com gráfico "simplificado"**: o arquivo `resources/js/lib/chart.umd.min.js` provavelmente é um placeholder de poucos bytes. Peça ao agente para trazer o `chartHelper.js` e a biblioteca do modelo (ou copie de um widget recém-gerado) e declare-os no `application.info`.

## 7. Boas práticas

- Comece uma **nova conversa (+)** a cada tarefa diferente: o agente recebe o contexto do projeto de novo e o consumo cai.
- Seja específico: diga o arquivo, o comportamento esperado e o que não pode mudar.
- Revise o diff antes de aplicar, principalmente em datasets e workflows.
- Não cole dados pessoais (CPF, salários, dados bancários) nem credenciais no chat.
- Respostas de IA podem conter erros: teste em homologação antes de publicar no Fluig.

## 8. Atalhos de teclado

| Atalho | Ação |
| --- | --- |
| `Ctrl+Alt+C` | Abrir chat |
| `Ctrl+Alt+G` | Gerar código no cursor |
| `Ctrl+Alt+V` | Colar resposta (só no modo ponte manual `copilotWeb`) |
| `Enter` / `Shift+Enter` | Enviar / quebrar linha |
