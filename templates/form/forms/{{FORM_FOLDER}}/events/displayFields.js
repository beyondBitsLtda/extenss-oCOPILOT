/**
 * =============================================================================
 * {{TITULO}} - events/displayFields.js
 * -----------------------------------------------------------------------------
 * Evento de servidor (Rhino / ES5 puro). Executado antes de renderizar o
 * formulario. Preenche os campos ocultos de controle lidos pelo cliente
 * ({{PX}}.app.js) e pelo workflow. Sem DOM aqui (document/$ nao existem).
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
function displayFields(form, customHTML) {
    /* atividades iniciais do diagrama (0 = abertura pelo portal, 4 = inicio) */
    var ATIVIDADES_INICIAIS = ['0', '4'];

    var atividade = String(getValue("WKNumState"));
    form.setValue("ATIVIDADE", atividade);
    form.setValue("NUMPROCESSO", String(getValue("WKNumProces")));

    var usuario = fluigAPI.getUserService().getCurrent();
    var login = String(usuario.getLogin());

    if (ATIVIDADES_INICIAIS.indexOf(atividade) >= 0) {
        form.setValue("SOLICITANTE", login);
        form.setValue("EMAIL_SOLICITANTE", String(usuario.getEmail()));
    }

    form.setValue("USUARIOATUAL", login);

    if (form.getFormMode() == "VIEW") {
        form.setShowDisabledFields(true);
        form.setValue("TYPEVIEW", "1");
    } else {
        form.setValue("TYPEVIEW", "0");
    }

    log.info("[{{PX_UPPER}}] displayFields atividade=" + atividade + " modo=" + form.getFormMode());
}
