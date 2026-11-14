/**
 * =============================================================================
 * {{TITULO}} - {{PX}}.dataset.js
 * -----------------------------------------------------------------------------
 * DatasetGateway: UNICO ponto de acesso aos datasets do Fluig neste formulario.
 * Nenhum outro arquivo chama DatasetFactory diretamente.
 *
 * Contrato:
 *   - Chamadas SINCRONAS (DatasetFactory.getDataset sem callback), adequadas ao
 *     beforeSendValidate. Para listas grandes prefira o zoom do Fluig.
 *   - Constraints sempre createConstraint(campo, valor, valor, ConstraintType.MUST).
 *   - Erro de leitura do dataset (padrao DELP): 1 linha com 'ERRO: ...' na 1a coluna.
 *     Erro de escrita: colunas STATUS = 'ERRO' e MENSAGEM. Ambos viram DatasetError.
 *   - Dataset vazio NAO e erro: executar() devolve [] e primeiro() devolve null.
 *
 * Historico:
 *   v1.0 - {{DATA}} - criacao
 * =============================================================================
 */
(function (global) {
    'use strict';

    var {{PX_UPPER}} = global.{{PX_UPPER}};

    /* Erro de comunicacao com o dataset (retorno nulo, excecao ou linha 'ERRO: '). */
    function DatasetError(mensagem, causa) {
        this.name = 'DatasetError';
        this.message = mensagem;
        this.causa = causa;
    }
    DatasetError.prototype = Object.create(Error.prototype);
    DatasetError.prototype.constructor = DatasetError;

    function texto(v) { return (v === null || v === undefined) ? '' : String(v); }

    function DatasetGateway(factory, tipos) {
        this.factory = factory || global.DatasetFactory;
        this.tipos = tipos || global.ConstraintType;
    }

    /* Constraint MUST com valor inicial = final. */
    DatasetGateway.prototype.constraint = function (campo, valor) {
        var v = texto(valor);
        return this.factory.createConstraint(campo, v, v, this.tipos.MUST);
    };

    /* Monta constraints a partir de um objeto { CAMPO: valor } (ignora vazios). */
    DatasetGateway.prototype.constraints = function (filtros) {
        var lista = [], campo;
        for (campo in (filtros || {})) {
            if (Object.prototype.hasOwnProperty.call(filtros, campo) && texto(filtros[campo]) !== '') {
                lista.push(this.constraint(campo, filtros[campo]));
            }
        }
        return lista;
    };

    /*
     * Executa o dataset e devolve o array values.
     * Lanca DatasetError se o retorno for invalido ou se o dataset sinalizar erro.
     */
    DatasetGateway.prototype.executar = function (nome, constraints, campos, ordem) {
        var ds;
        if (!this.factory) throw new DatasetError('DatasetFactory indisponivel (vcXMLRPC.js nao carregado).');
        try {
            ds = this.factory.getDataset(nome, campos || null, constraints || null, ordem || null);
        } catch (e) {
            throw new DatasetError('Falha ao acessar o dataset ' + nome + ': ' + (e && e.message ? e.message : e), e);
        }
        if (!ds || !ds.values) throw new DatasetError('O dataset ' + nome + ' nao retornou resposta.');

        var valores = ds.values;
        if (valores.length) {
            var colunas = ds.columns || [];
            var linha = valores[0];
            var primeiraColuna = colunas.length ? texto(linha[colunas[0]]) : '';
            if (primeiraColuna.indexOf('ERRO: ') === 0) {
                throw new DatasetError(primeiraColuna.substring(6));
            }
            if (texto(linha.STATUS).toUpperCase() === 'ERRO') {
                throw new DatasetError(texto(linha.MENSAGEM) || ('Erro no dataset ' + nome));
            }
        }
        {{PX_UPPER}}.log.debug('dataset', nome, valores.length + ' linha(s)');
        return valores;
    };

    /* Primeira linha do resultado ou null se vazio. */
    DatasetGateway.prototype.primeiro = function (nome, constraints) {
        var valores = this.executar(nome, constraints);
        return valores.length ? valores[0] : null;
    };

    // ------------------------------------------------------------------ consultas do formulario
    /*
     * Exemplo de consulta. Cada consulta do formulario vira um metodo aqui, com
     * nome de negocio, para que app/validator nunca conhecam nomes de dataset.
     * TROQUE pelo dataset e pelas constraints reais.
     */
    DatasetGateway.prototype.obterExemplo = function (codigo) {
        return this.primeiro({{PX_UPPER}}.Config.DATASETS.EXEMPLO, this.constraints({ CODCCUSTO: codigo }));
    };

    {{PX_UPPER}}.DatasetError = DatasetError;
    {{PX_UPPER}}.DatasetGateway = DatasetGateway;
})(window);
