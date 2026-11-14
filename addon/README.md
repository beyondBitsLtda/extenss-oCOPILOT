# Addon de Testes do Delp Copilot

É um componente para colocar em qualquer widget ou formulário do Fluig. Na tela aparece um mascote. Ao clicar nele, abre um painel lateral com o agente **Delp Copilot** (Copilot Studio), ligado ao **Portal de Testes**.

| Modo | O que faz |
|---|---|
| **Testar caso** | Você escolhe a execução numa lista única, agrupada por projeto e com busca. É o mesmo catálogo do seletor do topo do Portal de Testes: todas as execuções ativas de todos os projetos. Depois escolhe o escopo (a execução inteira ou um caso). O addon mostra os passos e a condição de aprovação. O agente lê o estado da tela e os prints e sugere **Aprovado**, **Reprovado** ou **Inconclusivo**. Os botões gravam o resultado no portal, salvam os prints como evidência e abrem o ticket já com a descrição da falha. |
| **Modo livre** | Conversa aberta sobre a tela: ideias de casos de teste, revisão de prints, explicação de erros. Aceita `.docx`, `.txt` e `.md`. |

**Quem decide é sempre o testador.** O agente só sugere e nada é gravado sem clique.

---

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `delp-copilot-addon.js` | **O addon. É o único arquivo que vai para o Fluig.** ES5, sem dependências (nem jQuery), com o CSS embutido. |
| `delp-copilot-addon.css` | Fonte do visual, legível e comentada. **Não é carregado sozinho.** |
| `ferramentas/embutir-css.js` | Copia o `.css` para dentro do `.js`. Rode depois de mexer no CSS: `node addon/ferramentas/embutir-css.js`. |
| `ensaio/index.html` | Ensaio fora do Fluig: login, agente e portal são simulados e nada sai da máquina. Abra no navegador. Parâmetros: `?abrir=testar&erro=1&avaliar=1`, `?abrir=livre`, `?login=0`. |
| `ensaio/simulado.js` | Dublês usados pelo ensaio. **Nunca vão para produção.** |
| `../test/addon.test.js` | Entra no `npm test`. Confere o veredito, o markdown seguro, a máscara LGPD, o protocolo, se o CSS embutido está em dia e se o arquivo é ES5. |

O `.vscodeignore` exclui `addon/**`, então o addon não entra no `.vsix` da extensão.

---

## Como colocar numa widget

1. Copie `delp-copilot-addon.js` para `src/main/webapp/resources/js/`.
2. Declare o arquivo no `application.info`, **por último**:
   ```properties
   application.resource.js.N=/resources/js/delp-copilot-addon.js
   ```
3. Opcional, mas recomendado: ponha `data-delp-copilot-alvo="<nome>"` na div raiz da widget, no `view.ftl`. Com isso:
   - o addon lê **só essa área** da tela;
   - o `<nome>` sugere o projeto de teste (procura o nome no título ou na descrição do projeto).
4. Suba a `application.version` e publique o `.war`.

Exemplo real: a widget `baseAPE`, no repositório `baseape`.

## Como colocar num formulário

1. Anexe `delp-copilot-addon.js` ao formulário, ao lado do `.html`.
2. Carregue o arquivo no fim do `<body>`:
   ```html
   <script src="delp-copilot-addon.js"></script>
   ```
   O formulário roda num iframe da tela do processo. O mascote e o painel ficam dentro desse iframe.

## Configuração (opcional)

Defina antes do script, se precisar:

```js
window.DELP_COPILOT_ADDON = {
    nomeAlvo: 'baseAPE',        // nome da tela testada ('' = detecta)
    raizTela: '#minhaArea',     // area lida ('' = [data-delp-copilot-alvo] ou body)
    lerTelaPadrao: true,        // checkbox "Enviar o que esta na tela"
    mostrarMascote: true,       // false = sem mascote (abra por [data-delp-copilot-abrir])
    boasVindas: true            // balao "Oi!" na primeira visita da aba
};
// window.DELP_COPILOT_ADDON = false;   desliga o addon nesta pagina
```

- **Gatilho próprio:** qualquer elemento com `data-delp-copilot-abrir` (ou `data-delp-copilot-abrir="livre"`) abre o painel.
- **API:** `DelpCopilotAddon.abrir('testar' | 'livre')`, `fechar()`, `alternar()` e `lerTela()`. `lerTela()` mostra o texto que o agente receberia.

### Modos da página (v1.2)

A página pode registrar um **modo próprio** e escolher quais modos aparecem. Sem isso, nada muda: "Testar caso" e "Modo livre", como antes. Quem usa hoje: o **Process Map** do DevTools Kit (`devkittools_Repo/.../js/pmAssistente.js`), com o modo "Fluxograma".

```js
DelpCopilotAddon.iniciar({            // com autoIniciar: false, para a pagina decidir quando
    subtitulo: 'Assistente de fluxogramas',
    textoBalao: 'Oi! Eu ajudo com fluxogramas...',
    modos: ['fluxo'],                 // so este modo (um modo so: sem abas)
    extensoes: { fluxo: {
        rotulo: 'Fluxograma',                         // obrigatorio
        preambulo: function (alvo) { return '...'; }, // instrucoes da 1a mensagem
        contexto: function () { return '...'; },      // vai no lugar do estado da tela
        rotuloContexto: 'Enviar o desenho aberto',
        boasVindas: '...', placeholder: '...', sugestoes: [['Explique', 'Explique o desenho...']],
        montar: function (el, api) {},                // area propria acima da conversa
        atualizar: function (el, api) {},             // a cada redesenho do painel
        textoVisivel: function (texto, msg) {},       // o que a resposta mostra
        acoes: function (msg, api) {},                // elemento com acoes embaixo da resposta
        aoResponder: function (msg, api) {}
    } }
});
```

A `api` que a extensão recebe: `enviar(texto, { rotulo, bloco, semContexto })` (devolve a Promise com o texto da resposta, ou `null`), `status`, `humor`, `conectado`, `entrar`, `ocupado`, `criarCliente()` (outra conversa, mesmo login), `anexosPendentes`, `dialogo(titulo, elemento)`, `abrir`, `render`, `markdown`, `mascarar`. Id de modo só com letras minúsculas, números e hífen; "testar" e "livre" não se sobrescrevem; extensão com erro avisa no painel e não derruba o addon. Ao mudar o addon, copie para o devkittools e para o baseape (`node test/addon.test.js` aqui; os testes de cada repositório lá).

---

## O que sai do navegador

O botão **Ver o que vai** mostra o texto exato da próxima mensagem.

### Para o agente

Vai para o Copilot Studio, com o login M365 do próprio usuário:

- as instruções do modo;
- o caso (projeto, execução, item, passos, condição de aprovação, status);
- o **estado da tela**, se a caixa estiver marcada: títulos, campos com valor e situação (obrigatório, desabilitado, com erro), mensagens visíveis, botões e até 4 tabelas (16 linhas cada). O teto é de 14 mil caracteres;
- anexos: prints vão como imagem; `.docx`, `.txt` e `.md` vão como texto, com teto de 30 mil caracteres.

**Minimização (LGPD):**
- senha nunca sai;
- campos cujo rótulo, nome ou id indica dado sensível (senha, token, CPF, CNPJ, RG, salário, conta, agência, cartão, PIS, nascimento, telefone) vão como `[oculto]`;
- CPF, CNPJ e e-mail no meio do texto viram `[CPF]`, `[CNPJ]` e `[e-mail]`;
- da URL vai só o caminho, sem a query string.

### Para o Fluig

Vai para os datasets do Portal de Testes, com a sessão do próprio usuário:

| Ação | Dataset |
|---|---|
| Ler papéis | `dsTesteUsuarios` `MEUS_PAPEIS` |
| Ler projetos e execuções | `dsTesteProjetos` `LISTAR_PROJETOS` / `LISTAR_EXECUCOES` |
| Ler casos | `dsTesteCasos` `LISTAR` |
| Registrar o resultado (só por clique) | `dsTesteCasos` `SALVAR_CAMPO` |
| Salvar prints como evidência (só por clique) | `dsTesteEvidencias` `SALVAR` |
| Abrir ticket (só por clique) | `dsTesteTickets` `GERAR` |

Os papéis são conferidos **no servidor**. O addon só esconde os botões:
- registrar resultado e salvar evidência: QA ou ADMIN;
- abrir ticket: QA, DEV ou ADMIN.

## Login

É o mesmo do Portal de Testes: OAuth 2.0 com PKCE em popup, permissão delegada `CopilotStudio.Copilots.Invoke`, sem segredo no código.

- **Fluig em `http://`:** o login passa pela ponte do delp-git (`http://localhost:7017`), que precisa estar aberta na máquina.
- **Sessão:** fica no `sessionStorage` da aba, com a mesma chave do portal. Quem já entrou no Portal de Testes na mesma aba não precisa entrar de novo.

## A janela do assistente

| Modo | Como funciona |
|---|---|
| **Lateral encaixada** | Presa à direita, com a alça de largura e o botão Expandir. A **tela testada encolhe** para o painel caber ao lado, então nada fica por baixo dele. Na widget em tela cheia (`position: fixed`, como a APE), o `right` dela recua; numa página comum, o `body` ganha `margin-right`. Um `resize` avisa as grades para se redesenharem, e tudo volta ao que era ao minimizar ou trocar de modo. Na APE, os modais também se ajustam (`areaLivre()`). |
| **Flutuante** (padrão) | Não encolhe a tela. Arraste pelo título para qualquer lugar. Redimensione pelo canto inferior direito. Nasce pequena, no canto de baixo. Posição e tamanho ficam guardados neste navegador; duplo clique no título volta ao lugar padrão. Fica **por cima** da tela, então tire-a de cima do que for clicar. |
| **Destacada** (botão ↗) | O painel vai para uma **janela separada do navegador**, que dá para pôr em outro monitor. Na página fica o mascote com o selo ↗; clicar nele traz a janela para a frente. O botão de voltar, ou fechar a janela, traz o painel de volta. O login sai da janela separada. Se a página da tela for recarregada, a janela separada fecha. |

**Modais da tela têm prioridade.** Enquanto um modal da sua tela estiver aberto (Bootstrap/Fluig, APE, Swal, `dialog`, `role="dialog"`), o painel e o mascote vão para trás dele (z-index 1030) e voltam sozinhos quando ele fecha. Antes, o painel ficava em 9750 e um modal comum (cerca de 1050) abria **por trás** dele, parecendo que não tinha aberto.

**Por que encaixar e não cobrir.** Na APE, o atalho "Abrir ›" de cada projeto e desenho fica na **ponta direita da linha** e só aparece ao passar o mouse; na visão "Estrutura", clicar na linha só expande e recolhe. Com o painel por cima da ponta direita, o "Abrir" ficava escondido e parecia que a APE não navegava. Encaixado, o "Abrir" continua alcançável. Em monitor estreito, a árvore da APE ganha rolagem horizontal, porque tem largura mínima de 1060 px.

**O × minimiza.** A conversa e a gravação continuam; clique no mascote para voltar.

**Dá para brincar com o mascote.** Pegue e arremesse: ele voa com gravidade e quica nas bordas da tela.
- Quanto mais forte o arremesso, mais forte a batida e mais rápido o quique.
- Ele estica na direção do voo, amassa contra a borda (proporcional ao impacto) e balança como gelatina.
- A cada batida faz cara de dor e grita ("Ai!"; nas fortes, "Isso doeu!"). Quando para, fica tonto.
- Dá para pegá-lo no ar.
- Soltar devagar só muda o lugar, sem arremessar.
- Com "reduzir movimento" ligado no sistema, ele só fica onde foi solto.

**Nada fica preso na tela.** Arrastar o mascote, o título e a alça usa captura do ponteiro no próprio elemento, sem listener no `document`. O gravador desinstala tudo o que interceptou quando a gravação para.

**Desligar sem republicar.** Para testar a tela sem o addon, há dois jeitos:
- pôr `?delpCopilot=0` na URL;
- rodar `localStorage.setItem('dca.desligado','1')` no console. Para voltar, `removeItem`.

Para conferir a versão carregada, rode `DelpCopilotAddon.versao` no console.

## Conclusão da análise: aprovar, reprovar e um ticket por problema

O agente escreve para quem testa, não para o desenvolvedor:
- **conclusão** em uma frase;
- **o que funcionou**;
- **o que deu errado**, um item por problema;
- **próximo passo**.

Sem termos técnicos: nada de dataset, HTTP ou console. O detalhe técnico vai **só** na descrição dos tickets, que é para o time de desenvolvimento.

O bloco final traz uma linha `TICKET: prioridade | título | descrição` para cada problema diferente. O formato antigo, `DESCRICAO_TICKET`, continua aceito. No cartão aparecem os problemas encontrados, cada um com caixa de seleção, prioridade e descrição editável, e três botões:
- **Reprovar e abrir o(s) ticket(s) marcado(s):** registra Reprovado com o tipo de falha e abre um ticket (`GERAR`) por problema marcado, em sequência;
- **Só reprovar**;
- **Aprovar mesmo assim**.

Se o agente aprovou, o botão é **Aprovar o item**. Depois da decisão, a gravação daquele caso é apagada.

## Gravar a execução (você executa, o agente acompanha)

No cartão do caso, clique em **Gravar execução**. Pode fechar o painel enquanto executa; o mascote fica com o selo **REC**. Ao terminar, volte ao painel e clique em **Parar** e depois em **Analisar gravação**. O agente segue a linha do tempo e conclui. Os botões gravam o resultado e abrem o ticket.

**O que a gravação registra** (só enquanto está ligada):

| Tipo | O que é |
|---|---|
| `ACAO` | Clique em botão, link ou aba; envio de formulário |
| `CAMPO` | Campo alterado, com o valor mascarado. Senha e campos sensíveis viram `[oculto]` |
| `DATASET` | Chamada de dataset feita pelo código da tela (fetch ou XHR da mesma origem): nome, filtros **sem valores**, HTTP, tempo, linhas. Marca `FALHOU` e `LENTO` (3 s ou mais) |
| `REQUISICAO` | Outras chamadas ao Fluig (método, caminho, status, tempo). Recurso estático que carregou bem fica de fora |
| `ERRO JS` | Erro não tratado, promessa rejeitada, recurso que não carregou |
| `CONSOLE` | `console.error` e `console.warn` |
| `MENSAGEM` / `VALIDACAO` | Texto que apareceu na tela; campo que ficou ou deixou de ficar com erro |
| `ALERTA` | `FLUIGC.toast` e `FLUIGC.message`, `Swal`, `alert`, `confirm` e `prompt` |

Também guarda o estado da tela no início e no fim. As chamadas do próprio addon (cabeçalho `X-Delp-Copilot`) e as do Copilot Studio (outro endereço) ficam fora.

**Privacidade:**
- a gravação fica **só na memória da aba**: não vai para servidor nem para `localStorage`;
- **é apagada** quando você registra o resultado ou abre o ticket daquele caso;
- também pode ser apagada pelo botão **Descartar**, e some ao recarregar a página;
- **Ver** mostra o texto exato antes de enviar.

**Por que não é vídeo:** o Fluig está em `http://`, e o navegador só libera captura de tela (`getDisplayMedia`) em página segura (HTTPS). Para a análise, a linha do tempo de comportamento é mais útil do que o vídeo. Para algo visual pontual, cole um print com Ctrl+V.

## Resposta do agente cortada no começo

O streaming do Copilot Studio manda o primeiro pedaço sem `streamId`, e o cliente antigo o descartava. Por isso o "Olá" sumia. O cliente atual cuida disso. Ele também ignora avisos de status (`informative`) e, se a mensagem final vier cortada ou não vier, usa o texto do streaming.

Se ainda acontecer, rode no console da página `copy(JSON.stringify(DelpCopilotAddon.diagnostico()))` e envie o resultado. Ele traz o resumo de cada pedaço da última resposta (tipo, sequência, se tinha `streamId`, tamanho e as 12 primeiras letras), sem o texto inteiro.

## Anexar prints

Há três jeitos de anexar:
- o botão **Anexar**;
- **Ctrl+V** de um print copiado;
- arrastar o arquivo para o painel.

Os prints são reduzidos no próprio navegador (lado máximo de 1600 px, até cerca de 900 KB) e vão como attachment da mensagem. **O agente precisa aceitar imagens.** Para isso, ligue no Copilot Studio: Configurações → IA generativa → carregamento de arquivos/imagens. Se ele recusar, o painel avisa.

---

## Pendências antes de ampliar o uso

1. **Governança e Compliance (e TI):** pela PSI e pelo `docs/MANUAL-TECNICO.md`, uma solução nova que envia o conteúdo da tela para um agente externo e grava em outro sistema passa por avaliação antes de sair do piloto.
2. **Créditos do Copilot Studio:** cada mensagem consome créditos.
3. **CORS:** mesmo ponto de atenção do Portal de Testes. Se o Copilot Studio recusar chamadas vindas do endereço do Fluig, o painel avisa.
