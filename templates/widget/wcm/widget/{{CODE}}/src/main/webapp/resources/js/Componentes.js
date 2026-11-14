/* ============================================================================
 * Componentes.js - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * Kit de UI PROPRIO da widget (nada de FLUIGC, alert, confirm ou prompt).
 *
 * Namespace: {{NS}}.componentes
 *   Toast        sucesso | erro | aviso | info
 *   Modal        new Modal({ titulo, conteudo$, botoes, tamanho, aoFechar })
 *   Confirmacao  Confirmacao.abrir({ titulo, mensagem, aoConfirmar, perigo })
 *   Spinner      noBotao | restaurar | no (container)
 *   Tabela       Tabela.render($host, { colunas, linhas, vazio, aoClicarLinha })
 *   Kpi          Kpi.preencher($host, itens)
 *   Badge        Badge.criar(texto, tipo)
 *
 * Regras:
 *   - Classes BEM com prefixo {{NS}}- (aparencia toda no {{NS}}.css)
 *   - Todo texto entra por .text() ou util.esc: nada de dado cru em HTML
 *   - Overlays usam os hosts do view.ftl (modal-host / toast-host); se o
 *     host nao existir, nasce um de emergencia no <body> com os tokens
 *
 * Ordem de carga: depois de Objects.js, antes de Permissoes.js.
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
(function (global, $) {
    'use strict';

    var {{NS}} = global.{{NS}} = global.{{NS}} || {};
    {{NS}}.componentes = {{NS}}.componentes || {};
    var C = {{NS}}.componentes;

    /* ------------------------------------------------------------------
       Tokens fora do container raiz.
       Modal e toast ficam no <body> (position:fixed); o CSS declara os
       tokens em ".{{NS}}, .{{NS}}-tokens" e os temas em ".{{NS}}--tema-*".
       Carimbar estas classes no overlay faz todo var(--{{NS}}-*) resolver.
       ------------------------------------------------------------------ */
    function classesDeTokens() {
        var tema = 'claro';
        try {
            if ({{NS}}.Controller && typeof {{NS}}.Controller.tema === 'function') {
                tema = {{NS}}.Controller.tema() || 'claro';
            }
        } catch (e) { /* Controller ainda nao carregado: tema claro */ }
        return '{{NS}}-tokens {{NS}}--tema-' + tema;
    }
    C.classesDeTokens = classesDeTokens;

    function host(nome, classe) {
        var $h = $('[data-{{NS}}-container="' + nome + '"]').first();
        if ($h.length) { return $h; }
        $h = $('<div></div>').addClass(classe).addClass(classesDeTokens())
            .attr('data-{{NS}}-container', nome);
        $('body').append($h);
        return $h;
    }

    /** Aceita jQuery, elemento ou seletor. */
    function $de(alvo) { return (alvo && alvo.jquery) ? alvo : $(alvo); }

    // ==================================================================
    // Toast
    // ==================================================================
    function fecharToast($t) {
        if (!$t || !$t.length) { return; }
        $t.removeClass('{{NS}}-toast--visivel');
        setTimeout(function () { $t.remove(); }, 200);
    }

    var Toast = {
        mostrar: function (opts) {
            opts = opts || {};
            var tipo = opts.tipo || 'info';
            var duracao = (opts.duracao === undefined) ? 4500 : opts.duracao;
            var $t = $(
                '<div class="{{NS}}-toast" role="status">' +
                    '<div class="{{NS}}-toast__msg"></div>' +
                    '<button type="button" class="{{NS}}-toast__fechar" aria-label="Fechar">&times;</button>' +
                '</div>'
            ).addClass('{{NS}}-toast--' + tipo);
            $t.find('.{{NS}}-toast__msg').text(opts.mensagem || '');
            $t.find('.{{NS}}-toast__fechar').on('click', function () { fecharToast($t); });
            host('toast-host', '{{NS}}-toast-host').append($t);
            $t[0].getBoundingClientRect();           /* reflow para a transicao */
            $t.addClass('{{NS}}-toast--visivel');
            if (duracao > 0) { setTimeout(function () { fecharToast($t); }, duracao); }
            return $t;
        },
        sucesso: function (m, d) { return Toast.mostrar({ tipo: 'sucesso', mensagem: m, duracao: d }); },
        erro:    function (m, d) { return Toast.mostrar({ tipo: 'erro', mensagem: m, duracao: d || 7000 }); },
        aviso:   function (m, d) { return Toast.mostrar({ tipo: 'aviso', mensagem: m, duracao: d }); },
        info:    function (m, d) { return Toast.mostrar({ tipo: 'info', mensagem: m, duracao: d }); }
    };
    C.Toast = Toast;

    // ==================================================================
    // Modal
    // ------------------------------------------------------------------
    // var m = new {{NS}}.componentes.Modal({
    //     titulo: 'Detalhe', tamanho: 'md',          // sm | md | lg
    //     conteudo$: $('<div>...</div>'),
    //     botoes: [
    //         { texto: 'Cancelar', tipo: 'ghost',   onClick: function (m) { m.fechar(); } },
    //         { texto: 'Salvar',   tipo: 'primary', onClick: function (m) { ... } }
    //     ],
    //     aoFechar: function () {}
    // });
    // m.abrir();
    // ==================================================================
    function Modal(opts) {
        this.opts = opts || {};
        this.$el = null;
        this._aberto = false;
        this._evTecla = 'keydown.{{NS}}Modal' + (++Modal._seq);
    }
    Modal._seq = 0;

    Modal.prototype._montar = function () {
        var self = this, o = self.opts;
        var $el = $(
            '<div class="{{NS}}-modal" role="dialog" aria-modal="true">' +
                '<div class="{{NS}}-modal__fundo"></div>' +
                '<div class="{{NS}}-modal__caixa">' +
                    '<header class="{{NS}}-modal__cab">' +
                        '<h2 class="{{NS}}-modal__titulo"></h2>' +
                        '<button type="button" class="{{NS}}-modal__fechar" aria-label="Fechar">&times;</button>' +
                    '</header>' +
                    '<div class="{{NS}}-modal__corpo"></div>' +
                    '<footer class="{{NS}}-modal__rodape"></footer>' +
                '</div>' +
            '</div>'
        );
        $el.addClass('{{NS}}-modal--' + (o.tamanho || 'md')).addClass(classesDeTokens());
        $el.find('.{{NS}}-modal__titulo').text(o.titulo || '');
        if (o.conteudo$) { $el.find('.{{NS}}-modal__corpo').append(o.conteudo$); }

        var $rodape = $el.find('.{{NS}}-modal__rodape');
        $.each(o.botoes || [], function (i, b) {
            var $b = $('<button type="button" class="{{NS}}-btn"></button>')
                .addClass('{{NS}}-btn--' + (b.tipo || 'ghost')).text(b.texto || 'OK');
            $b.on('click', function () {
                if (typeof b.onClick === 'function') { b.onClick(self, $b); } else { self.fechar(); }
            });
            $rodape.append($b);
        });
        if (!(o.botoes || []).length) { $rodape.remove(); }

        $el.find('.{{NS}}-modal__fechar').on('click', function () { self.fechar(); });
        if (o.fecharNoFundo !== false) {
            $el.find('.{{NS}}-modal__fundo').on('click', function () { self.fechar(); });
        }
        return $el;
    };

    Modal.prototype.abrir = function () {
        var self = this;
        if (self._aberto) { return self; }
        self.$el = self._montar();
        var $host = host('modal-host', '{{NS}}-modal-host');
        $host.append(self.$el).attr('aria-hidden', 'false');
        self.$el[0].getBoundingClientRect();
        self.$el.addClass('{{NS}}-modal--aberto');
        $(global.document).on(self._evTecla, function (e) {
            if (e.keyCode === 27) { self.fechar(); }
        });
        self.$el.find('.{{NS}}-modal__fechar').trigger('focus');
        self._aberto = true;
        return self;
    };

    Modal.prototype.corpo = function () {
        return this.$el ? this.$el.find('.{{NS}}-modal__corpo') : $();
    };

    Modal.prototype.fechar = function () {
        var self = this;
        if (!self._aberto) { return; }
        self._aberto = false;
        $(global.document).off(self._evTecla);
        var $el = self.$el;
        $el.removeClass('{{NS}}-modal--aberto');
        setTimeout(function () {
            var $host = $el.parent();
            $el.remove();
            if ($host.length && !$host.children().length) { $host.attr('aria-hidden', 'true'); }
        }, 180);
        if (typeof self.opts.aoFechar === 'function') { self.opts.aoFechar(); }
    };
    C.Modal = Modal;

    // ==================================================================
    // Confirmacao - substitui o confirm() do navegador
    // ==================================================================
    C.Confirmacao = {
        abrir: function (opts) {
            opts = opts || {};
            var $msg = $('<p class="{{NS}}-confirmacao__msg"></p>').text(opts.mensagem || 'Confirma a operação?');
            var m = new Modal({
                titulo: opts.titulo || 'Confirmação',
                tamanho: 'sm',
                conteudo$: $msg,
                aoFechar: opts.aoFechar,
                botoes: [
                    { texto: opts.textoCancelar || 'Cancelar', tipo: 'ghost', onClick: function (mm) {
                        mm.fechar();
                        if (typeof opts.aoCancelar === 'function') { opts.aoCancelar(); }
                    } },
                    { texto: opts.textoConfirmar || 'Confirmar', tipo: opts.perigo ? 'perigo' : 'primary', onClick: function (mm) {
                        mm.fechar();
                        if (typeof opts.aoConfirmar === 'function') { opts.aoConfirmar(); }
                    } }
                ]
            });
            return m.abrir();
        }
    };

    // ==================================================================
    // Spinner
    // ==================================================================
    C.Spinner = {
        /** Desabilita o botao e mostra "Aguarde..." ate restaurar(). */
        noBotao: function (botao, texto) {
            var $b = $de(botao);
            if (!$b.length || $b.data('{{NS}}TextoOriginal') !== undefined) { return; }
            $b.data('{{NS}}TextoOriginal', $b.text())
              .prop('disabled', true).addClass('{{NS}}-btn--carregando')
              .empty()
              .append('<span class="{{NS}}-spinner {{NS}}-spinner--mini" aria-hidden="true"></span>')
              .append($('<span></span>').text(' ' + (texto || 'Aguarde...')));
        },
        restaurar: function (botao) {
            var $b = $de(botao);
            var original = $b.data('{{NS}}TextoOriginal');
            if (original === undefined) { return; }
            $b.removeData('{{NS}}TextoOriginal').prop('disabled', false)
              .removeClass('{{NS}}-btn--carregando').text(original);
        },
        /** Substitui o conteudo do container por um placeholder com spinner. */
        no: function (container, texto) {
            var $c = $de(container);
            $c.empty().append(
                $('<div class="{{NS}}-placeholder"></div>')
                    .append('<span class="{{NS}}-spinner" aria-hidden="true"></span>')
                    .append($('<span></span>').text(texto || 'Carregando...'))
            );
        }
    };

    // ==================================================================
    // Badge
    // ==================================================================
    C.Badge = {
        /** tipo: ok | aviso | erro | info | neutro | destaque */
        criar: function (texto, tipo) {
            return $('<span class="{{NS}}-badge"></span>')
                .addClass('{{NS}}-badge--' + (tipo || 'neutro')).text(texto || '');
        }
    };

    // ==================================================================
    // Tabela
    // ------------------------------------------------------------------
    // Tabela.render($host, {
    //     colunas: [{ campo: 'nome', titulo: 'Nome', alinhar: 'dir',
    //                 formato: function (valor, linha) { return texto | $el; } }],
    //     linhas: [...], vazio: 'Nenhum registro.',
    //     aoClicarLinha: function (linha) {}
    // });
    // formato devolvendo string vira TEXTO (escapado); jQuery e anexado.
    // ==================================================================
    C.Tabela = {
        render: function (container, opts) {
            opts = opts || {};
            var $c = $de(container).empty();
            var colunas = opts.colunas || [], linhas = opts.linhas || [];

            if (!linhas.length) {
                $c.append($('<div class="{{NS}}-placeholder {{NS}}-placeholder--vazio"></div>')
                    .text(opts.vazio || 'Nenhum registro encontrado.'));
                return;
            }

            var $tab = $('<table class="{{NS}}-tabela"><thead><tr></tr></thead><tbody></tbody></table>');
            var $cab = $tab.find('thead tr'), $corpo = $tab.find('tbody');
            $.each(colunas, function (i, col) {
                $cab.append($('<th scope="col"></th>').text(col.titulo || '')
                    .toggleClass('{{NS}}-tabela__cel--dir', col.alinhar === 'dir'));
            });

            $.each(linhas, function (i, linha) {
                var $tr = $('<tr></tr>');
                $.each(colunas, function (j, col) {
                    var valor = linha ? linha[col.campo] : '';
                    var saida = (typeof col.formato === 'function') ? col.formato(valor, linha) : valor;
                    var $td = $('<td></td>').toggleClass('{{NS}}-tabela__cel--dir', col.alinhar === 'dir');
                    if (saida && saida.jquery) { $td.append(saida); } else { $td.text(saida === null || saida === undefined ? '' : String(saida)); }
                    $tr.append($td);
                });
                if (typeof opts.aoClicarLinha === 'function') {
                    $tr.addClass('{{NS}}-tabela__linha--clicavel').attr('tabindex', '0')
                       .on('click', function () { opts.aoClicarLinha(linha); })
                       .on('keydown', function (e) { if (e.keyCode === 13) { opts.aoClicarLinha(linha); } });
                }
                $corpo.append($tr);
            });

            $c.append($('<div class="{{NS}}-tabela-wrap"></div>').append($tab));
        }
    };

    // ==================================================================
    // Kpi
    // ------------------------------------------------------------------
    // Kpi.preencher($host, [{ rotulo, valor, detalhe, unidade }])
    // unidade: subsea | industria | servicos | mooring | destaque
    // ==================================================================
    C.Kpi = {
        preencher: function (container, itens) {
            var $c = $de(container).empty();
            $.each(itens || [], function (i, it) {
                var $k = $('<div class="{{NS}}-kpi"></div>');
                if (it.unidade) { $k.addClass('{{NS}}-kpi--' + it.unidade); }
                $k.append($('<div class="{{NS}}-kpi__rotulo"></div>').text(it.rotulo || ''));
                $k.append($('<div class="{{NS}}-kpi__valor"></div>').text(it.valor === undefined ? '-' : String(it.valor)));
                if (it.detalhe) { $k.append($('<div class="{{NS}}-kpi__detalhe"></div>').text(it.detalhe)); }
                $c.append($k);
            });
        }
    };

}(window, jQuery));
