/* ============================================================================
 * Objects.js - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * Construcao de OBJETOS, CLASSES e METODOS GLOBAIS da widget (POO).
 *
 * Requisitos inegociaveis respeitados:
 *   - POO com prototype (ES5 - compatibilidade Fluig / navegadores corporativos)
 *   - DRY: wrapper UNICO de dataset - todo modulo consome daqui
 *   - Namespace global: window.{{NS}}
 *
 * Este arquivo expoe:
 *   {{NS}}.VERSAO     -> versao da widget (IGUAL ao application.version)
 *   {{NS}}.const      -> dominios e constantes
 *   {{NS}}.util       -> helpers de escape / formatacao / log
 *   {{NS}}.dataset    -> wrapper unico de acesso a datasets (REST, assincrono)
 *   {{NS}}.usuario    -> identidade do usuario logado (preenchida no boot)
 *   {{NS}}.store      -> estado em memoria com eventos (on/emit)
 *   Classes de dominio: Registro (exemplo - renomeie conforme a entidade)
 *
 * Ordem de carga no application.info:
 *   Objects.js e o PRIMEIRO arquivo da widget (depois apenas das libs).
 *
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
(function (global, $) {
    'use strict';

    // ------------------------------------------------------------------
    // Namespace raiz
    // ------------------------------------------------------------------
    var {{NS}} = global.{{NS}} = global.{{NS}} || {};

    {{NS}}.componentes = {{NS}}.componentes || {};
    {{NS}}.integre     = {{NS}}.integre     || {};
    {{NS}}.ds          = {{NS}}.ds          || {};
    {{NS}}.util        = {{NS}}.util        || {};

    /* SOBE A CADA PUBLICACAO, junto com application.version (application.info).
       O build-widget.js reprova o WAR se os dois divergirem: o carimbo no
       rodape e o que distingue "codigo errado" de "cache velho". */
    {{NS}}.VERSAO = '1.0.0';

    var PREFIXO = '[{{CODE}}]';

    // ==================================================================
    // {{NS}}.const - dominios da aplicacao
    // ------------------------------------------------------------------
    // Ponto UNICO: nenhum modulo redeclara lista de status, acao ou nome
    // de dataset nativo.
    // ==================================================================
    {{NS}}.const = {
        ACOES: { LISTAR: 'LISTAR', SALVAR: 'SALVAR' },
        STATUS_OK: 'OK',
        DATASET_COLLEAGUE: 'colleague',
        SITUACAO: {
            ATIVO:   { rotulo: 'Ativo',   badge: 'ok' },
            INATIVO: { rotulo: 'Inativo', badge: 'neutro' }
        }
    };

    // ==================================================================
    // {{NS}}.util - helpers sem estado
    // ==================================================================
    var util = {{NS}}.util;

    util.log   = function (m, x) { if (x !== undefined) { console.log(PREFIXO, m, x); } else { console.log(PREFIXO, m); } };
    util.aviso = function (m, x) { if (x !== undefined) { console.warn(PREFIXO, m, x); } else { console.warn(PREFIXO, m); } };
    util.erro  = function (m, x) { if (x !== undefined) { console.error(PREFIXO, m, x); } else { console.error(PREFIXO, m); } };

    /** Vazio = null, undefined ou texto so com espacos. */
    util.vazio = function (v) {
        return v === null || v === undefined || String(v).replace(/^\s+|\s+$/g, '') === '';
    };

    /** Primeiro valor nao vazio (o dataset devolve '' para nulo). */
    util.ou = function (v, padrao) {
        return util.vazio(v) ? padrao : v;
    };

    /* Escape de HTML. Todo texto vindo do banco passa por aqui (ou por .text())
       antes de ir para a tela. */
    util.esc = function (v) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    /** Converte '1.234,56' ou '1234.56' em numero. Invalido -> 0. */
    util.paraNumero = function (v) {
        if (typeof v === 'number') { return isFinite(v) ? v : 0; }
        var s = String(v === null || v === undefined ? '' : v).replace(/\s/g, '');
        if (s.indexOf(',') >= 0) { s = s.replace(/\./g, '').replace(',', '.'); }
        var n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    };

    /** Numero no padrao pt-BR: 1.234,56 (sem depender de Intl). */
    util.formatarNumero = function (v, casas) {
        var c = (casas === undefined || casas === null) ? 0 : casas;
        var n = util.paraNumero(v);
        var negativo = n < 0;
        var partes = Math.abs(n).toFixed(c).split('.');
        var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return (negativo ? '-' : '') + inteiro + (partes[1] ? ',' + partes[1] : '');
    };

    function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

    /**
     * Data para exibicao (dd/mm/aaaa, opcionalmente com hh:mm).
     * Aceita Date, timestamp em ms, 'AAAA-MM-DD[ HH:MM[:SS]]' e 'dd/mm/aaaa'.
     */
    util.formatarData = function (v, comHora) {
        if (util.vazio(v)) { return ''; }
        var d = null;
        if (v instanceof Date) {
            d = v;
        } else if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) {
            d = new Date(Number(v));
        } else {
            var s = String(v);
            var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
            if (m) {
                d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                             Number(m[4] || 0), Number(m[5] || 0));
            } else if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
                return comHora ? s.substring(0, 16) : s.substring(0, 10);
            }
        }
        if (!d || isNaN(d.getTime())) { return String(v); }
        var txt = doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1) + '/' + d.getFullYear();
        if (comHora) { txt += ' ' + doisDigitos(d.getHours()) + ':' + doisDigitos(d.getMinutes()); }
        return txt;
    };

    // ==================================================================
    // {{NS}}.dataset - PONTO UNICO de contato com o backend Fluig
    // ------------------------------------------------------------------
    // Endpoint REST assincrono. NUNCA usar DatasetFactory.getDataset
    // sincrono em fluxo de UI: trava a aba enquanto o servidor responde.
    //
    // Contrato com quem chama: chamar() resolve SEMPRE com um array de
    // objetos { COLUNA: valor } (ja normalizado) e rejeita com
    // { mensagem, status, dataset, naoPublicado }.
    // ==================================================================
    {{NS}}.dataset = {

        endpoint: '/api/public/ecm/dataset/datasets',
        TIMEOUT: 120000,

        /* Constraint de igualdade (_type 0 = MUST). O _finalValue IGUAL ao
           inicial e obrigatorio: sem ele o dataset devolve vazio sem acusar. */
        cs: function (campo, valor) {
            var v = (valor === null || valor === undefined) ? '' : String(valor);
            return { _field: String(campo), _initialValue: v, _finalValue: v, _type: 0 };
        },

        /**
         * Chama um dataset e resolve com o ARRAY DE LINHAS normalizado.
         * @param  {string} nome         nome do dataset no Fluig (maiusculas contam)
         * @param  {Array}  constraints  lista de {{NS}}.dataset.cs(...)
         * @return {Promise}             jQuery promise de Array<Object>
         */
        chamar: function (nome, constraints) {
            var self = this;
            var dfd = $.Deferred();
            var corpo = { name: String(nome), constraints: constraints || [], fields: [], order: [] };

            $.ajax({
                url: self.endpoint,
                method: 'POST',
                contentType: 'application/json',
                dataType: 'json',
                timeout: self.TIMEOUT,
                data: JSON.stringify(corpo),
                success: function (res) {
                    /* RESPOSTA SEM LISTA NAO E "ZERO LINHAS". O Fluig responde
                       HTTP 200 com {content:{}} ou values nulo quando o dataset
                       nao existe ou nao compilou. Tratar como lista vazia faria a
                       tela dizer "nenhum registro" com o banco cheio.
                       values ARRAY (mesmo vazio) = resposta legitima. */
                    var valores = (res && res.content) ? res.content.values : null;
                    if (Object.prototype.toString.call(valores) !== '[object Array]') {
                        var recado = 'O dataset "' + nome + '" não respondeu uma lista de dados. ' +
                            'Confira se ele está publicado no Fluig com esse nome exato ' +
                            '(maiúsculas e minúsculas contam) e se compilou sem erro.';
                        util.erro(recado, res);
                        dfd.reject({ mensagem: recado, status: 200, dataset: String(nome), naoPublicado: true });
                        return;
                    }

                    var linhas = self.linhas(res);

                    /* SUCESSO HTTP CARREGANDO UM ERRO: o catch do dataset devolve
                       1 linha com 'ERRO: ...' na 1a coluna. */
                    var erro = self._erroDoDataset(res, linhas);
                    if (erro) {
                        util.erro('Dataset ' + nome + ' respondeu com erro: ' + erro);
                        dfd.reject({ mensagem: erro, status: 200, dataset: String(nome), naoPublicado: false });
                        return;
                    }

                    dfd.resolve(linhas);
                },
                error: function (xhr, textStatus) {
                    var status = xhr ? xhr.status : 0;
                    var msg = (textStatus === 'timeout')
                        ? 'O servidor demorou demais para responder (' + nome + ').'
                        : 'Falha ao consultar ' + nome + ' (HTTP ' + (status || '?') + ').';
                    util.erro(msg, xhr && xhr.responseText ? String(xhr.responseText).substring(0, 200) : '');
                    dfd.reject({ mensagem: msg, status: status, dataset: String(nome), naoPublicado: false });
                }
            });

            return dfd.promise();
        },

        /* Normaliza a resposta crua: values pode vir como array de objetos
           (nome da coluna na chave) OU array de arrays posicionais + columns. */
        linhas: function (res) {
            try {
                var vals = (res && res.content && res.content.values) || [];
                var cols = (res && res.content && res.content.columns) || [];
                if (!vals.length) { return []; }
                if (Object.prototype.toString.call(vals[0]) !== '[object Array]') { return vals; }
                var saida = [];
                for (var i = 0; i < vals.length; i++) {
                    var obj = {};
                    for (var c = 0; c < cols.length; c++) { obj[cols[c]] = vals[i][c]; }
                    saida.push(obj);
                }
                return saida;
            } catch (e) {
                util.erro('Resposta de dataset ilegível.', e);
                return [];
            }
        },

        /* So a PRIMEIRA coluna de uma resposta de UMA linha e examinada: varrer
           todas pegaria texto livre que comece com "ERRO: ". O prefixo exige os
           dois pontos, entao STATUS='ERRO' (resposta tratada) nao casa.
           @return {string|null} a mensagem, ou null quando a resposta e boa. */
        _erroDoDataset: function (res, linhas) {
            if (!linhas || linhas.length !== 1) { return null; }
            var linha = linhas[0], coluna = null;
            var cols = res && res.content && res.content.columns;
            if (cols && cols.length) { coluna = cols[0]; }
            if (!coluna) {
                for (var k in linha) {
                    if (Object.prototype.hasOwnProperty.call(linha, k)) { coluna = k; break; }
                }
            }
            if (!coluna) { return null; }
            var valor = String(linha[coluna] === null || linha[coluna] === undefined ? '' : linha[coluna]);
            return valor.indexOf('ERRO: ') === 0 ? valor.substring(6) : null;
        },

        /* Leitura unica do contrato de escrita: STATUS | MENSAGEM | ID.
           Nenhuma linha = falha, nunca sucesso silencioso. */
        resultado: function (linhas) {
            var l = (linhas && linhas.length) ? linhas[0] : null;
            if (!l) { return { ok: false, mensagem: 'O servidor não devolveu resposta.', id: '' }; }
            var ok = String(l.STATUS || '').toUpperCase() === {{NS}}.const.STATUS_OK;
            return {
                ok: ok,
                mensagem: String(util.ou(l.MENSAGEM, ok ? 'Concluído.' : 'Falha não detalhada.')),
                id: String(util.ou(l.ID, ''))
            };
        }
    };

    // ==================================================================
    // {{NS}}.usuario - identidade do usuario logado
    // ------------------------------------------------------------------
    // Preenchida pelo Controller no boot (WCMAPI.userCode -> colleague).
    // Serve so para EXIBICAO: o servidor sempre usa getValue('WKUser').
    // ==================================================================
    {{NS}}.usuario = {
        guid: '', login: '', nome: '', email: '',
        definir: function (d) {
            d = d || {};
            this.guid  = String(util.ou(d.guid, ''));
            this.login = String(util.ou(d.login, ''));
            this.nome  = String(util.ou(d.nome, ''));
            this.email = String(util.ou(d.email, ''));
        },
        exibir: function () {
            return this.nome || this.login || 'Usuário';
        }
    };

    // ==================================================================
    // Registro - classe de dominio de EXEMPLO
    // ------------------------------------------------------------------
    // Colunas esperadas do dataset (acao LISTAR): ID, CODIGO, NOME, VALOR,
    // ATIVO, RECMODIFIEDON. Renomeie a classe e os campos conforme a
    // entidade real; os modulos de tela so conhecem as propriedades, nunca
    // o nome das colunas.
    // ==================================================================
    function Registro(dados) {
        var d = dados || {};
        this.id           = String(util.ou(d.id, ''));
        this.codigo       = String(util.ou(d.codigo, ''));
        this.nome         = String(util.ou(d.nome, ''));
        this.valor        = util.paraNumero(d.valor);
        this.ativo        = d.ativo !== false;
        this.atualizadoEm = String(util.ou(d.atualizadoEm, ''));
    }

    /** Linha do dataset -> objeto de dominio. */
    Registro.deLinha = function (l) {
        l = l || {};
        var ativo = String(util.ou(l.ATIVO, '1')).toLowerCase();
        return new Registro({
            id:           l.ID,
            codigo:       l.CODIGO,
            nome:         l.NOME,
            valor:        l.VALOR,
            ativo:        (ativo === '1' || ativo === 'true' || ativo === 's'),
            atualizadoEm: l.RECMODIFIEDON
        });
    };

    Registro.prototype.novo = function () { return util.vazio(this.id); };

    Registro.prototype.situacao = function () {
        return this.ativo ? {{NS}}.const.SITUACAO.ATIVO : {{NS}}.const.SITUACAO.INATIVO;
    };

    /** @return {Array<string>} mensagens de erro (vazio = valido). */
    Registro.prototype.validar = function () {
        var erros = [];
        if (util.vazio(this.codigo)) { erros.push('Informe o código.'); }
        if (util.vazio(this.nome)) { erros.push('Informe o nome.'); }
        if (this.nome.length > 200) { erros.push('O nome deve ter no máximo 200 caracteres.'); }
        if (this.valor < 0) { erros.push('O valor não pode ser negativo.'); }
        return erros;
    };

    /** Constraints da acao SALVAR: insere sem _ID, atualiza com _ID. */
    Registro.prototype.paraConstraints = function () {
        var cs = {{NS}}.dataset.cs;
        var c = [cs('_PAYLOAD', JSON.stringify({
            CODIGO: this.codigo,
            NOME:   this.nome,
            VALOR:  String(this.valor),
            ATIVO:  this.ativo ? '1' : '0'
        }))];
        if (!this.novo()) { c.push(cs('_ID', this.id)); }
        return c;
    };

    {{NS}}.Registro = Registro;

    // ==================================================================
    // {{NS}}.store - estado em memoria com eventos
    // ------------------------------------------------------------------
    // {{NS}}.store.on('registros', function (lista) { ... });
    // {{NS}}.store.set('registros', lista);   // dispara 'registros'
    // ==================================================================
    function Store() {
        this._dados = {};
        this._ouvintes = {};
    }

    Store.prototype.get = function (chave) { return this._dados[chave]; };

    Store.prototype.set = function (chave, valor) {
        this._dados[chave] = valor;
        this.emit(chave, valor);
    };

    Store.prototype.on = function (evento, fn) {
        if (typeof fn !== 'function') { return; }
        (this._ouvintes[evento] = this._ouvintes[evento] || []).push(fn);
    };

    Store.prototype.off = function (evento, fn) {
        var l = this._ouvintes[evento] || [];
        for (var i = l.length - 1; i >= 0; i--) {
            if (!fn || l[i] === fn) { l.splice(i, 1); }
        }
    };

    Store.prototype.emit = function (evento, dados) {
        var l = (this._ouvintes[evento] || []).slice();
        for (var i = 0; i < l.length; i++) {
            try { l[i](dados); } catch (e) { util.erro('Ouvinte de "' + evento + '" falhou.', e); }
        }
    };

    {{NS}}.Store = Store;
    {{NS}}.store = new Store();

}(window, jQuery));
