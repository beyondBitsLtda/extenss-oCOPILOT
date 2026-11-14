/**
 * =============================================================================
 * {{TITULO}} - {{PX}}.validator.js
 * -----------------------------------------------------------------------------
 * FormValidator: validacao antes do envio (chamado por beforeSendValidate).
 *
 *   - Obrigatorios: todo campo com atributo [required] que esteja habilitado e
 *     visivel. Em pai-filho (table[tablename]) so valem ids com "___" (a 1a linha
 *     e o template oculto do Fluig e nunca e validada).
 *   - Regras de negocio: funcoes registradas com adicionarRegra(fn). Cada fn
 *     devolve um array de { el, rotulo, mensagem } (vazio = ok).
 *   - Resumo agrupado por secao (data-titulo da <section>) em FLUIGC.modal
 *     (fallback toast), campo invalido marcado e rolagem ate o 1o erro.
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
(function (global) {
    'use strict';

    var {{PX_UPPER}} = global.{{PX_UPPER}};
    var Dom = {{PX_UPPER}}.Dom;
    var CLASSE_INVALIDO = '{{PX}}-field--invalido';
    var SELETOR_CAMPOS = 'input[required], select[required], textarea[required]';

    function FormValidator(form) {
        this.form = form || document.querySelector('form[name="form"]') || document;
        this.regras = [];
        this.ligarLimpeza();
    }

    /* Registra uma regra de negocio: fn() -> [{ el, rotulo, mensagem }]. */
    FormValidator.prototype.adicionarRegra = function (fn) {
        if (typeof fn === 'function') this.regras.push(fn);
        return this;
    };

    /* Remove a marcacao de erro assim que o usuario altera o campo. */
    FormValidator.prototype.ligarLimpeza = function () {
        var self = this;
        var limpar = function (e) { self.desmarcar(e.target); };
        this.form.addEventListener('input', limpar);
        this.form.addEventListener('change', limpar);
    };

    // ------------------------------------------------------------------ apoio

    /* true se o elemento esta dentro de algo oculto ([hidden] ou display:none). */
    FormValidator.prototype.oculto = function (el) {
        var no = el;
        while (no && no !== this.form && no.nodeType === 1) {
            if (no.hidden) return true;
            if (global.getComputedStyle && no.type !== 'hidden' && no.tagName !== 'SELECT' &&
                global.getComputedStyle(no).display === 'none') return true;
            no = no.parentNode;
        }
        return false;
    };

    /* true se o campo e a linha template de uma tabela pai-filho. */
    FormValidator.prototype.ehTemplatePaiFilho = function (el) {
        var tabela = global.jQuery ? global.jQuery(el).closest('table[tablename]')[0] : null;
        return !!tabela && String(el.id || '').indexOf('___') < 0;
    };

    FormValidator.prototype.vazio = function (el) {
        if (el.type === 'checkbox' || el.type === 'radio') {
            return !Dom.qsa('input[name="' + el.name + '"]', this.form).some(function (o) { return o.checked; });
        }
        var v = global.jQuery ? global.jQuery(el).val() : el.value;   /* zoom (select2) devolve array */
        if (v === null || v === undefined) return true;
        if (Object.prototype.toString.call(v) === '[object Array]') return v.length === 0;
        return String(v).trim() === '';
    };

    /* Rotulo amigavel: aria-label, label[for] ou id. Em pai-filho acrescenta a linha. */
    FormValidator.prototype.rotulo = function (el) {
        var partes = Dom.separarSeq(el.id);
        var texto = el.getAttribute('aria-label') || '';
        if (!texto) {
            var label = this.form.querySelector('label[for="' + partes.base + '"]') ||
                this.form.querySelector('label[for="' + el.id + '"]');
            texto = label ? String(label.textContent || '').replace(/\*/g, '').trim() : partes.base;
        }
        if (partes.seq && global.jQuery) {
            var linha = global.jQuery(el).closest('tr');
            var posicao = linha.parent().children('tr').not(':first').index(linha) + 1;
            texto += ' (linha ' + (posicao > 0 ? posicao : partes.seq) + ')';
        }
        return texto;
    };

    /* Titulo do grupo: data-titulo da secao que contem o campo. */
    FormValidator.prototype.grupo = function (el) {
        var secao = global.jQuery ? global.jQuery(el).closest('[data-titulo]')[0] : null;
        return secao ? secao.getAttribute('data-titulo') : 'Formulário';
    };

    FormValidator.prototype.marcar = function (el) {
        if (!el) return;
        el.setAttribute('aria-invalid', 'true');
        var alvo = global.jQuery ? global.jQuery(el).closest('.form-group, td')[0] : null;
        if (alvo) alvo.classList.add(CLASSE_INVALIDO);
    };

    FormValidator.prototype.desmarcar = function (el) {
        if (!el || !el.removeAttribute) return;
        el.removeAttribute('aria-invalid');
        var alvo = global.jQuery ? global.jQuery(el).closest('.' + CLASSE_INVALIDO)[0] : null;
        if (alvo) alvo.classList.remove(CLASSE_INVALIDO);
    };

    FormValidator.prototype.limparMarcas = function () {
        Dom.qsa('.' + CLASSE_INVALIDO, this.form).forEach(function (n) { n.classList.remove(CLASSE_INVALIDO); });
        Dom.qsa('[aria-invalid="true"]', this.form).forEach(function (n) { n.removeAttribute('aria-invalid'); });
    };

    // ------------------------------------------------------------------ validacao

    /* @returns { valido, total, erros: [{ el, rotulo, mensagem, grupo }] } */
    FormValidator.prototype.validar = function () {
        var self = this, erros = [];
        this.limparMarcas();

        Dom.qsa(SELETOR_CAMPOS, this.form).forEach(function (el) {
            if (el.disabled || self.ehTemplatePaiFilho(el) || self.oculto(el)) return;
            if (self.vazio(el)) erros.push({ el: el, rotulo: self.rotulo(el), mensagem: '', obrigatorio: true });
        });

        this.regras.forEach(function (regra) {
            var r;
            try { r = regra() || []; } catch (e) {
                {{PX_UPPER}}.log.error('Falha em regra de validacao', e);
                r = [{ el: null, rotulo: 'Validação', mensagem: 'Não foi possível validar: ' + (e.message || e) }];
            }
            erros = erros.concat(r);
        });

        erros.forEach(function (e) {
            e.grupo = e.el ? self.grupo(e.el) : 'Formulário';
            self.marcar(e.el);
        });
        return { valido: erros.length === 0, total: erros.length, erros: erros };
    };

    /* Exibe o resumo agrupado e rola ate o primeiro campo invalido. */
    FormValidator.prototype.exibir = function (resultado) {
        var esc = Dom.escape, grupos = {}, ordem = [];

        resultado.erros.forEach(function (e) {
            if (!grupos[e.grupo]) { grupos[e.grupo] = { obrigatorios: [], regras: [] }; ordem.push(e.grupo); }
            if (e.obrigatorio) grupos[e.grupo].obrigatorios.push(e.rotulo);
            else grupos[e.grupo].regras.push(e);
        });

        var html = '<div class="{{PX}} {{PX}}-errors"><p class="{{PX}}-errors__intro">Corrija os campos destacados e envie novamente.</p>';
        ordem.forEach(function (nome) {
            var g = grupos[nome];
            html += '<section class="{{PX}}-errors__group"><h3 class="{{PX}}-errors__title">' + esc(nome) +
                ' <span class="{{PX}}-errors__count">' + (g.obrigatorios.length + g.regras.length) + '</span></h3>' +
                '<ul class="{{PX}}-errors__list">';
            if (g.obrigatorios.length) {
                html += '<li class="{{PX}}-errors__item"><strong>Preenchimento obrigatório:</strong> ' +
                    g.obrigatorios.map(esc).join(', ') + '</li>';
            }
            g.regras.forEach(function (e) {
                html += '<li class="{{PX}}-errors__item"><strong>' + esc(e.rotulo) + ':</strong> ' + esc(e.mensagem) + '</li>';
            });
            html += '</ul></section>';
        });
        html += '</div>';

        var titulo = resultado.total === 1 ? '1 pendência impede o envio' : resultado.total + ' pendências impedem o envio';
        {{PX_UPPER}}.Notify.modal(titulo, html, 'Vou corrigir');

        var primeiro = null;
        resultado.erros.some(function (e) { primeiro = e.el; return !!primeiro; });
        if (primeiro) {
            var alvo = (global.jQuery && global.jQuery(primeiro).closest('.form-group, td')[0]) || primeiro;
            try { alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) { alvo.scrollIntoView(); }
            try { if (primeiro.type !== 'hidden') primeiro.focus({ preventScroll: true }); } catch (err2) { /* navegador antigo */ }
        }
    };

    {{PX_UPPER}}.FormValidator = FormValidator;
})(window);
