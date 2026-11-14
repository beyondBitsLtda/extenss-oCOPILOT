/* ============================================================================
 * main.function.js - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * Ponto UNICO de entrada da widget (SuperWidget do Fluig).
 *   - ciclo de vida (init / destroy)
 *   - bindings dos botoes declarados no view.ftl com data-*
 *
 * Regras:
 *   - O nome do "var" e IDENTICO ao application.code. Divergente, a widget
 *     monta o HTML e nunca inicia, sem erro (o build-widget.js reprova).
 *   - Nenhuma logica de UI (Controller.js) nem de dominio (integre*.js) aqui:
 *     cada handler so DELEGA ao Controller.
 *
 * Padrao de bindings do SuperWidget:
 *   local: { 'nome-evento': ['click_funcao'] }
 *   -> o elemento precisa de data-nome-evento="true"
 *   -> ao clicar, o Fluig chama this.funcao(htmlElement, event)
 *
 * Ordem de carga: ULTIMO arquivo do application.info.
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
var {{CODE}} = SuperWidget.extend({

    _iniciado: false,

    bindings: {
        local: {
            '{{NS}}-recarregar': ['click_recarregar']
        },
        global: {}
    },

    init: function () {
        if (this._iniciado) { return; }
        try {
            /* o namespace tem de estar carregado (ordem do application.info) */
            if (typeof window.{{NS}} === 'undefined' || !window.{{NS}}.Controller) {
                console.error('[{{CODE}}] window.{{NS}} indisponivel. Verifique a ordem de ' +
                    'application.resource.js.* em application.info (Objects.js primeiro, ' +
                    'Controller.js antes do main.function.js).');
                return;
            }
            window.{{NS}}.Controller.iniciar(this);
            this._iniciado = true;
        } catch (e) {
            console.error('[{{CODE}}] Falha na inicializacao', e);
        }
    },

    _delegar: function (modulo, metodo, event) {
        if (event && event.preventDefault) { event.preventDefault(); }
        if (window.{{NS}} && window.{{NS}}.Controller) {
            window.{{NS}}.Controller.executar(modulo, metodo);
        }
    },

    recarregar: function (htmlElement, event) {
        this._delegar('__CTRL__', 'recarregar', event);
    },

    destroy: function () {
        try {
            if (window.{{NS}} && window.{{NS}}.Controller) { window.{{NS}}.Controller.destruir(); }
        } catch (e) {
            console.error('[{{CODE}}] Falha ao destruir', e);
        }
        this._iniciado = false;
    }

});
