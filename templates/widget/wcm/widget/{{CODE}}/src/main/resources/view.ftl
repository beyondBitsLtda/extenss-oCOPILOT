<#--
============================================================================
 view.ftl - {{TITULO}} DELP  (widget {{CODE}} v1.0.0)
============================================================================
 Estrutura da view:
   - .{{NS}}.{{CODE}}          -> container raiz (recebe tema e tela cheia)
   - aside.{{NS}}-sidebar      -> navegacao (data-{{NS}}-tab="<aba>")
   - .{{NS}}-main              -> topbar + conteudo
   - section[data-{{NS}}-secao="<aba>"]       -> uma por aba, escondida por CSS
   - div[data-{{NS}}-container="<nome>"]      -> ponto de entrada de cada modulo
   - hosts de modal e toast    -> o Controller move para o <body> no boot

 Regras respeitadas:
   - ZERO CSS inline: toda aparencia vem de /resources/css/{{NS}}.css
   - ZERO dado mockado: todos os containers nascem com placeholder
   - Nenhum onclick inline e nenhum <script>/<link>: os botoes usam data-*
     e o SuperWidget/Controller faz o binding (main.function.js/Controller.js)
   - Unica variavel FreeMarker: instanceId
   - Nova aba: link data-{{NS}}-tab + section data-{{NS}}-secao com o mesmo id,
     entrada em ABAS (Controller.js) e na MATRIZ (Permissoes.js)
============================================================================
-->
<div class="{{NS}} {{CODE}} {{NS}}--tema-claro {{NS}}--tela-cheia" id="{{CODE}}_${instanceId!'0'}" data-params="{{CODE}}.instance()">

    <#-- Tela de carregamento: nasce com a pagina (antes de qualquer JS) e o
         Controller a remove quando o boot termina. -->
    <div class="{{NS}}-splash" data-{{NS}}-splash="true" role="status" aria-live="polite">
        <div class="{{NS}}-splash__centro">
            <div class="{{NS}}-splash__marca">
                <span class="{{NS}}-splash__logo">delp</span>
                <span class="{{NS}}-splash__divisor" aria-hidden="true"></span>
                <span class="{{NS}}-splash__produto">{{TITULO}}</span>
            </div>
            <div class="{{NS}}-splash__trilha" aria-hidden="true">
                <div class="{{NS}}-splash__progresso"></div>
            </div>
            <div class="{{NS}}-splash__msg" data-{{NS}}-splash-msg="true">Preparando o ambiente...</div>
        </div>
        <div class="{{NS}}-splash__rodape">TOTVS Fluig &middot; DELP</div>
    </div>

    <#-- ==================================================================== -->
    <#-- SIDEBAR                                                              -->
    <#-- ==================================================================== -->
    <aside class="{{NS}}-sidebar">
        <a href="#" class="{{NS}}-sidebar__voltar" data-{{NS}}-voltar-menu="true"
           title="Sair de {{TITULO}} e voltar ao menu do Fluig">
            <span class="{{NS}}-sidebar__voltar-ic" aria-hidden="true">&larr;</span>
            <span>Voltar ao menu do Fluig</span>
        </a>

        <div class="{{NS}}-sidebar__brand">
            <div class="{{NS}}-sidebar__logo"><span class="{{NS}}-sidebar__logo-accent">delp</span></div>
            <div class="{{NS}}-sidebar__sub">{{TITULO}}</div>
        </div>

        <nav class="{{NS}}-sidebar__nav" role="tablist" aria-label="Módulos de {{TITULO}}">
            <a href="#" class="{{NS}}-sidebar__link {{NS}}-sidebar__link--ativo"
               role="tab" data-{{NS}}-tab="inicio">
                <span class="{{NS}}-sidebar__ic" aria-hidden="true">IN</span>
                <span class="{{NS}}-sidebar__label">Início</span>
            </a>
        </nav>

        <div class="{{NS}}-sidebar__foot">
            <div class="{{NS}}-sidebar__usuario" data-{{NS}}-container="usuario">
                <span class="{{NS}}-sidebar__usuario-nome">Identificando...</span>
            </div>
            <div class="{{NS}}-sidebar__versao">
                TOTVS Fluig &middot; DELP &middot; <span data-{{NS}}-container="versao">v-</span>
            </div>
        </div>
    </aside>

    <#-- ==================================================================== -->
    <#-- MAIN                                                                 -->
    <#-- ==================================================================== -->
    <div class="{{NS}}-main">

        <header class="{{NS}}-topbar">
            <div class="{{NS}}-topbar__textos">
                <div class="{{NS}}-topbar__crumb" data-{{NS}}-crumb="modulo">{{TITULO}}</div>
                <h1 class="{{NS}}-topbar__titulo" data-{{NS}}-titulo="modulo">Início</h1>
            </div>
        </header>

        <main class="{{NS}}-conteudo">

            <#-- ---------------- ABA: INICIO ---------------- -->
            <section class="{{NS}}-tab {{NS}}-tab--ativa" role="tabpanel" data-{{NS}}-secao="inicio">
                <div class="{{NS}}-toolbar">
                    <div class="{{NS}}-toolbar__left">
                        <span class="{{NS}}-toolbar__info" data-{{NS}}-container="inicio-resumo"></span>
                    </div>
                    <div class="{{NS}}-toolbar__right">
                        <button type="button" class="{{NS}}-btn {{NS}}-btn--primary" data-{{NS}}-recarregar="true">Atualizar</button>
                    </div>
                </div>

                <div class="{{NS}}-kpis" data-{{NS}}-container="inicio-kpis">
                    <div class="{{NS}}-placeholder">Carregando...</div>
                </div>

                <div class="{{NS}}-card">
                    <div class="{{NS}}-card__cab">
                        <h2 class="{{NS}}-card__titulo">Maiores valores</h2>
                    </div>
                    <div class="{{NS}}-card__corpo" data-{{NS}}-container="inicio-grafico">
                        <div class="{{NS}}-placeholder">Carregando...</div>
                    </div>
                </div>

                <div class="{{NS}}-card">
                    <div class="{{NS}}-card__cab">
                        <h2 class="{{NS}}-card__titulo">Registros</h2>
                    </div>
                    <div class="{{NS}}-card__corpo" data-{{NS}}-container="inicio-lista">
                        <div class="{{NS}}-placeholder">Carregando...</div>
                    </div>
                </div>
            </section>

        </main>
    </div>

    <#-- Hosts de overlay: o Controller os move para o <body> (tela cheia). -->
    <div class="{{NS}}-modal-host" data-{{NS}}-container="modal-host" aria-hidden="true"></div>
    <div class="{{NS}}-toast-host" data-{{NS}}-container="toast-host" aria-live="polite"></div>
</div>
