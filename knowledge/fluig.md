# Guia de arquitetura Fluig — DELP

Fonte: estudo dos repositórios da equipe (portalTestes, devToolsKit, painelTI, portalCapex, baseEps, pedido-de-compra, gestaooperacionalfs). Referências canônicas: **widget = portalTestes / devToolsKit**, **dataset = dsDevToolsCatalogo / dsBaseEps**, **formulário moderno = gestaooperacionalfs (GO)**, **formulário clássico = pedido-de-compra**, **workflow com integração = pedidoCompraCapex**.

## 0. Como aplicar este guia

1. **Artefato NOVO (widget, formulário ou dataset): gere a estrutura com `@gerar`** (`@gerar: widget <codigoCamelCase> [namespace]`, `@gerar: dataset <dsNome>`, `@gerar: formulario <prefixo> <Título>`). A extensão cria todos os arquivos do padrão (application.info, view.ftl, edit.ftl, .properties, WEB-INF, Objects/Componentes/Permissoes/ds*/integre*/Controller/main.function, CSS com tokens, build-widget.js, dataset + SQL). Nunca monte essa estrutura à mão nem invente outra (ex.: pastas `fluig-widget/`, `view/*.html`). Depois leia os arquivos gerados e implemente com blocos `editar`; novos módulos `integre*.js`/`ds*.js` são criados com `criar` e declarados no application.info.
2. O código existente no repositório aberto vence este guia em caso de diferença. Antes de criar algo, use `@listar`/`@buscar` para achar um artefato equivalente no repositório e siga o mesmo padrão (nomes, namespace, prefixo CSS, estrutura).
3. **Server-side é Rhino (ES5)**: datasets, eventos de formulário (`events/*.js`) e scripts de workflow. Sem `let`/`const`, arrow function, template literal, `class`, destructuring, vírgula final, `Array.from`, `includes`, `Object.assign`. Widgets também são ES5 por convenção da equipe.
4. **Nunca** escreva senha, token, connection string, host/IP ou e-mail de pessoa no código ou em dataset. Integrações usam o cadastro de serviço do Fluig (`serviceCode`) ou configuração protegida definida pela TI. Se o usuário pedir para fixar credencial, recuse e explique o risco (dataset é acessível por qualquer usuário logado via REST).
5. Comentários, nomes de funções e mensagens em **português**. Comentários de código sem acento (ASCII); textos de interface com acento.
6. Ao terminar trabalho que muda comportamento num repositório com `gito.json`/`GITO.md`, atualize o `gito.json` (seção 9).

## 1. Layout de um projeto Fluig (Fluig Studio / TDS)

```
<repo>/
├── .project                      (nature com.totvs.tds.ecm.designer.nature)
├── README.md, estrutura.md       (docs em PT-BR)
├── CLAUDE.md, GITO.md, gito.json (versionamento, quando existir)
├── build-widget.js               (empacotador Node sem dependencias -> .war)
├── datasets/                     ds*.js (publicados A PARTE do WAR; subpastas "DELP PROD"/"Delp homo" = copia por servidor)
├── sql/                          NN_VERBO_ASSUNTO.sql idempotentes + README.md
├── forms/<documentId> - <Nome>/  formulario (html, events/, js, css)
├── workflow/{diagrams,scripts,literals,.resources}
├── events/ mechanisms/ reports/  (normalmente vazias)
├── teste/harness/                testes de mesa em Node (sem Fluig)
└── wcm/widget/<applicationCode>/src/main/{resources,webapp}
```
Não há Maven/pom.xml. O nome do arquivo do dataset é o nome do dataset no Fluig (sensível a maiúsculas).

## 2. Widgets

### 2.1 Estrutura
```
wcm/widget/<code>/src/main/
├── resources/                         -> WEB-INF/classes/ no WAR
│   ├── application.info
│   ├── view.ftl
│   ├── edit.ftl
│   ├── <code>.properties  <code>_pt_BR.properties  <code>_en_US.properties  <code>_es.properties   (vazios, mas obrigatorios)
└── webapp/
    ├── WEB-INF/web.xml  WEB-INF/jboss-web.xml
    └── resources/
        ├── css/<ns>.css               (folha principal; extras com sufixo: <ns>-escuro.css, <ns>-mobile.css)
        ├── images/
        └── js/
            ├── lib/                   bibliotecas de terceiros locais (chart.umd.min.js, exceljs.min.js...)
            ├── Objects.js             namespace, wrapper UNICO de dataset, util, const, classes de dominio, VERSAO, store
            ├── Componentes.js         kit de UI proprio: Modal, Confirmacao, Toast, Tabela, Kpi, Badge, Spinner, Campo
            ├── Permissoes.js          matriz PAPEL x MODULO
            ├── chartHelper.js         graficos no padrao DELP (<ns>.grafico) - Chart.js com plano B
            ├── <lib>Helper.js         wrapper de outras libs com disponivel() + plano B
            ├── ds<NomeDataset>.js     camada de dados front (1 por dataset, mesmo nome do dataset)
            ├── integre<Tela>.js       regra de cada aba/tela
            ├── Controller.js          navegacao, boot, permissoes na UI, tema, splash, tela cheia
            └── main.function.js       SuperWidget: ponto unico de entrada (ULTIMO a carregar)
```
Nomes: `application.code` em camelCase (`portalTestes`); namespace JS curto minúsculo (`testes`); prefixo CSS e de `data-*` igual ao namespace (`testes-`, `data-testes-*`). Datasets `ds<App><Entidade>`; tabelas `Z_DELP_<APP>_<ENTIDADE>`.

### 2.2 application.info
```properties
application.type=widget
application.code=meuPainel
application.title=meuPainel
application.description=Painel X DELP - <o que faz>
application.category=SYSTEM
application.renderer=freemarker
developer.code=<CODIGO_DESENVOLVEDOR>
developer.name=<LOGIN_DESENVOLVEDOR>
developer.url=http://www.fluig.com
application.uiwidget=true
application.mobileapp=false
application.version=1.0.0
view.file=view.ftl
edit.file=edit.ftl
locale.file.base.name=meuPainel

# ORDEM DE CARGA = ORDEM DE DEPENDENCIA (numeracao continua, sem chave repetida)
# --- bibliotecas ---
application.resource.js.1=/resources/js/lib/chart.umd.min.js
# --- nucleo ---
application.resource.js.2=/resources/js/Objects.js
application.resource.js.3=/resources/js/Componentes.js
application.resource.js.4=/resources/js/Permissoes.js
# --- graficos (ponto unico, paleta DELP validada) ---
application.resource.js.5=/resources/js/chartHelper.js
# --- dados (front) ---
application.resource.js.6=/resources/js/dsMeuPainelDados.js
# --- telas ---
application.resource.js.7=/resources/js/integreVisaoGeral.js
# --- orquestracao ---
application.resource.js.8=/resources/js/Controller.js
application.resource.js.9=/resources/js/main.function.js
# --- estilos (overrides por ultimo) ---
application.resource.css.1=/resources/css/painel.css
```
Regras: todo .js/.css do WAR declarado aqui; chave duplicada faz a última vencer e o recurso some em silêncio; **subir `application.version` (e `<ns>.VERSAO` no Objects.js) a cada publicação** — js/css ficam em cache atrelado à versão, o view.ftl não.

### 2.3 view.ftl
```ftl
<#--
 view.ftl - Meu Painel DELP (widget meuPainel)
 Regras: ZERO CSS inline, ZERO dado mockado, nenhum onclick inline, nenhum <script>/<link>.
-->
<div class="painel meuPainel painel--tema-claro painel--tela-cheia"
     id="meuPainel_${instanceId!'0'}"
     data-params="meuPainel.instance()">
  <div class="painel-splash" data-painel-splash="true" role="status">Carregando...</div>
  <aside class="painel-sidebar">
    <a href="#" class="painel-sidebar__voltar" data-painel-voltar-menu="true">Voltar ao menu do Fluig</a>
    <div class="painel-sidebar__brand"><span class="painel-sidebar__logo-accent">delp</span>
      <div class="painel-sidebar__sub">Meu Painel</div></div>
    <nav class="painel-sidebar__nav" role="tablist">
      <a href="#" class="painel-sidebar__link painel-sidebar__link--ativo" role="tab" data-painel-tab="visao">
        <span class="painel-sidebar__ic" aria-hidden="true">VG</span><span class="painel-sidebar__label">Visao geral</span></a>
    </nav>
    <div class="painel-sidebar__foot"><div data-painel-container="usuario">Identificando...</div>TOTVS Fluig &middot; DELP</div>
  </aside>
  <div class="painel-main">
    <header class="painel-topbar">
      <div class="painel-topbar__crumb" data-painel-crumb="modulo">Painel</div>
      <h1 class="painel-topbar__titulo" data-painel-titulo="modulo">Visao geral</h1>
    </header>
    <main class="painel-conteudo">
      <section class="painel-tab painel-tab--ativa" role="tabpanel" data-painel-secao="visao">
        <div class="painel-toolbar"><div class="painel-toolbar__left"></div>
          <div class="painel-toolbar__right"><button type="button" class="painel-btn painel-btn--primary" data-painel-recarregar="true">Atualizar</button></div></div>
        <div data-painel-container="visao-kpis"><div class="painel-placeholder">Carregando...</div></div>
      </section>
    </main>
  </div>
  <div class="painel-modal-host" data-painel-container="modal-host" aria-hidden="true"></div>
  <div class="painel-toast-host" data-painel-container="toast-host" aria-live="polite"></div>
</div>
```
Única variável FreeMarker: `${instanceId!'0'}`. Contrato `data-*`: `data-<p>-tab`, `data-<p>-secao`, `data-<p>-container`, `data-<p>-<acao>="true"`. Containers nascem com placeholder "Carregando...".

`edit.ftl`: placeholder explicando que não há configuração por instância (configuração vive no banco/dataset). Nunca deixar o edit.ftl padrão do TDS (`MyWidget`).

`WEB-INF/jboss-web.xml`: `<jboss-web><context-root>/<code></context-root><disable-cross-context>false</disable-cross-context></jboss-web>`. `WEB-INF/web.xml`: web-app 3.0 com `session-timeout` 30.

### 2.4 main.function.js
```js
/* main.function.js - Meu Painel DELP. Ponto UNICO de entrada: delega ao Controller. */
var meuPainel = SuperWidget.extend({          // NOME IDENTICO ao application.code
    _iniciado: false,
    bindings: { local: { 'painel-recarregar': ['click_recarregar'] }, global: {} },
    init: function () {
        if (this._iniciado) return;
        try {
            if (typeof window.painel === 'undefined') {
                console.error('[meuPainel] window.painel indisponivel. Verifique a ordem em application.info.');
                return;
            }
            window.painel.Controller.iniciar(this);
            this._iniciado = true;
        } catch (e) { console.error('[meuPainel] Falha na inicializacao', e); }
    },
    recarregar: function (el, ev) { if (ev) ev.preventDefault(); window.painel.Controller.recarregar(); }
});
```
Se o nome do `var` divergir do `application.code`, a widget monta o HTML e nunca inicia, sem erro.

### 2.5 Módulos (IIFE + prototype)
```js
/* integreVisaoGeral.js - Meu Painel DELP. Namespace: painel.integre.visao */
(function (global, $) {
    'use strict';
    var painel = global.painel = global.painel || {};
    painel.integre = painel.integre || {};
    var C = painel.componentes, util = painel.util;

    function VisaoGeral() { this._ligado = false; }
    VisaoGeral.prototype.aoAtivarAba = function (aba) {
        if (aba && aba !== 'visao') return;
        this.render();
    };
    VisaoGeral.prototype._host = function (nome) {
        return $('[data-painel-container="' + nome + '"]').first();
    };
    VisaoGeral.prototype.render = function () {
        var self = this;
        painel.ds.dados.listarIndicadores({}, function (lista) {
            C.Kpi.preencher(self._host('visao-kpis'), lista);
        }, function (msg) { C.Toast.erro(msg); });
    };
    painel.integre.visao = new VisaoGeral();
}(window, jQuery));
```
Métodos padronizados: `aoAtivarAba`, `render*`, `abrir*`, `novo*`, `salvar*`, `excluir*`, `carregar`, `recarregar`; privados com `_`. Logs com prefixo `[painel.Modulo]`.

**Controller.js**: instância única; `iniciar(widget)` idempotente, escopado em `$('.<code>').first()`; navegação por **delegação de eventos na raiz** (`$root.on('click.painel', '[data-painel-tab]', ...)`), porque HTML criado depois não recebe binding do SuperWidget; tabelas declarativas `ABAS = { id: {modulo, crumb, titulo} }` e `BOTOES = { 'data-attr': ['modulo','metodo'] }` (fallback dos bindings); `executar(modulo, metodo)` com guarda contra disparo duplo (500 ms) e try/catch com Toast; boot encadeado (identidade -> preferências -> aba inicial) com splash; auto-init defensivo no fim (`$(function(){...})` tentando `iniciar()` a cada 250 ms até 40 vezes). Voltar ao Fluig: `WCMAPI.getProtectedContextPath() + '/' + WCMAPI.getTenantCode()`.

### 2.6 Acesso a dados na widget (REST assíncrono)
Endpoint único `POST /api/public/ecm/dataset/datasets`. Wrapper único no Objects.js:
```js
painel.dataset = {
    endpoint: '/api/public/ecm/dataset/datasets',
    cs: function (campo, valor) {                 // constraint REST: _finalValue = inicial, _type 0 (MUST)
        var v = (valor == null) ? '' : String(valor);
        return { _field: String(campo), _initialValue: v, _finalValue: v, _type: 0 };
    },
    chamarAsync: function (nome, constraints, onOk, onErro) {
        var self = this;
        $.ajax({
            url: self.endpoint, method: 'POST', contentType: 'application/json', dataType: 'json', timeout: 120000,
            data: JSON.stringify({ name: nome, constraints: constraints || [], fields: [], order: [] }),
            success: function (res) {
                var values = res && res.content && res.content.values;
                if (!$.isArray(values)) { onErro('Dataset ' + nome + ' indisponivel (nao publicado ou nao compilou).'); return; }
                var linhas = self.linhas(res);
                if (linhas.length === 1) {
                    var primeira = linhas[0][Object.keys(linhas[0])[0]];
                    if (String(primeira || '').indexOf('ERRO: ') === 0) { onErro(String(primeira)); return; }
                }
                onOk(linhas, res);
            },
            error: function (xhr) { onErro('HTTP ' + (xhr ? xhr.status : '?') + ' ao consultar ' + nome); }
        });
    },
    linhas: function (res) { /* normaliza values como array-de-objetos OU array-de-arrays + content.columns */ },
    resultado: function (linhas) { var l = linhas[0] || {}; return { ok: l.STATUS === 'OK', mensagem: l.MENSAGEM || '', id: l.ID || '' }; }
};
```
Camada `ds*.js` (1 por dataset) monta constraints `_ACAO` e devolve **objetos de domínio** (`X.deLinha(l)`); `integre*.js` nunca monta constraint nem conhece nome de coluna. Classes de domínio no Objects.js com `deLinha`, `validar()` (array de mensagens) e `paraConstraints()`.

Identidade: `WCMAPI.userCode` (GUID) resolvido no dataset nativo `colleague` (constraint `colleaguePK.colleagueId`). **Não** usar `DatasetFactory.getDataset` síncrono em fluxo de UI (trava a aba).

### 2.7 UI e CSS
- Kit de UI próprio (`Componentes.js`). Nunca `alert/confirm/prompt`; FLUIGC e classes do Style Guide (`btn btn-*`, `form-control`, `col-md-*`) não são usados nas widgets.
- CSS em **BEM com prefixo da widget** (`painel-sidebar__link--ativo`). Tokens em custom properties **no contêiner raiz, nunca em `:root`** (`.painel, .painel-tokens { --pn-red:#CC0F10; ... }`). Overlays no `<body>` recebem a classe `-tokens` e a do tema.
- Temas por classe no raiz (`.painel--tema-escuro`). Componentes não escrevem cor direta.
- `@import` da Barlow no topo do CSS; cabeçalho com sumário; responsivo no fim (`@media 1100/760/480px`), `prefers-reduced-motion`, `@media print`.
- Layout padrão: sidebar preta (~228px) com marca "delp" em vermelho, topbar (~58px) com crumb/título, abas em `<section>`, tela cheia por padrão com botão "Voltar ao menu do Fluig", splash de boot, versão no rodapé.
- Bibliotecas locais em `resources/js/lib` (nunca CDN em produção), sempre com `<x>Helper.js` e plano B (ExcelJS -> CSV UTF-8 com BOM e `;`; Chart.js -> barras HTML simples).
- **Gráficos só via `<ns>.grafico.barras/linha/rosca` (`chartHelper.js`, já no modelo do `@gerar: widget`)**; nunca `new Chart` direto nem cores à mão. `lib/chart.umd.min.js` deve ser o Chart.js v4 real (~200 KB): vários repositórios têm um placeholder de poucos bytes, que derruba os gráficos para o plano B. Regras visuais completas no guia de design DELP (enviado junto quando o assunto é tela/gráfico).
- Escapar todo texto vindo do banco (`util.esc` ou `.text()`).

### 2.8 Build e publicação
`node build-widget.js` na raiz (copie o de um repositório existente e ajuste `CODIGO`). Mapeia `resources/**` -> `WEB-INF/classes/`, `webapp/WEB-INF/**` -> `WEB-INF/`, `webapp/resources/**` -> `resources/`; gera `wcm/widget/<code>/target/<code>.war` e reprova: recurso declarado ausente, chave repetida, `SuperWidget` com nome diferente do code, caractere invisível, versão igual à anterior. Publicar sempre o WAR inteiro. Ordem de instalação: SQL -> datasets -> WAR -> conferir versão no rodapé (Ctrl+Shift+R). Datasets e SQL não vão no WAR.

## 3. Datasets (padrão moderno)

```js
/* =============================================================================
   dsMeuPainelDados.js - Dataset customizado (Rhino/ES5) - Meu Painel DELP
   Acoes (_ACAO): LISTAR (padrao) | OBTER (_ID) | SALVAR (_PAYLOAD JSON) | EXCLUIR (_ID, logica)
   Contrato: escrita devolve STATUS ('OK'|'ERRO') | MENSAGEM | ID. Erro de leitura: 1 linha com 'ERRO: ...' na 1a coluna.
   v1.0 - DD/MM/AAAA - criacao
============================================================================= */
var JNDI_DATASOURCE = '/jdbc/FluigDS';      /* padrao da equipe para tabelas Z_DELP_ (base FLUIG); RM: /jdbc/FluigDSRM */
var QUERY_TIMEOUT   = 30;
var TAB             = 'FLUIG.dbo.Z_DELP_PAINEL_INDICADOR';
var COLS_LISTAR     = ['ID', 'CODIGO', 'NOME', 'VALOR', 'ATIVO'];
var COLS_STATUS     = ['STATUS', 'MENSAGEM', 'ID'];

function createDataset(fields, constraints, sortFields) {
    var acao = String(_get(constraints, '_ACAO', '')).toUpperCase();
    var conn = null;
    try {
        conn = _openConnection();
        if (acao === 'LISTAR')  return _listar(conn, constraints);
        if (acao === 'SALVAR')  return _salvar(conn, constraints);
        return _erro(COLS_STATUS, 'Acao desconhecida: ' + acao);
    } catch (e) {
        log.error('[dsMeuPainelDados] ' + (e.message || e));
        return _erro(acao === 'LISTAR' ? COLS_LISTAR : COLS_STATUS, 'ERRO: ' + (e.message || e));
    } finally {
        try { if (conn) conn.close(); } catch (ex) {}
    }
}

function _listar(conn, constraints) {
    var ds = _dsCom(COLS_LISTAR), params = [];
    var sql = 'SELECT ' + COLS_LISTAR.join(', ') + ' FROM ' + TAB + ' WHERE ATIVO = 1';
    var codigo = _get(constraints, 'CODIGO', '');
    if (codigo) { sql += ' AND CODIGO = ?'; params.push(codigo); }
    var pstmt = conn.prepareStatement(sql + ' ORDER BY NOME');
    pstmt.setQueryTimeout(QUERY_TIMEOUT);
    for (var p = 0; p < params.length; p++) pstmt.setString(p + 1, params[p]);
    var rs = pstmt.executeQuery();
    while (rs.next()) ds.addRow(_linha(rs, COLS_LISTAR));
    _fechar(rs, pstmt);
    return ds;
}

/* constraint por metodo (REST) com fallback para propriedades */
function _get(constraints, name, defVal) {
    if (!constraints || !constraints.length) return defVal;
    for (var i = 0; i < constraints.length; i++) {
        var c = constraints[i], campo = null, valor = null;
        try { campo = String(c.getFieldName()); valor = c.getInitialValue(); } catch (e) {
            campo = String(c.fieldName || c._field); valor = (c.initialValue !== undefined) ? c.initialValue : c._initialValue;
        }
        if (campo === name) return (valor == null) ? defVal : String(valor);
    }
    return defVal;
}
function _getUser() { try { var u = getValue('WKUser'); if (u) return String(u); } catch (e) {} return 'sistema'; }
function _openConnection() { return new javax.naming.InitialContext().lookup(JNDI_DATASOURCE).getConnection(); }
function _dsCom(cols) { var ds = DatasetBuilder.newDataset(); for (var c = 0; c < cols.length; c++) ds.addColumn(cols[c]); return ds; }
function _linha(rs, cols) { var r = []; for (var i = 0; i < cols.length; i++) r.push(_txt(rs.getObject(cols[i]))); return r; }
function _txt(v) { return (v == null) ? '' : String(v); }
function _fechar(rs, st) { try { if (rs) rs.close(); } catch (e) {} try { if (st) st.close(); } catch (e) {} }
function _erro(cols, msg) { var ds = _dsCom(cols), r = [msg]; for (var i = 1; i < cols.length; i++) r.push(''); ds.addRow(r); return ds; }
function defineStructure() {} function onSync(lastSyncDate) {} function onMobileSync(user) {}   /* exigidos, sem uso */
```
Regras:
- Um dataset por domínio com várias ações via `_ACAO` (MAIUSCULO_SNAKE: `LISTAR_*`, `SALVAR_*` — insere sem `_ID`, atualiza com —, `EXCLUIR_*` lógico com `ATIVO=0`, `OBTER`). `_ACAO` vazia/desconhecida devolve ERRO (nunca ação padrão silenciosa). Constraints de controle com prefixo `_` (`_ID`, `_PAYLOAD`, `_PAGINA`, `_INCLUIR_INATIVOS='1'`).
- Colunas declaradas explicitamente na ordem do SELECT; nulo vira `''`.
- **Sempre `PreparedStatement`** — nunca concatenar valor (nem nome de coluna vindo do cliente) no SQL; `IN (...)` com placeholders; `setNull(i, java.sql.Types.X)` para vazio; dinheiro com `java.math.BigDecimal`; datas com `java.sql.Date.valueOf('AAAA-MM-DD')`; `RETURN_GENERATED_KEYS` para obter ID.
- Transação em operações compostas: `conn.setAutoCommit(false)` + `commit`/`rollback`.
- Auditoria `RECCREATEDBY/RECCREATEDON/RECMODIFIEDBY/RECMODIFIEDON` com `SYSDATETIME()` e usuário de `getValue('WKUser')` — **o usuário nunca vem do front**. Revalidar papel/permissão no servidor (esconder no front não é controle).
- Paginação SQL Server: `OFFSET ? ROWS FETCH NEXT ? ROWS ONLY` pedindo PAGE_SIZE+1 para `TEM_MAIS`. Leituras no RM com `WITH (NOLOCK)` e `CODCOLIGADA = 1`.
- Zoom: o dataset deve ignorar `sqlLimit` e tratar a busca com LIKE parametrizado.
- Log com prefixo `[dsNome]`; nunca logar senha, CPF, salário ou e-mail.
- Integração REST com TOTVS RM: `fluigAPI.getAuthorizeClientService().invoke(JSONUtil.toJSON({companyId:'01', serviceCode:'<SERVICO_RM>', endpoint:'api/...', method:'get', timeoutService:'90000', params:{}, headers:{}}))`; `JSON.parse(String(vo.getResult()))`; `status == 1` = erro do RM (`statusMessage`).
- Não copiar o legado (`createStatement` com concatenação, `"null"` como texto, colunas só quando há linha, erros engolidos, executores genéricos de SQL, credenciais no código).
- SQL de tabelas próprias em `sql/NN_CREATE_*.sql` idempotente (`IF OBJECT_ID('...','U') IS NULL BEGIN CREATE TABLE ... END`), `NVARCHAR`, `DATETIME2(0)` com default `SYSDATETIME()`, constraints nomeadas (`PK_`, `DF_`, `CK_`), configuração em `Z_DELP_<APP>_CONFIG` (chave/valor). SGBD: SQL Server.
- Teste de mesa opcional em `teste/harness/` (Node, dublês de `DatasetBuilder`, `log` e constraints).

## 4. Formulários

Recomendado para novos: **padrão moderno (GO)** — módulos POO, BEM com prefixo, paleta Delp, `<meta name="viewport">`, `aria-label`, botões `type="button"`. O clássico (pedido-de-compra) segue válido para manutenção.

### 4.1 Estrutura
```
forms/<documentId> - <Nome>/
├── <nome>.html                 (arquivo principal)
├── events/displayFields.js     events/enableFields.js
├── <px>.core.js                namespace, Config (datasets, ATIVIDADES), Num, Data, Dom, Notify
├── <px>.dataset.js             gateway UNICO de datasets
├── <px>.validator.js           validacao com resumo de erros
├── <px>.app.js                 controlador + "pontes" globais do Fluig (ULTIMO)
├── <px>.style.css
└── readme.md  changelog.md
```
Clássico: `utils.js`, `documentReady.js`, `selectZoom.js`, `beforeSendValidate.js`, `globals.js`, `style.css` (planos na pasta; referenciar por nome direto). Testes ficam fora da pasta do formulário.

### 4.2 HTML
```html
<link type="text/css" rel="stylesheet" href="/portal/resources/style-guide/css/fluig-style-guide.min.css"/>
<script src="/portal/resources/js/jquery/jquery.js"></script>
<script src="/portal/resources/js/jquery/jquery-ui.min.js"></script>
<script src="/portal/resources/js/mustache/mustache-min.js"></script>
<script src="/portal/resources/style-guide/js/fluig-style-guide.min.js" charset="utf-8"></script>
<script src="/webdesk/vcXMLRPC.js"></script>
<link rel="stylesheet" type="text/css" href="<px>.style.css">
...
<body><div class="fluig-style-guide"><form name="form" role="form">
  <!-- CAMPOS OCULTOS DE CONTROLE (nao renomear: lidos por eventos/workflow) -->
  <input type="hidden" id="ATIVIDADE" name="ATIVIDADE">
  <input type="hidden" id="NUMPROCESSO" name="NUMPROCESSO">
  <input type="hidden" id="SOLICITANTE" name="SOLICITANTE">
  <input type="hidden" id="USUARIOATUAL" name="USUARIOATUAL">
  <input type="hidden" id="TYPEVIEW" name="TYPEVIEW">
  ...
</form></div></body>
```
- `id` sempre igual a `name`; nomes em MAIÚSCULO sem acento, reaproveitando nomes de colunas do RM (`CODCOLIGADA`, `IDPRJ`, `CODTMV`, `IDPRD`...). Cada `name` aparece **uma única vez** (hidden + select com mesmo nome quebra a exportação).
- Texto só exibido: `<p class="form-control-static" id="viewX">` **sem name**.
- Atributos de convenção: `required` (obrigatório na atividade do emissor), `required2` (outro grupo), `children` (campo de pai-filho), `disabled2`, `data-mask="inteiro|decimal|percentual"`.

**Zoom** (sempre zoom visível + hidden com as chaves):
```html
<input required type="zoom" class="form-control" id="PROJETO" name="PROJETO" placeholder="Selecione o projeto"
  data-zoom="{'displayKey':'DESCRICAO','datasetId':'dsMeusProjetos','maximumSelectionLength':'1',
              'fields':[{'field':'DESCRICAO','label':'Codigo - Nome','standard':'true','search':'true'}]}">
<input type="hidden" id="IDPRJ" name="IDPRJ">
```
Filtro dinâmico: `reloadZoomFilterValues("CAMPO", "IDPRJ," + valor)` (pares campo,valor).

**Pai-filho** (sempre botões próprios; 1ª linha do tbody é o template):
```html
<table tablename="ITENS" id="ITENS" class="table table-striped" nodeletebutton="true" noaddbutton="true">
  <thead><tr><th><button type="button" class="..." onclick="adicionarItem()">+</button></th><th>Produto</th><th>Qtd</th></tr></thead>
  <tbody><tr>
    <td><button type="button" onclick="fnWdkRemoveChild(this)">x</button></td>
    <td><input required children type="text" class="form-control" id="PRODUTO" name="PRODUTO"></td>
    <td><input required children type="text" class="form-control" id="QTD" name="QTD" data-mask="decimal"></td>
  </tr></tbody>
</table>
```
Cliente: `var seq = wdkAddChild('ITENS')`; filhos são `CAMPO___<seq>`; iterar com `$("input[id^='QTD___']")`.

### 4.3 Eventos (server-side, ES5)
Só `displayFields` e `enableFields` são usados; validação é no cliente (`beforeSendValidate`).
```js
function displayFields(form, customHTML) {
    var atv = getValue("WKNumState");
    form.setValue("ATIVIDADE", atv);
    form.setValue("NUMPROCESSO", getValue("WKNumProces"));
    var usuario = fluigAPI.getUserService().getCurrent().getLogin();
    if (atv == 0 || atv == 4) { form.setValue("SOLICITANTE", usuario); }
    form.setValue("USUARIOATUAL", usuario);
    if (form.getFormMode() == "VIEW") { form.setShowDisabledFields(true); form.setValue("TYPEVIEW", 1); }
    else { form.setValue("TYPEVIEW", 0); }
}
function enableFields(form) { form.setEnhancedSecurityHiddenInputs(true); }
```
Nunca usar DOM (`document`, `$`) em evento de servidor.

### 4.4 Cliente
- Atividade lida do hidden `#ATIVIDADE` via predicados (`function atividadeAprovacao(){ return $("#ATIVIDADE").val() == 10; }`) ou `Config.ATIVIDADES`.
- Pontes globais obrigatórias:
```js
window.beforeSendValidate = function (numState, nextState) { return app.validarEnvio(numState, nextState); };
window.setSelectedZoomItem = function (item) { app.aoSelecionarZoom(item); };   /* item.inputId identifica o campo */
window.removedZoomItem = function (item) { app.aoRemoverZoom(item); };
```
- `beforeSendValidate` devolve `true`/`false`: valida `[required]` (em pai-filho só ids com `___`), mostra erro (Toast/modal agrupado), destaca e rola até o 1º campo; no fim **reabilita campos `[disabled]`** (disabled não é submetido).
- Campo usado por mecanismo de atribuição deve receber o **USER_CODE (GUID)**, preenchido antes do envio.

## 5. Workflow

- Scripts em `workflow/scripts/<processId>.<evento>.js` (processId em camelCase). Eventos usados: `beforeTaskSave(colleagueId, nextSequenceId, userList)` (principal), `afterTaskSave`, `beforeStateEntry(sequenceId)`, `afterProcessCreate(processId)`, `beforeCancelProcess` (`throw 'msg'` bloqueia), `servicetaskN(attempt, message)`.
- Constantes de atividade no topo: `var SEQ_APROVACAO = 25; /* task25 - onde achar: Studio -> atividade -> Propriedades -> Codigo */`.
- APIs: `getValue("WKNumState"|"WKNumProces"|"WKUser")`, `hAPI.getCardValue/setCardValue` (sempre `String(...)`), `hAPI.getChildrenIndexes("TABELA")` + `"CAMPO___" + idx`.
- **Service task**: `return true` = sucesso; `throw` desvia para o evento de erro de borda (tarefa "Verificar erro" do grupo TI); `return false` não desvia. Antes de lançar, grave diagnóstico no cartão (`obs_integracao`, `MENSAGEM_ERRO`, `TENTATIVAS` com 2 dígitos).
- Idempotência de integração: trava no cartão (ex.: `IDMOV_RM` preenchido) e no banco; timeout = verificar manualmente, nunca reprocessar automático.
- Datasets como serviço: constraints montadas com `new Array(c1, c2)` (não `[]`) e `DatasetFactory.createConstraint(campo, String(v), String(v), ConstraintType.MUST)`.
- E-mail: dataset de envio da equipe (ex.: `dsEnviaEmail`) com destinatários resolvidos por `colleague`/`colleagueGroup`; falha de e-mail não derruba a solicitação; links com `fluigAPI.getPageService().getServerURL()`.
- Gateways: inicialize campos usados na expressão (campo inexistente trava o processo); funções chamadas por expressão devem ser globais no script; evite `<`/`&` na expressão.
- Mecanismos de atribuição: configurados no diagrama (grupo, usuário, campo de formulário com USER_CODE, associado com fallback). Campo vazio gera `BPMUserResponsibleNotInformedException`.
- O nome `servicetaskN.js` precisa bater com o número da atividade no diagrama; uma definição por evento por arquivo.

## 6. Armadilhas do Rhino

- Valores Java (`hAPI.getCardValue`, `ds.getValue`, `rs.getObject`) são `java.lang.String` (`typeof 'object'`): sempre `String(v)` antes de comparar/serializar/usar regex.
- Em **service task assíncrona** não existem `JSON` nem `JSONUtil`: use serializador próprio (`_toJson`/`_parseJson`).
- Constraints server-side: `new Array(...)`.
- Sem palavra reservada como propriedade após ponto (`obj.default`, `obj.class`).
- Caracteres invisíveis (BOM no meio, zero-width) quebram a compilação sem erro: o dataset passa a responder `content: {}`. Escreva `\uFEFF` como escape.
- Datas: `new java.text.SimpleDateFormat('dd/MM/yyyy HH:mm').format(new java.util.Date())`; SQL Server `CONVERT(VARCHAR(10), X, 120)`.

## 7. Padrão visual DELP

Barlow (fallback Inter, system-ui). Delp Red `#CC0F10` só para destaques/CTAs (nunca fundo de bloco de texto). Neutros `#B0B0B0`, `#EAE5DF`, `#000000`, `#FFFFFF`. Unidades: Subsea `#2362D3`, Indústria `#FF6B05`, Serviços `#0B861D`, Mooring `#213D75`. Semântica: ok = Serviços, aviso = Indústria, erro = Red, info = Subsea. Gráficos: cores das unidades primeiro, depois neutros; contraste WCAG AA.

## 8. Segurança e governança

- Nada de credenciais, hosts, IPs ou e-mails fixos no código, em dataset ou no `gito.json`. URL do servidor via `WCMAPI.serverURL` / `fluigAPI.getPageService().getServerURL()` ou dataset de configuração.
- Datasets são chamáveis por qualquer usuário logado: valide permissão no servidor e nunca crie "executor genérico" de SQL.
- LGPD: não logar nem expor CPF, salário, dados bancários; preferir identificadores internos.
- Dataset que escreve no RM, inicia processo ou trata dado pessoal exige avaliação de Governança e Compliance e da TI.

## 9. Versionamento (quando o repositório tiver gito.json/GITO.md)

Toda mudança de comportamento atualiza o `gito.json` no mesmo trabalho: SemVer (MAIOR quebra, MENOR funcionalidade, CORREÇÃO bug; só docs/testes não sobe); na `main` versão sem sufixo, em outras branches `<proxima>-<branch-normalizada>.<n>`; `compilacao.numero` +1 (nunca volta); nova entrada **no topo** de `historico` (`versao, data, branch, tipo, resumo, itens, issues`); nunca apagar entradas; JSON válido; sem credenciais. Issues em `.gito/issues/` vão para `em-revisao` (nunca `concluida`).

## 10. Checklists

**Widget nova**: estrutura de pastas (2.1) -> application.info com ordem comentada -> view.ftl (raiz `.<ns> .<code>`, `id="<code>_${instanceId!'0'}"`, `data-params`, splash, sidebar, topbar, sections, hosts) -> edit.ftl placeholder -> 4 `.properties` vazios -> WEB-INF -> JS (Objects, Componentes, Permissoes, ds*, integre*, Controller, main.function) -> CSS com tokens no raiz -> build-widget.js -> datasets + SQL -> README/estrutura.md.

**Formulário novo**: pasta `<documentId> - <Nome>` -> HTML com cabeçalho padrão e hidden de controle -> events/displayFields + enableFields -> módulos JS (core, dataset, validator, app) com pontes globais -> CSS BEM Delp -> scripts de workflow e constantes de atividade -> readme/changelog.

**Dataset novo**: cabeçalho com ações/contrato/changelog -> constantes -> despachante `_ACAO` -> PreparedStatement -> erro como linha `ERRO: ` -> `finally` fecha conexão -> SQL idempotente -> camada `ds*.js` no front -> exemplo de consumo.
