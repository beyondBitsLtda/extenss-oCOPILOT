/* ============================================================================
 * Controller.js - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * ORQUESTRADOR da widget. Responsavel UNICO por:
 *   - boot (identidade do usuario -> permissoes -> aba inicial) com splash
 *   - qual aba esta visivel (show/hide por classe) e a topbar
 *   - delegacao de eventos na raiz (menu lateral e botoes de acao)
 *   - visibilidade de abas conforme {{NS}}.permissoes
 *   - tema (classe no raiz), tela cheia e "voltar ao menu do Fluig"
 *   - versao no rodape
 *   - chamada segura aos modulos ({{NS}}.integre.*)
 *
 * Convencoes de classe do {{NS}}.css:
 *   Abas         .{{NS}}-tab           + .{{NS}}-tab--ativa
 *   Menu lateral .{{NS}}-sidebar__link + .{{NS}}-sidebar__link--ativo
 *
 * Namespace: {{NS}}.Controller (instancia unica)
 * Ordem de carga: depois de todos os integre*.js, antes do main.function.js.
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
(function (global, $) {
    'use strict';

    var {{NS}} = global.{{NS}} = global.{{NS}} || {};
    var C = {{NS}}.componentes;
    var util = {{NS}}.util;

    /* Seletor do container raiz (classe = application.code). */
    var RAIZ = '.{{CODE}}';

    /* Aba onde a widget SEMPRE abre (se o papel puder acessar). */
    var ABA_INICIAL = 'inicio';

    /* ------------------------------------------------------------------
       SPLASH - nasce na marcacao (view.ftl), entao aparece antes de qualquer
       JS. Fica no minimo SPLASH_MIN_MS para nao piscar em boot rapido e sai
       sozinha em SPLASH_MAX_MS se algum passo do boot nunca responder.
       ------------------------------------------------------------------ */
    var SPLASH_MIN_MS = 1100;
    var SPLASH_MAX_MS = 30000;
    var CARREGADO_EM = new Date().getTime();

    var TEMAS = ['claro', 'escuro'];

    /* ------------------------------------------------------------------
       ABAS: id -> { modulo (chave em {{NS}}.integre), crumb, titulo }.
       A ordem e a de fallback quando a aba inicial e proibida ao papel.
       ------------------------------------------------------------------ */
    var ABAS = {
        inicio: { id: 'inicio', modulo: 'inicio', crumb: '{{TITULO}}', titulo: 'Início' }
    };

    /* ------------------------------------------------------------------
       BOTOES: data-attr -> [modulo, metodo]. '__CTRL__' = metodo deste
       Controller. E a rede de seguranca dos bindings do SuperWidget (caso o
       main.function.js nao instancie); os dois caminhos chamam o MESMO
       metodo e a guarda de 500 ms em executar() absorve o disparo duplo.
       ------------------------------------------------------------------ */
    var BOTOES = {
        '{{NS}}-recarregar':  ['__CTRL__', 'recarregar'],
        '{{NS}}-voltar-menu': ['__CTRL__', 'voltarAoMenu']
    };

    function Controller() {
        this._widget = null;
        this._$root = $();
        this._abaAtiva = '';
        this._iniciado = false;
        this._tema = 'claro';
        this._ultimaAcao = '';
        this._ultimaAcaoEm = 0;
    }

    /* ==================================================================
       BOOT
       ================================================================== */

    /** Idempotente: chamado pelo main.function.js e pelo auto-init. */
    Controller.prototype.iniciar = function (widget) {
        var self = this;
        if (widget) { self._widget = widget; }
        if (self._iniciado) { return true; }

        /* Escopa pelo container: o Fluig pode montar mais widgets na pagina. */
        self._$root = $(RAIZ).first();
        if (!self._$root.length) {
            util.aviso('Container ' + RAIZ + ' ainda nao esta no DOM.');
            return false;
        }
        self._iniciado = true;

        self._ativarTelaCheia();
        setTimeout(function () { self._fecharSplash(); }, SPLASH_MAX_MS);

        self._bindNavegacao();
        self._renderVersao();
        self._avisarModulosFaltantes();

        /* Enquanto os papeis nao chegam, a navegacao fica oculta: evita o
           instante em que todas as abas aparecem para todo mundo. */
        var $nav = self._$root.find('.{{NS}}-sidebar__nav').addClass('{{NS}}-invisivel');

        self._passoSplash('Identificando o usuário no Fluig...');
        self._identificar().always(function (usuario) {
            {{NS}}.usuario.definir(usuario);
            /* Papeis: plugue aqui a consulta ao dataset de usuarios da widget.
               Sem cadastro, a matriz aplica o PAPEL_PADRAO (Permissoes.js). */
            {{NS}}.permissoes.setPapeis([]);
            self._renderIdentidade();
            self._aplicarVisibilidadeAbas();
            $nav.removeClass('{{NS}}-invisivel');

            self._passoSplash('Carregando os dados...');
            var carga = self.trocarAba(self._abaInicial());
            $.when(carga).always(function () { self._fecharSplash(); });
        });

        util.log('Controller iniciado - v' + {{NS}}.VERSAO);
        return true;
    };

    Controller.prototype._abaInicial = function () {
        if ({{NS}}.permissoes.podeAcessar(ABA_INICIAL)) { return ABA_INICIAL; }
        var permitidas = this._abasDisponiveis();
        return permitidas.length ? permitidas[0] : ABA_INICIAL;
    };

    /* ------------------------------------------------------------------
       Identidade: WCMAPI.userCode (GUID) -> dataset nativo colleague.
       Assincrono e SEMPRE resolve (com fallback): identidade e so exibicao,
       o servidor usa getValue('WKUser').
       ------------------------------------------------------------------ */
    Controller.prototype._identificar = function () {
        var dfd = $.Deferred();
        var api = global.WCMAPI || {};
        var guid = '', loginApi = '', nomeApi = '';
        try {
            guid = String(api.userCode || '');
            loginApi = String(api.userLogin || '');
            nomeApi = String(api.user || '');
        } catch (e) { /* fora do Fluig */ }

        var fallback = { guid: guid, login: loginApi || guid, nome: nomeApi, email: '' };
        if (!guid) { dfd.resolve(fallback); return dfd.promise(); }

        {{NS}}.dataset.chamar({{NS}}.const.DATASET_COLLEAGUE, [{{NS}}.dataset.cs('colleaguePK.colleagueId', guid)])
            .done(function (linhas) {
                var l = (linhas && linhas.length) ? linhas[0] : {};
                dfd.resolve({
                    guid:  guid,
                    login: util.ou(l.login || l.LOGIN, fallback.login),
                    nome:  util.ou(l.colleagueName || l.COLLEAGUENAME, fallback.nome),
                    email: util.ou(l.mail || l.MAIL, '')
                });
            })
            .fail(function (err) {
                util.aviso('colleague indisponivel (' + (err && err.mensagem) + '); usando dados do WCMAPI.');
                dfd.resolve(fallback);
            });
        return dfd.promise();
    };

    Controller.prototype._renderIdentidade = function () {
        var $h = this._$root.find('[data-{{NS}}-container="usuario"]');
        $h.empty()
          .append($('<span class="{{NS}}-sidebar__usuario-nome"></span>').text({{NS}}.usuario.exibir()))
          .append($('<span class="{{NS}}-sidebar__usuario-papel"></span>').text({{NS}}.permissoes.papelPrincipal()));
    };

    Controller.prototype._renderVersao = function () {
        this._$root.find('[data-{{NS}}-container="versao"]').text('v' + {{NS}}.VERSAO);
    };

    /* ------------------------------------------------------------------
       Splash
       ------------------------------------------------------------------ */
    Controller.prototype._passoSplash = function (texto) {
        this._$root.find('[data-{{NS}}-splash-msg]').text(texto || '');
    };

    Controller.prototype._fecharSplash = function () {
        var $s = this._$root.find('[data-{{NS}}-splash]');
        if (!$s.length || $s.hasClass('{{NS}}-splash--saindo')) { return; }
        var espera = Math.max(0, SPLASH_MIN_MS - (new Date().getTime() - CARREGADO_EM));
        setTimeout(function () {
            $s.addClass('{{NS}}-splash--saindo');
            setTimeout(function () { $s.remove(); }, 520);
        }, espera);
    };

    /* ------------------------------------------------------------------
       Tela cheia. A classe ja vem na marcacao (sem piscar o layout); aqui
       fica o que o CSS sozinho nao resolve:
         1) travar a rolagem da pagina de fundo;
         2) levar modal/toast para o <body> (com os tokens), senao ficam
            presos no z-index do container;
         3) neutralizar ancestral com transform/filter/contain, que faria o
            position:fixed se prender a caixa do layout do Fluig.
       ------------------------------------------------------------------ */
    Controller.prototype._ativarTelaCheia = function () {
        var $root = this._$root;
        $root.addClass('{{NS}}--tela-cheia');
        $('html, body').addClass('{{NS}}-tela-cheia-ativa');

        $root.find('[data-{{NS}}-container="toast-host"], [data-{{NS}}-container="modal-host"]')
             .addClass(C.classesDeTokens())
             .appendTo(global.document.body);

        var el = $root[0].parentElement;
        while (el && el !== global.document.body && el !== global.document.documentElement) {
            var cs = global.getComputedStyle ? global.getComputedStyle(el) : null;
            if (cs && ((cs.transform && cs.transform !== 'none') ||
                       (cs.filter && cs.filter !== 'none') ||
                       (cs.perspective && cs.perspective !== 'none') ||
                       /paint|layout|strict|content/.test(cs.contain || ''))) {
                $(el).addClass('{{NS}}-tela-cheia-ancestral');
            }
            el = el.parentElement;
        }
    };

    /** Sai da widget e volta a home do tenant (/portal/p/<tenant>). */
    Controller.prototype.voltarAoMenu = function () {
        var destino = this._urlMenuFluig();
        if (destino) { global.location.href = destino; return; }
        if (global.history.length > 1) { global.history.back(); return; }
        C.Toast.info('Fora do Fluig não há menu para voltar.');
    };

    Controller.prototype._urlMenuFluig = function () {
        try {
            var api = global.WCMAPI;
            if (api && typeof api.getProtectedContextPath === 'function' &&
                typeof api.getTenantCode === 'function') {
                var ctx = api.getProtectedContextPath(), tenant = api.getTenantCode();
                if (ctx && tenant) { return ctx + '/' + tenant; }
            }
        } catch (e) { /* WCMAPI parcial: tenta pela URL */ }
        var m = String(global.location.pathname || '').match(/^(\/portal\/p\/[^\/]+)/);
        return m ? m[1] : '';
    };

    /* ==================================================================
       PERMISSOES NA UI
       ================================================================== */
    Controller.prototype._abasDisponiveis = function () {
        var lista = [];
        for (var id in ABAS) {
            if (ABAS.hasOwnProperty(id) && {{NS}}.permissoes.podeAcessar(id)) { lista.push(id); }
        }
        return lista;
    };

    Controller.prototype._aplicarVisibilidadeAbas = function () {
        this._$root.find('[data-{{NS}}-tab]').each(function () {
            var id = $(this).attr('data-{{NS}}-tab');
            $(this).toggleClass('{{NS}}-oculto', !{{NS}}.permissoes.podeAcessar(id));
        });
    };

    /* ==================================================================
       EVENTOS - delegacao na raiz (HTML criado depois tambem responde)
       ================================================================== */
    Controller.prototype._bindNavegacao = function () {
        var self = this, $root = self._$root;
        $root.off('.{{NS}}');

        $root.on('click.{{NS}}', '[data-{{NS}}-tab]', function (e) {
            e.preventDefault();
            self.trocarAba($(this).attr('data-{{NS}}-tab'));
        });

        $.each(BOTOES, function (attr, alvo) {
            $root.on('click.{{NS}}', '[data-' + attr + ']', function (e) {
                e.preventDefault();
                self.executar(alvo[0], alvo[1]);
            });
        });
    };

    /**
     * Ponto UNICO de chamada a modulo (SuperWidget e fallback passam aqui).
     * Guarda de disparo duplo: a MESMA acao repetida em 500 ms e ignorada.
     */
    Controller.prototype.executar = function (modulo, metodo) {
        var chave = modulo + '.' + metodo, agora = new Date().getTime();
        if (this._ultimaAcao === chave && (agora - this._ultimaAcaoEm) < 500) { return; }
        this._ultimaAcao = chave;
        this._ultimaAcaoEm = agora;

        var alvo = (modulo === '__CTRL__') ? this : ({{NS}}.integre && {{NS}}.integre[modulo]);
        if (!alvo || typeof alvo[metodo] !== 'function') {
            util.aviso('Modulo/metodo indisponivel: ' + chave);
            return;
        }
        try {
            alvo[metodo]();
        } catch (e) {
            util.erro('Falha em ' + chave, e);
            C.Toast.erro('Não foi possível executar a ação. Detalhes no console do navegador.');
        }
    };

    /* ==================================================================
       NAVEGACAO
       ================================================================== */

    /** Mostra a aba e delega ao modulo. Devolve o que o modulo devolver (promise). */
    Controller.prototype.trocarAba = function (destino) {
        var self = this, $root = self._$root;
        if (!destino || !ABAS[destino]) {
            util.aviso('Aba desconhecida: ' + destino);
            return null;
        }
        if (!{{NS}}.permissoes.podeAcessar(destino)) {
            var permitidas = self._abasDisponiveis();
            if (permitidas.length && permitidas[0] !== destino) { return self.trocarAba(permitidas[0]); }
            C.Toast.aviso('Seu perfil não tem acesso a este módulo.');
            return null;
        }

        var meta = ABAS[destino];
        self._abaAtiva = destino;

        $root.find('[data-{{NS}}-secao]').removeClass('{{NS}}-tab--ativa');
        $root.find('[data-{{NS}}-secao="' + destino + '"]').addClass('{{NS}}-tab--ativa');
        $root.find('[data-{{NS}}-tab]').removeClass('{{NS}}-sidebar__link--ativo').attr('aria-selected', 'false');
        $root.find('[data-{{NS}}-tab="' + destino + '"]').addClass('{{NS}}-sidebar__link--ativo').attr('aria-selected', 'true');
        $root.find('[data-{{NS}}-crumb]').text(meta.crumb || '');
        $root.find('[data-{{NS}}-titulo]').text(meta.titulo || '');

        var mod = {{NS}}.integre && {{NS}}.integre[meta.modulo];
        if (mod && typeof mod.aoAtivarAba === 'function') {
            try {
                return mod.aoAtivarAba(destino);
            } catch (e) {
                util.erro('Falha ao ativar ' + meta.modulo, e);
                C.Toast.erro('Erro ao abrir o módulo. Detalhes no console do navegador.');
            }
        }
        return null;
    };

    Controller.prototype.abaAtiva = function () { return this._abaAtiva; };

    /** Botao "Atualizar": recarrega a aba atual. */
    Controller.prototype.recarregar = function () {
        var meta = ABAS[this._abaAtiva];
        var mod = meta && {{NS}}.integre && {{NS}}.integre[meta.modulo];
        if (mod && typeof mod.recarregar === 'function') { return mod.recarregar(); }
        return this.trocarAba(this._abaAtiva || this._abaInicial());
    };

    /* ==================================================================
       TEMA
       ================================================================== */
    Controller.prototype.tema = function () { return this._tema; };

    Controller.prototype.aplicarTema = function (nome) {
        var tema = TEMAS.indexOf(nome) >= 0 ? nome : 'claro';
        var todas = $.map(TEMAS, function (t) { return '{{NS}}--tema-' + t; }).join(' ');
        this._tema = tema;
        this._$root.removeClass(todas).addClass('{{NS}}--tema-' + tema);
        $('.{{NS}}-tokens').removeClass(todas).addClass('{{NS}}--tema-' + tema);
        /* graficos desenham em canvas: precisam ser refeitos com as cores do novo tema */
        if ({{NS}}.grafico && {{NS}}.grafico.redesenhar) { {{NS}}.grafico.redesenhar(this._$root); }
    };

    /* ==================================================================
       CICLO DE VIDA / DIAGNOSTICO
       ================================================================== */

    /** Desfaz o boot (usado pelo destroy do SuperWidget). */
    Controller.prototype.destruir = function () {
        if (!this._iniciado) { return; }
        this._$root.off('.{{NS}}');
        $('html, body').removeClass('{{NS}}-tela-cheia-ativa');
        $('body > [data-{{NS}}-container="toast-host"], body > [data-{{NS}}-container="modal-host"]').remove();
        this._iniciado = false;
    };

    Controller.prototype._avisarModulosFaltantes = function () {
        var faltando = [];
        for (var id in ABAS) {
            if (ABAS.hasOwnProperty(id) && !({{NS}}.integre && {{NS}}.integre[ABAS[id].modulo])) {
                faltando.push(ABAS[id].modulo);
            }
        }
        if (faltando.length) {
            util.aviso('Modulos nao carregados: ' + faltando.join(', ') + ' - confira a ordem em application.info.');
        }
    };

    Controller.prototype.abas = function () { return ABAS; };

    /* ==================================================================
       Instancia unica + auto-init defensivo
       ================================================================== */
    {{NS}}.Controller = new Controller();

    /* O SuperWidget deveria chamar init(), mas dependendo da ordem/versao do
       Fluig isso pode nao acontecer. iniciar() e idempotente: tentar de novo
       nao duplica nada. Tenta a cada 250 ms, ate 40 vezes (~10 s). */
    function tentarInit() {
        if ({{NS}}.Controller._iniciado) { return true; }
        if (!$(RAIZ).length) { return false; }
        try {
            return {{NS}}.Controller.iniciar() === true;
        } catch (e) {
            util.erro('Falha no auto-init', e);
            return false;
        }
    }

    $(function () {
        if (tentarInit()) { return; }
        var tentativas = 0;
        var timer = setInterval(function () {
            tentativas++;
            if (tentarInit() || tentativas >= 40) {
                clearInterval(timer);
                if (!{{NS}}.Controller._iniciado) {
                    util.aviso('Auto-init desistiu apos 10 s: container ' + RAIZ + ' nao encontrado.');
                }
            }
        }, 250);
    });

}(window, jQuery));
