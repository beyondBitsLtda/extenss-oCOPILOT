/**
 * =============================================================================
 * {{TITULO}} - {{PX}}.core.js
 * -----------------------------------------------------------------------------
 * Nucleo do formulario. Define o namespace global {{PX_UPPER}} e os utilitarios
 * compartilhados por todos os modulos:
 *   - {{PX_UPPER}}.Config  -> constantes do processo (atividades, datasets, secoes, zooms)
 *   - {{PX_UPPER}}.log     -> log com prefixo; debug so com localStorage {{PX_UPPER}}_DEBUG=1
 *   - {{PX_UPPER}}.Num     -> numeros pt-BR (tela) <-> notacao do banco
 *   - {{PX_UPPER}}.Data    -> datas ISO (aaaa-mm-dd) <-> BR (dd/mm/aaaa)
 *   - {{PX_UPPER}}.Dom     -> atalhos de DOM
 *   - {{PX_UPPER}}.Notify  -> FLUIGC.toast / FLUIGC.modal (nunca alert/confirm)
 *
 * Ordem de carga: PRIMEIRO script do formulario (core -> dataset -> mask -> validator -> app).
 * ES5 puro por convencao da equipe (var/function, IIFE, prototype).
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
(function (global) {
    'use strict';

    var {{PX_UPPER}} = global.{{PX_UPPER}} = global.{{PX_UPPER}} || {};

    // -------------------------------------------------------------------------
    // Configuracao
    // -------------------------------------------------------------------------
    /*
     * ATIVIDADES: codigo numerico de cada atividade do diagrama.
     * Onde achar o codigo: Fluig Studio -> abrir o diagrama (.process) -> clicar na
     * atividade -> aba Propriedades -> campo "Codigo" (ou o numero do arquivo
     * servicetaskN / do evento). O mesmo numero chega em getValue("WKNumState")
     * e e gravado no hidden #ATIVIDADE pelo events/displayFields.js.
     * TROQUE os valores abaixo pelos codigos reais do seu processo.
     */
    var ATIVIDADES = Object.freeze({
        INICIO: '0',        /* abertura pelo portal (antes de existir a solicitacao) */
        ABERTURA: '4',      /* atividade inicial do diagrama */
        APROVACAO: '5'      /* atividade de aprovacao (trocar pelo codigo real) */
    });

    {{PX_UPPER}}.Config = Object.freeze({
        ATIVIDADES: ATIVIDADES,

        /* Atividades em que o solicitante preenche os dados. */
        ATIVIDADES_PREENCHIMENTO: [ATIVIDADES.INICIO, ATIVIDADES.ABERTURA],

        /*
         * DATASETS usados pelo formulario. Todo acesso passa por {{PX}}.dataset.js.
         * TROQUE dsExemplo{{PX_UPPER}} pelo dataset real (o mesmo do data-zoom do HTML).
         */
        DATASETS: Object.freeze({
            EXEMPLO: 'dsExemplo{{PX_UPPER}}'
        }),

        /*
         * SECOES: id do elemento <section> -> em quais atividades e editavel.
         * visivelEm vazio = sempre visivel. A secao de aprovacao e exibida na
         * atividade de aprovacao e, depois dela, sempre que ja houver decisao gravada
         * (regra em {{PX}}.app.js -> aplicarVisibilidade).
         */
        SECOES: Object.freeze({
            secDados: { editavelEm: [ATIVIDADES.INICIO, ATIVIDADES.ABERTURA], visivelEm: [] },
            secItens: { editavelEm: [ATIVIDADES.INICIO, ATIVIDADES.ABERTURA], visivelEm: [] },
            secAprovacao: { editavelEm: [ATIVIDADES.APROVACAO], visivelEm: [ATIVIDADES.APROVACAO] }
        }),

        /*
         * ZOOMS: id do campo zoom -> { hiddenDeChave: colunaDoDataset }.
         * Ao selecionar, cada hidden recebe a coluna do item; ao remover, e limpo.
         * Em pai-filho o sufixo ___<seq> e aplicado automaticamente.
         */
        ZOOMS: Object.freeze({
            CENTROCUSTO: { CODCCUSTO: 'CODCCUSTO' }
        }),

        /* Tabela pai-filho de exemplo (tablename). */
        TABELA_ITENS: 'ITENS',

        CASAS_DECIMAIS: 2
    });

    // -------------------------------------------------------------------------
    // Log
    // -------------------------------------------------------------------------
    function debugAtivo() {
        try { return !!(global.localStorage && global.localStorage.getItem('{{PX_UPPER}}_DEBUG') === '1'); } catch (e) { return false; }
    }

    function registrar(metodo, args) {
        if (!global.console || !global.console[metodo]) return;
        var lista = ['[{{PX_UPPER}}]'].concat(Array.prototype.slice.call(args));
        global.console[metodo].apply(global.console, lista);
    }

    {{PX_UPPER}}.log = {
        debug: function () { if (debugAtivo()) registrar('log', arguments); },
        info: function () { registrar('info', arguments); },
        warn: function () { registrar('warn', arguments); },
        error: function () { registrar('error', arguments); }
    };

    // -------------------------------------------------------------------------
    // Numeros (pt-BR)
    // -------------------------------------------------------------------------
    /*
     * Regras:
     *  - Na TELA: decimal com virgula e milhar com ponto ("1.234,56", "R$ 1.234,56", "12,50%").
     *  - No BANCO / dataset: decimal com ponto ("1234.56").
     *  - Para o banco sempre enviar o numero "puro" em notacao JS (toBanco).
     */
    var formatadores = {};

    function formatador(casas) {
        if (!formatadores[casas]) {
            formatadores[casas] = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
        }
        return formatadores[casas];
    }

    {{PX_UPPER}}.Num = {
        /* Texto da tela ("R$ 1.234,56", "12,5%") -> numero. Retorna null se vazio/invalido. */
        fromTela: function (valor) {
            if (valor === null || valor === undefined) return null;
            var v = String(valor).replace(/R\$/g, '').replace(/\s+/g, '').replace(/%$/, '');
            if (v === '' || v === '-') return null;
            v = v.replace(/\./g, '').replace(',', '.');
            if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
            var n = Number(v);
            return isFinite(n) ? n : null;
        },

        /* Valor do banco ("1234.50", "null", "") -> numero. Retorna null se vazio/invalido. */
        fromBanco: function (valor) {
            if (valor === null || valor === undefined) return null;
            var v = String(valor).trim();
            if (v === '' || v.toLowerCase() === 'null') return null;
            var n = Number(v.replace(',', '.'));
            return isFinite(n) ? n : null;
        },

        /* 1234.5 -> "1.234,50" (casas fixas). */
        format: function (n, casas) {
            if (n === null || n === undefined || !isFinite(n)) return '';
            return formatador(casas === undefined ? 0 : casas).format(n);
        },

        /* 1234.5 -> "R$ 1.234,50". */
        formatMoeda: function (n) {
            var s = {{PX_UPPER}}.Num.format(n, 2);
            return s === '' ? '' : 'R$ ' + s;
        },

        /* 12.5 -> "12,50%". */
        formatPercent: function (n, casas) {
            var s = {{PX_UPPER}}.Num.format(n, casas === undefined ? 2 : casas);
            return s === '' ? '' : s + '%';
        },

        /* Arredonda sem ruido de ponto flutuante (0.1 + 0.2 -> 0.3). */
        round: function (n, casas) {
            var f = Math.pow(10, casas === undefined ? 2 : casas);
            return Math.round((n + (n >= 0 ? 1 : -1) * 1e-9) * f) / f;
        },

        /* Numero -> texto para o dataset ("1234.5"). Lanca erro se nao for numero finito. */
        toBanco: function (n, casas) {
            if (n === null || n === undefined || !isFinite(n)) {
                throw new Error('Valor numerico invalido para gravacao: ' + n);
            }
            return String({{PX_UPPER}}.Num.round(Number(n), casas === undefined ? 2 : casas));
        }
    };

    // -------------------------------------------------------------------------
    // Datas
    // -------------------------------------------------------------------------
    var RE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
    var RE_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

    function dataValida(a, m, d) {
        var dt = new Date(Date.UTC(a, m - 1, d));
        return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    {{PX_UPPER}}.Data = {
        /* "aaaa-mm-dd[ hh:mm]" ou "dd/mm/aaaa" -> "aaaa-mm-dd". Retorna "" se invalida. */
        toISO: function (valor) {
            var v = (valor === null || valor === undefined) ? '' : String(valor).trim();
            if (v === '' || v.toLowerCase() === 'null') return '';
            var m = v.match(RE_ISO);
            if (m) return dataValida(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : '';
            m = v.match(RE_BR);
            if (m) return dataValida(+m[3], +m[2], +m[1]) ? m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]) : '';
            return '';
        },

        /* "aaaa-mm-dd" (ou dd/mm/aaaa) -> "dd/mm/aaaa". Retorna "" se invalida. */
        toBR: function (valor) {
            var iso = {{PX_UPPER}}.Data.toISO(valor);
            var m = iso.match(RE_ISO);
            return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
        },

        /* Data local de hoje em ISO. */
        hojeISO: function () {
            var d = new Date();
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        },

        /* Diferenca em dias (a - b) entre duas datas ISO. Retorna null se alguma for invalida. */
        diffDias: function (isoA, isoB) {
            var a = String(isoA || '').match(RE_ISO), b = String(isoB || '').match(RE_ISO);
            if (!a || !b) return null;
            return Math.round((Date.UTC(+a[1], +a[2] - 1, +a[3]) - Date.UTC(+b[1], +b[2] - 1, +b[3])) / 86400000);
        }
    };

    // -------------------------------------------------------------------------
    // DOM
    // -------------------------------------------------------------------------
    {{PX_UPPER}}.Dom = {
        byId: function (id) { return document.getElementById(id); },
        qs: function (sel, raiz) { return (raiz || document).querySelector(sel); },
        qsa: function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); },
        valor: function (id) {
            var el = document.getElementById(id);
            return el ? String(el.value === null || el.value === undefined ? '' : el.value).trim() : '';
        },
        setValor: function (id, v) {
            var el = document.getElementById(id);
            if (el) el.value = (v === null || v === undefined) ? '' : v;
        },
        show: function (el) { if (el) el.hidden = false; },
        hide: function (el) { if (el) el.hidden = true; },
        /* Escapa texto para uso seguro dentro de HTML (mensagens, modal). */
        escape: function (s) {
            return String(s === null || s === undefined ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },
        /* "CAMPO___3" -> { base: "CAMPO", seq: "3" }; "CAMPO" -> { base: "CAMPO", seq: "" }. */
        separarSeq: function (id) {
            var partes = String(id || '').split('___');
            return { base: partes[0], seq: partes.length > 1 ? partes[1] : '' };
        }
    };

    // -------------------------------------------------------------------------
    // Notificacoes (somente componentes do Fluig)
    // -------------------------------------------------------------------------
    {{PX_UPPER}}.Notify = {
        /* tipo: success | warning | danger | info */
        toast: function (tipo, titulo, mensagem) {
            if (global.FLUIGC && FLUIGC.toast) {
                FLUIGC.toast({ title: titulo, message: mensagem, type: tipo, timeout: tipo === 'danger' ? 10000 : 6000 });
            } else {
                {{PX_UPPER}}.log.warn(titulo, mensagem);
            }
        },

        /* Modal informativo com conteudo HTML (ja escapado por quem chama). */
        modal: function (titulo, html, rotuloBotao) {
            if (!(global.FLUIGC && FLUIGC.modal)) {
                {{PX_UPPER}}.Notify.toast('warning', titulo, String(html).replace(/<[^>]+>/g, ' '));
                return null;
            }
            return FLUIGC.modal({
                title: titulo,
                content: html,
                id: '{{PX}}-modal',
                size: 'large',
                actions: [{ label: rotuloBotao || 'Entendi', autoClose: true }]
            });
        }
    };
})(window);
