/* ============================================================================
 * {{DATASET}}.js  (FRONT) - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * Camada de acesso ao dataset "{{DATASET}}". Ponto UNICO de contato do front
 * com este dataset: monta as constraints (_ACAO e filtros) e devolve OBJETOS
 * DE DOMINIO. Os modulos integre*.js nunca montam constraint nem conhecem
 * nome de coluna.
 *
 * Namespace: {{NS}}.ds.registros   (renomeie conforme a entidade)
 * Dataset:   {{DATASET}}           (publicado A PARTE do WAR)
 * Acoes:     LISTAR | SALVAR
 * Retorno:   jQuery promise (done/fail); fail recebe { mensagem, naoPublicado }
 *
 * Ordem de carga: depois de Objects.js/Componentes.js/Permissoes.js,
 * antes dos integre*.js.
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
(function (global, $) {
    'use strict';

    var {{NS}} = global.{{NS}} = global.{{NS}} || {};
    {{NS}}.ds = {{NS}}.ds || {};

    var DS = '{{DATASET}}';

    function DsRegistros() {
        this.dataset = DS;
    }

    /**
     * Lista os registros ativos.
     * @param  {Object} filtros  { codigo, busca, incluirInativos }
     * @return {Promise}         resolve com Array<{{NS}}.Registro>
     */
    DsRegistros.prototype.listar = function (filtros) {
        var cs = {{NS}}.dataset.cs;
        var f = filtros || {};
        var c = [cs('_ACAO', {{NS}}.const.ACOES.LISTAR)];
        if (f.codigo)          { c.push(cs('CODIGO', f.codigo)); }
        if (f.busca)           { c.push(cs('_BUSCA', f.busca)); }
        if (f.incluirInativos) { c.push(cs('_INCLUIR_INATIVOS', '1')); }

        var dfd = $.Deferred();
        {{NS}}.dataset.chamar(DS, c)
            .done(function (linhas) {
                var lista = [];
                for (var i = 0; i < linhas.length; i++) { lista.push({{NS}}.Registro.deLinha(linhas[i])); }
                {{NS}}.store.set('registros', lista);
                dfd.resolve(lista);
            })
            .fail(function (err) { dfd.reject(err); });
        return dfd.promise();
    };

    /**
     * Grava um registro (insere sem id, atualiza com id).
     * Valida antes de ir ao servidor; o dataset revalida.
     * @param  {Object}  registro  instancia de {{NS}}.Registro
     * @return {Promise}  resolve com { ok: true, mensagem, id };
     *                    rejeita com { mensagem, validacao: [...] } ou erro do servidor
     */
    DsRegistros.prototype.salvar = function (registro) {
        var dfd = $.Deferred();
        var erros = registro && typeof registro.validar === 'function'
            ? registro.validar() : ['Registro inválido.'];
        if (erros.length) {
            dfd.reject({ mensagem: erros.join(' '), validacao: erros, naoPublicado: false });
            return dfd.promise();
        }

        var c = [{{NS}}.dataset.cs('_ACAO', {{NS}}.const.ACOES.SALVAR)].concat(registro.paraConstraints());
        {{NS}}.dataset.chamar(DS, c)
            .done(function (linhas) {
                var r = {{NS}}.dataset.resultado(linhas);
                if (r.ok) { dfd.resolve(r); } else { dfd.reject({ mensagem: r.mensagem, naoPublicado: false }); }
            })
            .fail(function (err) { dfd.reject(err); });
        return dfd.promise();
    };

    {{NS}}.ds.registros = new DsRegistros();

}(window, jQuery));
