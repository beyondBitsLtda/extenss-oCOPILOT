/* =============================================================================
   Permissoes.js - {{NS}}.permissoes
   Matriz de acesso PAPEL x MODULO de {{TITULO}} DELP (widget {{CODE}})
   -----------------------------------------------------------------------------
   Ponto UNICO de verdade para "este papel pode Visualizar / Editar /
   Administrar esta aba?". O front usa para esconder abas e botoes; os
   datasets REVALIDAM no servidor (esconder no front nao e controle).

   PAPEIS
     ADMIN    - administra a widget (tudo)
     USUARIO  - uso comum (padrao de quem nao tem papel cadastrado)

   ACOES
     V = visualiza   E = edita/cria   A = administra (excluir, parametrizar)

   Chaves de modulo = chaves de ABAS no Controller.js.
   Papel ausente no modulo = SEM ACESSO.

   Ordem de carga: depois de Componentes.js, antes da camada ds*.js.
   v1.0.0 - {{DATA}} - criacao
============================================================================= */
(function (global) {
    'use strict';

    var {{NS}} = global.{{NS}} = global.{{NS}} || {};

    var V = 'V', E = 'E', A = 'A';

    /* Papel de quem nao tem cadastro. Restritivo por padrao: troque para
       'ADMIN' apenas em homologacao, enquanto o cadastro nao existir. */
    var PAPEL_PADRAO = 'USUARIO';

    /* Ordem de precedencia para exibir o "papel principal" no rodape. */
    var PRECEDENCIA = ['ADMIN', 'USUARIO'];

    var MATRIZ = {
        inicio: {
            ADMIN:   [V, E, A],
            USUARIO: [V]
        }
    };

    function Permissoes() {
        this._papeis = [PAPEL_PADRAO];
    }

    /** Define os papeis do usuario logado (lista vazia = PAPEL_PADRAO). */
    Permissoes.prototype.setPapeis = function (papeis) {
        var lista = [];
        for (var i = 0; i < (papeis || []).length; i++) {
            var p = String(papeis[i] || '').toUpperCase();
            if (p && lista.indexOf(p) < 0) { lista.push(p); }
        }
        this._papeis = lista.length ? lista : [PAPEL_PADRAO];
    };

    Permissoes.prototype.papeis = function () { return this._papeis.slice(); };

    Permissoes.prototype.papelPrincipal = function () {
        for (var i = 0; i < PRECEDENCIA.length; i++) {
            if (this._papeis.indexOf(PRECEDENCIA[i]) >= 0) { return PRECEDENCIA[i]; }
        }
        return this._papeis[0] || PAPEL_PADRAO;
    };

    /**
     * Algum papel do usuario permite a acao na aba?
     * @param {string} aba    chave do modulo (ex.: 'inicio')
     * @param {string} acao   'V' | 'E' | 'A' (padrao 'V')
     */
    Permissoes.prototype.pode = function (aba, acao) {
        var regra = MATRIZ[aba];
        if (!regra) { return false; }
        var a = acao || V;
        for (var i = 0; i < this._papeis.length; i++) {
            var acoes = regra[this._papeis[i]];
            if (acoes && acoes.indexOf(a) >= 0) { return true; }
        }
        return false;
    };

    Permissoes.prototype.podeAcessar = function (aba) { return this.pode(aba, V); };
    Permissoes.prototype.podeEditar  = function (aba) { return this.pode(aba, E); };

    Permissoes.prototype.matriz = function () { return MATRIZ; };

    {{NS}}.permissoes = new Permissoes();
    {{NS}}.permissoes.ACOES = { V: V, E: E, A: A };

}(window));
