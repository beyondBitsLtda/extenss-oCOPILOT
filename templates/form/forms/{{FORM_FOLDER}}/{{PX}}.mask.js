/**
 * =============================================================================
 * {{TITULO}} - {{PX}}.mask.js
 * -----------------------------------------------------------------------------
 * MaskController: mascaras de digitacao para todo campo com data-mask.
 *
 *   data-mask="inteiro"     -> somente digitos                 exibe "1.234"
 *   data-mask="decimal"     -> digitos + virgula (2 casas)     exibe "1.234,50"
 *   data-mask="moeda"       -> igual ao decimal                exibe "R$ 1.234,50"
 *   data-mask="percentual"  -> igual ao decimal                exibe "12,50%"
 *
 * Comportamento:
 *   - Sinal de menos bloqueado (nenhum campo digitavel aceita negativo).
 *   - Ao focar, volta ao formato de edicao ("1.234,50" -> "1234,5").
 *   - Ponto digitado vira virgula; colar "1.234,56" (Excel) e interpretado corretamente.
 *   - Ao sair, formata e dispara o evento jQuery '{{PX}}:changed' (usado para recalculos).
 *   - Eventos delegados no document: valem para linhas novas do pai-filho.
 *   - Para gravar no banco use {{PX_UPPER}}.Num.fromTela(valor) + {{PX_UPPER}}.Num.toBanco(n).
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
(function (global) {
    'use strict';

    var {{PX_UPPER}} = global.{{PX_UPPER}};
    var TECLAS_CONTROLE = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End', 'Escape', 'Enter'];

    function MaskController(raiz) {
        this.raiz = raiz || document;
        this.casas = {{PX_UPPER}}.Config.CASAS_DECIMAIS;
        this.ativo = false;
    }

    /* Liga os listeners delegados (idempotente). */
    MaskController.prototype.iniciar = function () {
        if (this.ativo) return;
        this.ativo = true;
        var r = this.raiz;
        r.addEventListener('focusin', this.onFocus.bind(this));
        r.addEventListener('keydown', this.onKeydown.bind(this));
        r.addEventListener('input', this.onInput.bind(this));
        r.addEventListener('paste', this.onPaste.bind(this));
        r.addEventListener('focusout', this.onBlur.bind(this));
    };

    /* Tipo de mascara do elemento (null se nao tiver ou se estiver bloqueado). */
    MaskController.prototype.tipo = function (el) {
        if (!el || !el.getAttribute || el.readOnly || el.disabled) return null;
        return el.getAttribute('data-mask');
    };

    /* Formata todos os campos com mascara (usar apos carregar valores). */
    MaskController.prototype.formatarTodos = function () {
        var self = this;
        {{PX_UPPER}}.Dom.qsa('[data-mask]', this.raiz).forEach(function (el) {
            var tipo = el.getAttribute('data-mask');
            if (el.value) el.value = self.formatar(el.value, tipo);
        });
    };

    // ------------------------------------------------------------------ eventos

    MaskController.prototype.onFocus = function (e) {
        var el = e.target, tipo = this.tipo(el);
        if (!tipo) return;
        var valor = el.value = this.paraEdicao(el.value, tipo);
        /* selecao adiada: o mouseup do clique desfaria uma selecao imediata */
        setTimeout(function () {
            if (document.activeElement === el && el.value === valor) {
                try { el.select(); } catch (err) { /* campo removido */ }
            }
        }, 0);
    };

    MaskController.prototype.onKeydown = function (e) {
        var el = e.target, tipo = this.tipo(el);
        if (!tipo) return;
        if (e.ctrlKey || e.metaKey || e.altKey || !e.key || e.key.length !== 1 || TECLAS_CONTROLE.indexOf(e.key) >= 0) return;

        var digito = /^\d$/.test(e.key);
        var separador = (e.key === ',' || e.key === '.') && tipo !== 'inteiro';
        if (!digito && !separador) { e.preventDefault(); return; }

        if (separador && el.value.indexOf(',') >= 0 && el.selectionStart === el.selectionEnd) { e.preventDefault(); return; }

        if (digito && tipo !== 'inteiro' && el.selectionStart === el.selectionEnd) {
            var virgula = el.value.indexOf(',');
            if (virgula >= 0 && el.selectionStart > virgula && el.value.length - virgula - 1 >= this.casas) e.preventDefault();
        }
    };

    MaskController.prototype.onInput = function (e) {
        var el = e.target, tipo = this.tipo(el);
        if (!tipo) return;
        var limpo = this.sanitizar(el.value, tipo);
        if (limpo !== el.value) {
            el.value = limpo;
            try { el.setSelectionRange(limpo.length, limpo.length); } catch (err) { /* tipo sem selecao */ }
        }
    };

    MaskController.prototype.onPaste = function (e) {
        var el = e.target, tipo = this.tipo(el);
        if (!tipo) return;
        e.preventDefault();
        var dados = e.clipboardData || global.clipboardData;
        var colado = this.normalizarColado(dados ? dados.getData('text') : '', tipo);
        var ini = el.selectionStart || 0, fim = el.selectionEnd || 0;
        el.value = this.sanitizar(el.value.slice(0, ini) + colado + el.value.slice(fim), tipo);
    };

    MaskController.prototype.onBlur = function (e) {
        var el = e.target, tipo = this.tipo(el);
        if (!tipo) return;
        el.value = this.formatar(el.value, tipo);
        if (global.jQuery) global.jQuery(el).trigger('{{PX}}:changed');
    };

    // ------------------------------------------------------------------ transformacoes

    /* Remove caracteres invalidos durante a digitacao. */
    MaskController.prototype.sanitizar = function (valor, tipo) {
        var v = String(valor || '');
        if (tipo === 'inteiro') return v.replace(/\D/g, '');
        v = v.replace(/\./g, ',').replace(/[^\d,]/g, '');
        var i = v.indexOf(',');
        if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '').slice(0, this.casas);
        return v;
    };

    /* Interpreta texto colado (Excel, e-mail) como numero positivo. */
    MaskController.prototype.normalizarColado = function (textoColado, tipo) {
        var t = String(textoColado || '').replace(/[^\d.,]/g, '');
        if (tipo === 'inteiro') return t.replace(/[.,]\d{1,2}$/, '').replace(/\D/g, '');
        var temPonto = t.indexOf('.') >= 0, temVirgula = t.indexOf(',') >= 0;
        if (temPonto && temVirgula) t = t.replace(/\./g, '');                              /* 1.234,56 */
        else if (temPonto && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');  /* 1.234.567 */
        return t.replace('.', ',');
    };

    /* Valor exibido -> valor de edicao (sem milhar, sem R$ e sem %). */
    MaskController.prototype.paraEdicao = function (valor, tipo) {
        var n = {{PX_UPPER}}.Num.fromTela(valor);
        if (n === null) return this.sanitizar(valor, tipo);
        return tipo === 'inteiro' ? String(Math.floor(n)) : String(n).replace('.', ',');
    };

    /* Valor de edicao -> valor exibido. */
    MaskController.prototype.formatar = function (valor, tipo) {
        var n = {{PX_UPPER}}.Num.fromTela(valor);
        if (n === null) {
            var bruto = this.sanitizar(valor, tipo);
            if (bruto === '' || bruto === ',') return '';
            n = {{PX_UPPER}}.Num.fromTela(bruto);
            if (n === null) return '';
        }
        if (tipo === 'inteiro') return {{PX_UPPER}}.Num.format(Math.floor(n), 0);
        if (tipo === 'moeda') return {{PX_UPPER}}.Num.formatMoeda(n);
        if (tipo === 'percentual') return {{PX_UPPER}}.Num.formatPercent(n, this.casas);
        return {{PX_UPPER}}.Num.format(n, this.casas);
    };

    {{PX_UPPER}}.MaskController = MaskController;
})(window);
