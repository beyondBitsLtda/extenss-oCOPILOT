/**
 * =============================================================================
 * {{TITULO}} - {{PX}}.app.js
 * -----------------------------------------------------------------------------
 * App: controlador do formulario. ULTIMO script carregado.
 *
 * Fluxo:
 *   1. boot()  -> le #ATIVIDADE e #TYPEVIEW, liga mascaras e botoes, aplica a
 *                 visibilidade/edicao das secoes conforme a atividade
 *   2. Zoom    -> setSelectedZoomItem / removedZoomItem preenchem/limpam os hidden
 *                 de chave definidos em {{PX_UPPER}}.Config.ZOOMS
 *   3. Envio   -> beforeSendValidate(numState, nextState): valida e, se ok,
 *                 reabilita os campos [disabled] (disabled nao e submetido)
 *
 * Pontes globais (contrato com o Fluig - nao renomear):
 *   beforeSendValidate, setSelectedZoomItem, removedZoomItem, setZoomData
 *
 * Botoes do pai-filho: type="button" com data-acao="adicionar-linha|remover-linha"
 * e data-tabela="<tablename>" (eventos delegados; valem para linhas novas).
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
(function (global) {
    'use strict';

    var {{PX_UPPER}} = global.{{PX_UPPER}};
    var Config = {{PX_UPPER}}.Config;
    var Dom = {{PX_UPPER}}.Dom;
    var ATV = Config.ATIVIDADES;
    var SELETOR_EDITAVEIS = 'input:not([type="hidden"]), select, textarea';

    function contem(lista, valor) { return lista.indexOf(String(valor)) >= 0; }

    function App() {
        this.form = document.querySelector('form[name="form"]');
        this.gateway = new {{PX_UPPER}}.DatasetGateway();
        this.mascaras = new {{PX_UPPER}}.MaskController(document);
        this.validador = new {{PX_UPPER}}.FormValidator(this.form);
        this.atividade = '';
        this.modoVisualizacao = false;
    }

    // ------------------------------------------------------------ predicados de atividade

    App.prototype.atividadePreenchimento = function () { return contem(Config.ATIVIDADES_PREENCHIMENTO, this.atividade); };
    App.prototype.atividadeAprovacao = function () { return this.atividade === ATV.APROVACAO; };

    // ------------------------------------------------------------ inicializacao

    App.prototype.boot = function () {
        /* #ATIVIDADE vem do displayFields; vazio = formulario aberto fora do processo (inicio) */
        this.atividade = Dom.valor('ATIVIDADE') || ATV.INICIO;
        this.modoVisualizacao = Dom.valor('TYPEVIEW') === '1';
        {{PX_UPPER}}.log.debug('boot', { atividade: this.atividade, visualizacao: this.modoVisualizacao });

        this.mascaras.iniciar();
        this.mascaras.formatarTodos();
        this.ligarBotoes();
        this.ligarRecalculos();
        this.registrarRegras();
        this.aplicarVisibilidade();
        this.aplicarEdicao();
        this.prepararAtividade();
        this.recalcularTotal();
    };

    /* Valores padrao por atividade. */
    App.prototype.prepararAtividade = function () {
        if (this.modoVisualizacao) return;
        if (this.atividadePreenchimento() && !Dom.valor('DATA_SOLICITACAO')) {
            Dom.setValor('DATA_SOLICITACAO', {{PX_UPPER}}.Data.hojeISO());
        }
    };

    /* Secoes com visivelEm preenchido so aparecem nessas atividades (ou se ja tiverem dado gravado). */
    App.prototype.aplicarVisibilidade = function () {
        var self = this, id;
        for (id in Config.SECOES) {
            if (!Object.prototype.hasOwnProperty.call(Config.SECOES, id)) continue;
            var regra = Config.SECOES[id], el = Dom.byId(id);
            if (!el) continue;
            var visivel = !regra.visivelEm.length || contem(regra.visivelEm, self.atividade);
            /* "a partir da aprovacao": depois da decisao a secao continua visivel (consulta) */
            if (!visivel && id === 'secAprovacao') visivel = Dom.valor('DECISAO_APROVACAO') !== '';
            el.hidden = !visivel;
        }
    };

    /* Desabilita as secoes que nao sao editaveis na atividade atual. */
    App.prototype.aplicarEdicao = function () {
        var self = this, id;
        for (id in Config.SECOES) {
            if (!Object.prototype.hasOwnProperty.call(Config.SECOES, id)) continue;
            var el = Dom.byId(id);
            if (!el) continue;
            var editavel = !self.modoVisualizacao && contem(Config.SECOES[id].editavelEm, self.atividade);
            self.definirEdicao(el, editavel);
        }
    };

    App.prototype.definirEdicao = function (secao, editavel) {
        Dom.qsa(SELETOR_EDITAVEIS, secao).forEach(function (campo) {
            if (!editavel) campo.disabled = true;
        });
        Dom.qsa('[data-acao]', secao).forEach(function (botao) { botao.hidden = !editavel; });
        secao.classList.toggle('{{PX}}-section--bloqueada', !editavel);
        if (!editavel) {
            /* zoom: a instancia global window[ID] e criada pelo Fluig apos o carregamento */
            setTimeout(function () {
                Dom.qsa('[data-zoom]', secao).forEach(function (campo) {
                    var zoom = global[campo.id];
                    if (zoom && typeof zoom.disable === 'function') {
                        try { zoom.disable(true); } catch (e) { {{PX_UPPER}}.log.debug('zoom.disable', campo.id, e); }
                    }
                });
            }, 300);
        }
    };

    /* Reabilita tudo que foi desabilitado: campos disabled nao sao submetidos ao Fluig. */
    App.prototype.reabilitarCampos = function () {
        Dom.qsa('input[disabled], select[disabled], textarea[disabled]', this.form).forEach(function (campo) {
            campo.disabled = false;
        });
    };

    // ------------------------------------------------------------ pai-filho

    App.prototype.ligarBotoes = function () {
        var self = this;
        document.addEventListener('click', function (e) {
            var alvo = e.target && e.target.closest ? e.target.closest('[data-acao]') : null;
            if (!alvo || alvo.disabled || alvo.hidden) return;
            var acao = alvo.getAttribute('data-acao');
            if (acao === 'adicionar-linha') { e.preventDefault(); self.adicionarLinha(alvo.getAttribute('data-tabela')); }
            else if (acao === 'remover-linha') { e.preventDefault(); self.removerLinha(alvo); }
        });
    };

    /* Adiciona uma linha (clona a 1a linha template). Retorna o sequencial. */
    App.prototype.adicionarLinha = function (tabela) {
        var seq = global.wdkAddChild(tabela || Config.TABELA_ITENS);
        /* zoom em pai-filho com filtro: reloadZoomFilterValues('CAMPO___' + seq, 'COLUNA,' + valor); */
        var primeiro = Dom.qs('#' + tabela + ' [id$="___' + seq + '"]:not([type="hidden"])');
        if (primeiro) { try { primeiro.focus(); } catch (e) { /* campo ainda nao renderizado */ } }
        this.recalcularTotal();
        return seq;
    };

    App.prototype.removerLinha = function (botao) {
        global.fnWdkRemoveChild(botao);
        this.recalcularTotal();
        {{PX_UPPER}}.Notify.toast('info', 'Item removido', 'A linha foi removida da tabela.');
    };

    /* Quantidade de linhas reais (ignora o template) da tabela. */
    App.prototype.totalLinhas = function (tabela) {
        return Dom.qsa('#' + tabela + ' tbody tr').filter(function (tr) {
            return !!tr.querySelector('[id*="___"]');
        }).length;
    };

    // ------------------------------------------------------------ calculos

    App.prototype.ligarRecalculos = function () {
        var self = this;
        if (global.jQuery) global.jQuery(document).on('{{PX}}:changed', '[data-mask]', function () { self.recalcularTotal(); });
    };

    /* Exemplo de texto so exibido (sem name): soma quantidade x valor dos itens. */
    App.prototype.recalcularTotal = function () {
        var Num = {{PX_UPPER}}.Num, total = 0;
        Dom.qsa('input[id^="ITEM_QUANTIDADE___"]').forEach(function (qtd) {
            var seq = Dom.separarSeq(qtd.id).seq;
            var q = Num.fromTela(qtd.value), v = Num.fromTela(Dom.valor('ITEM_VALOR___' + seq));
            if (q !== null && v !== null) total += q * v;
        });
        var saida = Dom.byId('viewTotalItens');
        if (saida) saida.textContent = Num.formatMoeda(Num.round(total, 2)) || 'R$ 0,00';
    };

    // ------------------------------------------------------------ zoom

    /* Preenche (item) ou limpa (null) os hidden de chave do zoom. */
    App.prototype.aplicarZoom = function (inputId, item) {
        var partes = Dom.separarSeq(inputId);
        var mapa = Config.ZOOMS[partes.base], hiddenId;
        if (!mapa) return;
        for (hiddenId in mapa) {
            if (!Object.prototype.hasOwnProperty.call(mapa, hiddenId)) continue;
            var alvo = partes.seq ? hiddenId + '___' + partes.seq : hiddenId;
            Dom.setValor(alvo, item ? item[mapa[hiddenId]] : '');
        }
    };

    App.prototype.aoSelecionarZoom = function (item) {
        if (!item || !item.inputId) return;
        this.aplicarZoom(item.inputId, item);
        /* regras especificas por campo: if (Dom.separarSeq(item.inputId).base === 'CENTROCUSTO') { ... } */
    };

    App.prototype.aoRemoverZoom = function (item) {
        if (!item || !item.inputId) return;
        this.aplicarZoom(item.inputId, null);
    };

    // ------------------------------------------------------------ validacao e envio

    /* Regras de negocio alem do [required]. Cada regra devolve [{ el, rotulo, mensagem }]. */
    App.prototype.registrarRegras = function () {
        var self = this;

        this.validador.adicionarRegra(function () {
            if (!self.atividadePreenchimento()) return [];
            if (self.totalLinhas(Config.TABELA_ITENS) > 0) return [];
            return [{ el: Dom.byId(Config.TABELA_ITENS), rotulo: 'Itens', mensagem: 'Inclua ao menos um item.' }];
        });

        this.validador.adicionarRegra(function () {
            if (!self.atividadeAprovacao()) return [];
            if (Dom.valor('DECISAO_APROVACAO') !== 'REPROVADO' || Dom.valor('PARECER_APROVACAO') !== '') return [];
            return [{ el: Dom.byId('PARECER_APROVACAO'), rotulo: 'Parecer', mensagem: 'Informe o motivo da reprovação.' }];
        });
    };

    App.prototype.validarEnvio = function (numState, nextState) {
        try {
            {{PX_UPPER}}.log.debug('beforeSendValidate', numState, nextState);
            var resultado = this.validador.validar();
            if (!resultado.valido) {
                this.validador.exibir(resultado);
                return false;
            }
            if (this.atividadeAprovacao()) Dom.setValor('APROVADOR', Dom.valor('USUARIOATUAL'));
            this.reabilitarCampos();
            return true;
        } catch (e) {
            {{PX_UPPER}}.log.error('Erro no beforeSendValidate', e);
            {{PX_UPPER}}.Notify.toast('danger', 'Erro inesperado', 'Não foi possível validar o formulário: ' + (e.message || String(e)) +
                '. Se persistir, abra um chamado no GLPI.');
            return false;
        }
    };

    // ------------------------------------------------------------------ instancia e pontes globais
    var app = {{PX_UPPER}}.app = new App();

    global.beforeSendValidate = function (numState, nextState) { return app.validarEnvio(numState, nextState); };
    global.setSelectedZoomItem = function (item) { app.aoSelecionarZoom(item); };
    global.removedZoomItem = function (item) { app.aoRemoverZoom(item); };
    global.setZoomData = function (instance, value) {
        if (global[instance] && typeof global[instance].setValue === 'function') global[instance].setValue(value);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { app.boot(); });
    else app.boot();
})(window);
