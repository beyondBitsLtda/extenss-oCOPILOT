Regras Fluig DELP (resumo; o guia completo foi enviado no início da conversa):
- Artefato Fluig NOVO: use @gerar (widget/dataset/formulario) para criar a estrutura padrão; nunca monte à mão.
- Siga o padrão dos artefatos existentes no repositório (use @listar/@buscar para achar a referência).
- Server-side (datasets, events/*.js, workflow) é Rhino ES5: sem let/const, arrow, template literal, class; String(v) em valores Java; constraints com new Array(...); sem JSON em service task assíncrona.
- Widget: var <code> = SuperWidget.extend com nome igual ao application.code; todo js/css declarado no application.info em ordem (Objects -> Componentes -> Permissoes -> chartHelper -> ds* -> integre* -> Controller -> main.function); subir application.version a cada publicação; CSS BEM com prefixo e tokens no contêiner raiz; dados via POST /api/public/ecm/dataset/datasets (assíncrono); kit de UI próprio, sem alert/confirm; gráficos só via <ns>.grafico (chartHelper.js), nunca new Chart.
- Dataset: despachante por _ACAO, PreparedStatement sempre, erro como linha 'ERRO: ...', escrita devolve STATUS|MENSAGEM|ID, conexão fechada no finally, usuário via getValue('WKUser'), permissão revalidada no servidor.
- Formulário: id = name, MAIÚSCULO, hidden de controle (ATIVIDADE, NUMPROCESSO...), displayFields/enableFields, validação no beforeSendValidate, zoom + hidden de chave, pai-filho com botões próprios.
- Workflow: <processId>.<evento>.js, constantes de atividade, servicetask: return true = ok, throw = erro de borda.
- Nunca credenciais, hosts, IPs ou e-mails fixos no código. Padrão visual DELP: Barlow, #CC0F10 só em destaques.
