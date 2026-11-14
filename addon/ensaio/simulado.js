/* simulado.js - agente, login e Portal de Testes FALSOS para o ensaio do addon
   (addon/ensaio/index.html). Nada sai do navegador: os "datasets" ficam em
   memoria e o "agente" responde por regra simples olhando o estado da tela.
   NAO use em producao. */
(function (global) {
    'use strict';

    function atraso(v, ms) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms || 250); }); }

    /* ------------------------------------------------ Portal de Testes em memoria */
    var projetos = [
        { ID: '1', NOME: 'Fornecedores - cadastro (ensaioFornecedor)', DESCRICAO: 'Regressao do formulario de fornecedor', STATUS: 'Ativo' },
        { ID: '2', NOME: 'Portal CAPEX', DESCRICAO: '', STATUS: 'Ativo' },
        { ID: '3', NOME: 'Geral', DESCRICAO: 'Projeto padrao', STATUS: 'Ativo' }
    ];
    var execucoes = {
        '1': [{ ID: '10', PROJETO_ID: '1', PROJETO_NOME: projetos[0].NOME, NOME: 'Sprint 15 - regressao', STATUS: 'Ativo', QTD_CASOS: '3' }],
        '2': [{ ID: '20', PROJETO_ID: '2', PROJETO_NOME: 'Portal CAPEX', NOME: 'Escopo 2 / Regressao sprint 15', STATUS: 'Ativo', QTD_CASOS: '0' }],
        '3': [{ ID: '30', PROJETO_ID: '3', PROJETO_NOME: 'Geral', NOME: 'APONTAMENTO DE CC', STATUS: 'Ativo', QTD_CASOS: '0' },
              { ID: '31', PROJETO_ID: '3', PROJETO_NOME: 'Geral', NOME: 'Execucao inicial', STATUS: 'Ativo', QTD_CASOS: '0' }]
    };
    var casos = { '10': [
        { ID: '101', DISPLAY_ID: '1', ITEM_TESTADO: 'CNPJ invalido e barrado no cadastro',
          DESCRICAO: '1. Abrir o cadastro de fornecedor\n2. Informar um CNPJ com digito verificador errado\n3. Clicar em Salvar',
          CONDICAO_APROVACAO: 'O campo CNPJ fica marcado com erro, aparece a mensagem "CNPJ invalido" e o cadastro NAO e salvo.',
          TIPO_TESTE: 'Componente', RESULTADO: 'Selecione um resultado', STATUS_FLUXO: 'Pendente', QTD_TICKETS: 0, QTD_TICKETS_ABERTOS: 0, TAGS: 'validacao' },
        { ID: '102', DISPLAY_ID: '2', ITEM_TESTADO: 'Categoria obrigatoria',
          DESCRICAO: '1. Deixar a categoria em branco\n2. Salvar',
          CONDICAO_APROVACAO: 'Mensagem "Informe a categoria" e o botao Salvar nao conclui.',
          TIPO_TESTE: 'Componente', RESULTADO: 'Selecione um resultado', STATUS_FLUXO: 'Pendente', QTD_TICKETS: 0, QTD_TICKETS_ABERTOS: 0, TAGS: '' },
        { ID: '103', DISPLAY_ID: '3', ITEM_TESTADO: 'Itens do contrato aparecem na grade',
          DESCRICAO: 'Abrir um fornecedor com contrato e conferir a grade de itens.',
          CONDICAO_APROVACAO: 'A grade mostra codigo, descricao e valor de cada item.',
          TIPO_TESTE: 'Sistema', RESULTADO: 'Aprovado', STATUS_FLUXO: 'Aprovado e Concluido', QTD_TICKETS: 0, QTD_TICKETS_ABERTOS: 0, TAGS: '' }
    ] };

    function caso(id) {
        var t = null;
        Object.keys(casos).forEach(function (e) { casos[e].forEach(function (c) { if (c.ID === String(id)) t = c; }); });
        return t;
    }

    var ds = {
        registro: [],
        papeis: function () { return atraso(['QA']); },
        projetos: function () { return atraso(projetos.slice()); },
        execucoes: function (pid) {
            if (pid) return atraso((execucoes[pid] || []).slice());
            return atraso(Object.keys(execucoes).reduce(function (t, k) { return t.concat(execucoes[k]); }, []));
        },
        casos: function (eid) { return atraso((casos[eid] || []).map(function (c) { return JSON.parse(JSON.stringify(c)); })); },
        salvarCampo: function (id, campo, valor) {
            var c = caso(id);
            ds.registro.push(['SALVAR_CAMPO', id, campo, valor]);
            if (c && campo === 'resultado') {
                c.RESULTADO = valor;
                c.STATUS_FLUXO = valor === 'Aprovado' ? 'Aprovado e Concluido' : (valor === 'Reprovado' ? 'Falha Nova (Aguardando Ticket)' :
                                 (valor === 'Invalido' ? 'Invalido' : 'Pendente'));
            }
            if (c && campo === 'tipoFalha') c.TIPO_FALHA = valor;
            return atraso({ STATUS: 'OK', MENSAGEM: '', ID: id });
        },
        gerarTicket: function (casoId, descricao, prioridade) {
            var c = caso(casoId);
            ds.registro.push(['GERAR', casoId, descricao, prioridade]);
            if (c) { c.RESULTADO = 'Selecione um resultado'; c.STATUS_FLUXO = 'Em Andamento (DEV)'; c.QTD_TICKETS++; c.QTD_TICKETS_ABERTOS++; }
            return atraso({ STATUS: 'OK', ID: '900', DISPLAY_ID: '7' });
        },
        salvarEvidencia: function (casoId, anexo) {
            ds.registro.push(['EVIDENCIA', casoId, anexo.nome, anexo.bytes]);
            return atraso({ STATUS: 'OK', ID: '500' });
        }
    };

    /* ------------------------------------------------ login */
    var auth = {
        _ok: !/[?&]login=0/.test(global.location.search),
        conectado: function () { return this._ok; },
        conta: function () { return 'usuario.ensaio@delp.com.br'; },
        modoPonte: function () { return true; },
        enderecoRetorno: function () { return 'http://localhost:7017/ponte-login.html'; },
        entrar: function () { this._ok = true; return atraso('usuario.ensaio', 600); },
        cancelarLogin: function () {},
        sair: function () { this._ok = false; }
    };

    /* ------------------------------------------------ agente por regra */
    function responder(texto, anexos) {
        var testar = /ASSISTENTE DE TESTES INTEGRADO|## Caso de teste em execucao|CASO ATUAL MUDOU|## Gravacao da execucao/.test(texto) ||
                     /VEREDITO/.test(texto);
        var comErro = /\| COM ERRO/.test(texto) || /CNPJ invalido/i.test(texto.split('### Mensagens visiveis')[1] || '');
        var prints = (anexos || []).length;
        if (!testar) {
            return [
                '### O que da para testar nesta tela',
                '',
                '| # | Item testado | Condicao de aprovacao | Tipo |',
                '|---|---|---|---|',
                '| 1 | CNPJ com digito invalido | Mensagem de erro e nao salva | Componente |',
                '| 2 | Categoria em branco | Mensagem "Informe a categoria" | Componente |',
                '| 3 | E-mail fora do padrao | Campo marcado com erro | Componente |',
                '',
                '- Li ' + ((texto.match(/^.* \| .* \| .*$/mg) || []).length) + ' linha(s) de campos na tela' + (prints ? ' e ' + prints + ' print(s)' : '') + '.',
                '- *Resposta simulada do ensaio: em producao quem responde e o agente do Copilot Studio.*'
            ].join('\n');
        }
        if (/## Gravacao da execucao/.test(texto)) {
            var erroJs = /\[(\+[\d:.]+)\] ERRO JS: ([^\n]+)/.exec(texto);
            var falha = /\[(\+[\d:.]+)\] (DATASET|REQUISICAO): ([^\n]*FALHOU[^\n]*)/.exec(texto);
            var acoes = (texto.match(/\] ACAO: /g) || []).length;
            if (erroJs || falha) {
                return [
                    '**Conclusao:** o cadastro nao foi salvo e a tela nao avisou o motivo.',
                    '',
                    '**O que funcionou**',
                    '- O aviso "CNPJ invalido" apareceu quando o CNPJ estava errado.',
                    '',
                    '**O que deu errado**',
                    falha ? '- Logo depois de clicar em **Salvar**, o sistema nao conseguiu gravar o fornecedor.' : '',
                    erroJs ? '- Em seguida a tela parou de responder ao salvar, sem nenhuma mensagem para voce.' : '',
                    '',
                    '**Proximo passo:** reprove o caso e abra os tickets abaixo para o time de desenvolvimento.',
                    '',
                    'VEREDITO: REPROVADO',
                    'TIPO_FALHA: Erro de dados',
                    'PRIORIDADE: Alta',
                    falha ? 'TICKET: Alta | Salvar fornecedor nao grava | Passos: corrigir o CNPJ e clicar em Salvar. Esperado: fornecedor gravado. ' +
                        'Observado: ' + falha[2] + ' ' + falha[3].slice(0, 120) + ' (gravacao ' + falha[1] + ').' : '',
                    erroJs ? 'TICKET: Media | Tela nao avisa quando o salvamento falha | A falha nao e tratada no front: ' + erroJs[2].slice(0, 120) +
                        ' (gravacao ' + erroJs[1] + '). Esperado: mensagem clara ao usuario.' : ''
                ].filter(function (l, i, a) { return l !== '' || a[i - 1] !== ''; }).join('\n');
            }
            return ['A gravacao nao mostra erro nem chamada com falha; a tela terminou no estado esperado.', '',
                    'VEREDITO: APROVADO', 'TIPO_FALHA: N/A', 'PRIORIDADE: Baixa', 'DESCRICAO_TICKET:'].join('\n');
        }
        if (comErro) {
            return [
                'Comparei a tela com a condicao de aprovacao:',
                '',
                '- O campo **CNPJ** esta marcado **com erro** e a mensagem "CNPJ invalido" aparece - isso atende.',
                '- Porem o botao **Salvar** continua habilitado e a grade mostra o fornecedor como salvo, o que contraria "o cadastro NAO e salvo".',
                '',
                '**Conclusao:** a validacao aparece, mas nao impede a gravacao.',
                '',
                'VEREDITO: REPROVADO',
                'TIPO_FALHA: Erro de preenchimento',
                'PRIORIDADE: Alta',
                'DESCRICAO_TICKET: CNPJ invalido mostra a mensagem de erro, mas o cadastro e salvo mesmo assim (Salvar continua habilitado).'
            ].join('\n');
        }
        return [
            'Nao encontrei na tela nenhum campo marcado com erro nem a mensagem esperada.',
            '',
            '1. Informe um CNPJ com digito verificador errado (ex.: 11.222.333/0001-00).',
            '2. Clique em **Salvar** e me peca para avaliar de novo (ou cole um print).',
            '',
            'VEREDITO: INCONCLUSIVO',
            'TIPO_FALHA: N/A',
            'PRIORIDADE: Media',
            'DESCRICAO_TICKET:'
        ].join('\n');
    }

    function criarCliente() {
        var timer = null, rejeitar = null;
        return {
            ultima: '',
            ocupado: function () { return !!timer; },
            reiniciar: function () {},
            cancelar: function () {
                if (!timer) return;
                clearInterval(timer); timer = null;
                if (rejeitar) rejeitar({ codigo: 'CANCELADO', message: 'Resposta interrompida.' });
            },
            enviar: function (texto, aoParcial, anexos) {
                this.ultima = texto;
                global.ENSAIO_ULTIMA_MENSAGEM = texto;
                var r = responder(texto, anexos);
                var partes = r.match(/[\s\S]{1,48}/g) || [r];
                var i = 0, acc = '';
                return new Promise(function (resolve, reject) {
                    rejeitar = reject;
                    timer = setInterval(function () {
                        acc += partes[i++];
                        if (aoParcial) aoParcial(acc);
                        if (i >= partes.length) { clearInterval(timer); timer = null; rejeitar = null; resolve(acc); }
                    }, 35);
                });
            }
        };
    }

    global.ENSAIO_SIMULADO = { auth: auth, criarCliente: criarCliente, ds: ds };
}(window));
