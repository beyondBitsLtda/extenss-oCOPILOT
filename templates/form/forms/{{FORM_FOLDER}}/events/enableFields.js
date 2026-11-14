/**
 * =============================================================================
 * {{TITULO}} - events/enableFields.js
 * -----------------------------------------------------------------------------
 * Evento de servidor (Rhino / ES5 puro). Sem DOM aqui.
 * setEnhancedSecurityHiddenInputs(true): padrao da equipe; liga a seguranca
 * aprimorada do Fluig para campos hidden bloqueados no servidor (form.setEnabled),
 * impedindo que o navegador altere seus valores. A habilitacao visual por atividade fica no
 * cliente ({{PX}}.app.js -> aplicarEdicao). Para bloquear no servidor use
 * form.setEnabled("CAMPO", false) aqui, por atividade (getValue("WKNumState")).
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
function enableFields(form) {
    form.setEnhancedSecurityHiddenInputs(true);
}
