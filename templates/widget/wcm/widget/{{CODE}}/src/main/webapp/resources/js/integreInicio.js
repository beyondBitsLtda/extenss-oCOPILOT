/* ============================================================================
 * integreInicio.js - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * Regra da aba "inicio": indicadores (Kpi) + grafico + lista de registros (Tabela).
 *
 * Namespace: {{NS}}.integre.inicio
 * Containers (view.ftl): inicio-kpis | inicio-grafico | inicio-lista | inicio-resumo
 * Consome:   {{NS}}.ds.registros (dados), {{NS}}.componentes (UI) e {{NS}}.grafico
 *
 * Regras:
 *   - Nao monta constraint nem conhece nome de coluna (isso e do ds*.js)
 *   - Nao mexe em navegacao (isso e do Controller.js)
 *   - So escreve dentro dos proprios containers
 *
 * Ordem de carga: depois da camada ds*.js, antes do Controller.js.
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
(function (global, $) {
    'use strict';

    var {{NS}} = global.{{NS}} = global.{{NS}} || {};
    {{NS}}.integre = {{NS}}.integre || {};
    var C = {{NS}}.componentes;
    var util = {{NS}}.util;

    var ABA = 'inicio';

    function Inicio() {
        this._carregando = null;      /* promise da carga em andamento */
    }

    /** Chamado pelo Controller ao abrir a aba. Devolve a promise da carga. */
    Inicio.prototype.aoAtivarAba = function (aba) {
        if (aba && aba !== ABA) { return null; }
        return this.render();
    };

    /** Botao "Atualizar" (via Controller.recarregar). */
    Inicio.prototype.recarregar = function () {
        return this.render();
    };

    Inicio.prototype._host = function (nome) {
        return $('.{{CODE}}').first().find('[data-{{NS}}-container="' + nome + '"]').first();
    };

    Inicio.prototype.render = function () {
        var self = this;
        if (self._carregando) { return self._carregando; }    /* evita carga dupla */

        C.Spinner.no(self._host('inicio-lista'), 'Carregando registros...');
        self._host('inicio-resumo').text('');

        /* atribui ANTES de pendurar o always: se a promise ja vier resolvida,
           o always limpa a trava na hora em vez de deixa-la presa */
        var carga = self._carregando = {{NS}}.ds.registros.listar({});
        carga
            .done(function (lista) {
                self._renderKpis(lista);
                self._renderGrafico(lista);
                self._renderLista(lista);
                self._host('inicio-resumo').text('Atualizado em ' + util.formatarData(new Date(), true));
            })
            .fail(function (err) { self._renderErro(err); })
            .always(function () { self._carregando = null; });

        return carga;
    };

    Inicio.prototype._renderKpis = function (lista) {
        var ativos = 0, total = 0;
        for (var i = 0; i < lista.length; i++) {
            if (lista[i].ativo) { ativos++; }
            total += lista[i].valor;
        }
        C.Kpi.preencher(this._host('inicio-kpis'), [
            { rotulo: 'Registros', valor: util.formatarNumero(lista.length), unidade: 'destaque' },
            { rotulo: 'Ativos', valor: util.formatarNumero(ativos), unidade: 'servicos' },
            { rotulo: 'Inativos', valor: util.formatarNumero(lista.length - ativos), unidade: 'mooring' },
            { rotulo: 'Valor total', valor: util.formatarNumero(total, 2), unidade: 'subsea' }
        ]);
    };

    Inicio.prototype._renderLista = function (lista) {
        var self = this;
        C.Tabela.render(self._host('inicio-lista'), {
            linhas: lista,
            vazio: 'Nenhum registro cadastrado ainda.',
            colunas: [
                { campo: 'codigo', titulo: 'Código' },
                { campo: 'nome', titulo: 'Nome' },
                { campo: 'valor', titulo: 'Valor', alinhar: 'dir',
                  formato: function (v) { return util.formatarNumero(v, 2); } },
                { campo: 'atualizadoEm', titulo: 'Atualizado em',
                  formato: function (v) { return util.formatarData(v, true); } },
                { campo: 'ativo', titulo: 'Situação',
                  formato: function (v, r) { var s = r.situacao(); return C.Badge.criar(s.rotulo, s.badge); } }
            ],
            aoClicarLinha: function (r) { self.abrirDetalhe(r); }
        });
    };

    /** Detalhe somente leitura do registro (exemplo de Modal). */
    Inicio.prototype.abrirDetalhe = function (r) {
        var $dl = $('<dl class="{{NS}}-detalhe"></dl>');
        function item(rotulo, valor) {
            $dl.append($('<dt class="{{NS}}-detalhe__rotulo"></dt>').text(rotulo));
            $dl.append($('<dd class="{{NS}}-detalhe__valor"></dd>').text(valor || '-'));
        }
        item('Código', r.codigo);
        item('Nome', r.nome);
        item('Valor', util.formatarNumero(r.valor, 2));
        item('Situação', r.situacao().rotulo);
        item('Atualizado em', util.formatarData(r.atualizadoEm, true));

        new C.Modal({
            titulo: r.nome || 'Registro',
            conteudo$: $dl,
            botoes: [{ texto: 'Fechar', tipo: 'ghost', onClick: function (m) { m.fechar(); } }]
        }).abrir();
    };

    /* Grafico de EXEMPLO: os 8 maiores valores, uma serie (uma cor), barras horizontais
       porque os nomes costumam ser longos. Todo grafico passa pelo {{NS}}.grafico. */
    Inicio.prototype._renderGrafico = function (lista) {
        var top = (lista || [])
            .filter(function (r) { return r.ativo; })
            .sort(function (a, b) { return b.valor - a.valor; })
            .slice(0, 8);
        {{NS}}.grafico.barras(this._host('inicio-grafico'), {
            categorias: top.map(function (r) { return r.nome; }),
            series: [{ nome: 'Valor', valores: top.map(function (r) { return r.valor; }) }],
            horizontal: true,
            formato: 'numero',
            altura: Math.max(180, top.length * 36 + 40),
            vazio: 'Nenhum registro com valor para exibir.'
        });
    };

    Inicio.prototype._renderErro = function (err) {
        var e = err || {};
        var msg = e.naoPublicado
            ? 'O dataset {{DATASET}} ainda não está disponível no Fluig. Publique o dataset (e rode o SQL das tabelas) e clique em Atualizar.'
            : 'Não foi possível carregar os registros: ' + (e.mensagem || 'erro desconhecido.');

        var $erro = $('<div class="{{NS}}-placeholder {{NS}}-placeholder--erro"></div>').text(msg);
        this._host('inicio-lista').empty().append($erro);
        this._host('inicio-kpis').empty();
        this._host('inicio-grafico').empty();
        C.Toast.erro(msg);
    };

    {{NS}}.integre.inicio = new Inicio();

}(window, jQuery));
