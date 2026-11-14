# {{TITULO}} (formulário Fluig)

Formulário no padrão moderno DELP (referência: Gestão Operacional – Field Service). Criado em {{DATA}}.

> A pasta foi gerada como `{{FORM_FOLDER}}`. O `documentId` só existe depois da primeira publicação: após publicar, renomeie a pasta para `<documentId> - <Nome>` (o Fluig Studio cria o `.metadata`).

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `{{FORM}}.html` | Estrutura (BEM). Os `name` dos campos são lidos pelo workflow: **não renomear** depois de publicado. |
| `events/displayFields.js` | Servidor (Rhino/ES5): grava `ATIVIDADE`, `NUMPROCESSO`, `SOLICITANTE`, `EMAIL_SOLICITANTE`, `USUARIOATUAL`, `TYPEVIEW`. |
| `events/enableFields.js` | Servidor: `setEnhancedSecurityHiddenInputs(true)`. |
| `{{PX}}.core.js` | Namespace `{{PX_UPPER}}`, `Config` (atividades, datasets, seções, zooms), `Num`, `Data`, `Dom`, `Notify`, `log`. |
| `{{PX}}.dataset.js` | `DatasetGateway`: **único** ponto de acesso a datasets (síncrono, constraints `MUST`, trata `ERRO: `). |
| `{{PX}}.mask.js` | `MaskController`: `data-mask` = `inteiro`, `decimal`, `moeda` ou `percentual`. |
| `{{PX}}.validator.js` | `FormValidator`: `[required]` + regras de negócio, resumo agrupado em `FLUIGC.modal`. |
| `{{PX}}.app.js` | Controlador `App` e pontes globais do Fluig. |
| `{{PX}}.style.css` | Estilos BEM `{{PX}}-*`, tokens da paleta DELP em `.{{PX}}`. |

Ordem dos scripts no fim do `<form>`: **core → dataset → mask → validator → app**.

## Campos

| Campo (`id` = `name`) | Tipo | Seção | Observação |
|---|---|---|---|
| `ATIVIDADE` | hidden | controle | `WKNumState` (displayFields) |
| `NUMPROCESSO` | hidden | controle | `WKNumProces` |
| `SOLICITANTE` | hidden | controle | login do solicitante (atividades 0 e 4) |
| `EMAIL_SOLICITANTE` | hidden | controle | e-mail do solicitante (atividades 0 e 4) |
| `USUARIOATUAL` | hidden | controle | login de quem está com a tarefa |
| `TYPEVIEW` | hidden | controle | `1` = visualização, `0` = edição |
| `DATA_SOLICITACAO` | date (ISO) | Dados | obrigatório; padrão = hoje |
| `VALOR_ESTIMADO` | texto `moeda` | Dados | obrigatório |
| `CENTROCUSTO` | zoom | Dados | obrigatório; dataset `dsExemplo{{PX_UPPER}}` |
| `CODCCUSTO` | hidden | Dados | chave preenchida pelo zoom (`Config.ZOOMS`) |
| `DESCRICAO` | textarea | Dados | obrigatório |
| `ITEM_DESCRICAO` | texto | Itens (pai-filho `ITENS`) | obrigatório, `children` |
| `ITEM_QUANTIDADE` | texto `decimal` | Itens | obrigatório, `children` |
| `ITEM_VALOR` | texto `moeda` | Itens | obrigatório, `children` |
| `DECISAO_APROVACAO` | select | Aprovação | obrigatório na aprovação (`APROVADO`/`REPROVADO`) |
| `PARECER_APROVACAO` | textarea | Aprovação | obrigatório ao reprovar (regra em `app.registrarRegras`) |
| `APROVADOR` | hidden | Aprovação | login de quem aprovou (preenchido no envio) |

`viewTotalItens` é texto só exibido (sem `name`, não grava no card).
Filhos do pai-filho ficam como `CAMPO___<seq>`; no workflow use `hAPI.getChildrenIndexes("ITENS")`.

## Atividades

Definidas em `{{PX_UPPER}}.Config.ATIVIDADES` (`{{PX}}.core.js`). **Troque pelos códigos reais**: Fluig Studio → diagrama → atividade → Propriedades → Código.

| Constante | Código | Seções editáveis | Seções visíveis |
|---|---|---|---|
| `INICIO` | 0 | Dados, Itens | Dados, Itens |
| `ABERTURA` | 4 | Dados, Itens | Dados, Itens |
| `APROVACAO` | 5 | Aprovação | todas (Aprovação a partir daqui) |

As regras ficam em `Config.SECOES` (`editavelEm`, `visivelEm`). Campos de seções não editáveis são desabilitados no cliente e **reabilitados no `beforeSendValidate`** (campo `disabled` não é submetido).

## Datasets

| Constante | Dataset | Uso |
|---|---|---|
| `DATASETS.EXEMPLO` | `dsExemplo{{PX_UPPER}}` | zoom `CENTROCUSTO` (colunas `CODCCUSTO`, `DESCRICAO`) e `gateway.obterExemplo()` |

Troque pelo dataset real no `data-zoom` do HTML **e** em `Config.DATASETS`. Datasets devem seguir o padrão DELP (PreparedStatement, erro como linha `ERRO: `, sem credenciais). Dataset que grava em sistema ou trata dado pessoal passa por Governança e Compliance e pela TI.

## Pontes globais (não renomear)

`beforeSendValidate(numState, nextState)`, `setSelectedZoomItem(item)`, `removedZoomItem(item)`, `setZoomData(instance, value)`.

## Como adaptar

1. Ajuste `Config.ATIVIDADES`, `Config.SECOES`, `Config.DATASETS` e `Config.ZOOMS`.
2. Inclua campos no HTML com `id` = `name` em MAIÚSCULO, `aria-label` e, se numérico, `data-mask`. Obrigatório = atributo `required` (vale só quando o campo está habilitado e visível).
3. Regras além do obrigatório: `validador.adicionarRegra(fn)` em `app.registrarRegras`.
4. Consultas a dataset: um método novo em `DatasetGateway` (nunca `DatasetFactory` direto em outro arquivo).

## Como publicar

1. Fluig Studio: com o projeto aberto, clique com o botão direito na pasta do formulário → **Exportar** → servidor configurado → informe o processo/descrição e conclua.
2. Após a primeira exportação, renomeie a pasta com o `documentId` gerado e mantenha o `.metadata` criado pelo Studio.
3. Vincule o formulário ao processo no diagrama (Propriedades do processo → Formulário) e reexporte o processo.
4. Teste em homologação: abertura, aprovação, reprovação sem parecer (deve bloquear) e modo visualização.

## Depuração

No console do navegador: `localStorage.setItem('{{PX_UPPER}}_DEBUG','1')` liga os logs detalhados; `{{PX_UPPER}}.app` expõe a instância.

## Histórico

- v1.0 – {{DATA}} – criação
