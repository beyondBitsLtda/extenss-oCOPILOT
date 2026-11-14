/* =============================================================================
   {{DATASET}}.js - Dataset customizado Fluig (server-side / Rhino ES5)
   {{TITULO}} DELP - {{DESCRICAO}}
   -----------------------------------------------------------------------------
   Acoes (constraint _ACAO):
     LISTAR   filtros opcionais: CODIGO, _BUSCA (texto em NOME), _INCLUIR_INATIVOS='1'
     OBTER    _ID
     SALVAR   insere sem _ID, atualiza com _ID. Campos em _PAYLOAD (JSON) ou em
              constraints soltas: CODIGO, NOME, VALOR, ATIVO
     EXCLUIR  _ID (exclusao LOGICA: ATIVO = 0)
   Contrato:
     - leitura devolve as colunas de COLS_LISTAR;
     - escrita devolve STATUS ('OK'|'ERRO') | MENSAGEM | ID;
     - erro de leitura: 1 linha com 'ERRO: ...' na 1a coluna (o front trata).
   Regras: PreparedStatement sempre; usuario vem de getValue('WKUser');
   conexao fechada no finally; tabela qualificada em constante.
   -----------------------------------------------------------------------------
   v1.0 - {{DATA}} - criacao (gerado pelo modelo padrao Delp)
============================================================================= */

/* Datasource e base detectados nos datasets do projeto (ou padrao da equipe Delp).
   Nunca coloque usuario/senha aqui: o acesso vem do datasource do servidor Fluig. */
var JNDI_DATASOURCE = '{{DS_JNDI}}';
var QUERY_TIMEOUT   = 30;
var TAB             = '{{BASE}}.dbo.{{TABELA}}';

var COLS_LISTAR = ['ID', 'CODIGO', 'NOME', 'VALOR', 'ATIVO',
                   'RECCREATEDBY', 'RECCREATEDON', 'RECMODIFIEDBY', 'RECMODIFIEDON'];
var COLS_STATUS = ['STATUS', 'MENSAGEM', 'ID'];

function createDataset(fields, constraints, sortFields) {
    var acao = String(_get(constraints, '_ACAO', '')).toUpperCase();
    var conn = null;
    try {
        conn = _openConnection();
        if (acao === 'LISTAR')  return _listar(conn, constraints);
        if (acao === 'OBTER')   return _obter(conn, constraints);
        if (acao === 'SALVAR')  return _salvar(conn, constraints);
        if (acao === 'EXCLUIR') return _excluir(conn, constraints);
        return _status('ERRO', 'Acao desconhecida: ' + (acao || '(vazia)'), '');
    } catch (e) {
        log.error('[{{DATASET}}] ' + acao + ': ' + (e.message || e));
        if (acao === 'LISTAR' || acao === 'OBTER') return _erroLeitura(COLS_LISTAR, 'ERRO: ' + (e.message || e));
        return _status('ERRO', String(e.message || e), '');
    } finally {
        try { if (conn) conn.close(); } catch (ex) {}
    }
}

/* ---- Acoes ------------------------------------------------------------- */

function _listar(conn, constraints) {
    var ds = _dsCom(COLS_LISTAR);
    var sql = 'SELECT ' + COLS_LISTAR.join(', ') + ' FROM ' + TAB + ' WHERE 1=1';
    var params = [];
    if (_get(constraints, '_INCLUIR_INATIVOS', '0') !== '1') sql += ' AND ATIVO = 1';
    var codigo = _get(constraints, 'CODIGO', '');
    if (codigo) { sql += ' AND CODIGO = ?'; params.push(codigo); }
    var termo = _get(constraints, '_BUSCA', '');
    if (termo) { sql += " AND NOME LIKE ? ESCAPE '\\'"; params.push('%' + _escLike(termo) + '%'); }
    sql += ' ORDER BY NOME';

    var pstmt = null, rs = null;
    try {
        pstmt = conn.prepareStatement(sql);
        pstmt.setQueryTimeout(QUERY_TIMEOUT);
        for (var p = 0; p < params.length; p++) pstmt.setString(p + 1, params[p]);
        rs = pstmt.executeQuery();
        while (rs.next()) ds.addRow(_linha(rs, COLS_LISTAR));
    } finally {
        _fechar(rs, pstmt);
    }
    return ds;
}

function _obter(conn, constraints) {
    var id = parseInt(_get(constraints, '_ID', ''), 10);
    if (isNaN(id)) return _erroLeitura(COLS_LISTAR, 'ERRO: _ID invalido.');
    var ds = _dsCom(COLS_LISTAR);
    var pstmt = null, rs = null;
    try {
        pstmt = conn.prepareStatement('SELECT ' + COLS_LISTAR.join(', ') + ' FROM ' + TAB + ' WHERE ID = ?');
        pstmt.setQueryTimeout(QUERY_TIMEOUT);
        pstmt.setInt(1, id);
        rs = pstmt.executeQuery();
        if (rs.next()) ds.addRow(_linha(rs, COLS_LISTAR));
    } finally {
        _fechar(rs, pstmt);
    }
    return ds;
}

function _salvar(conn, constraints) {
    var id = _get(constraints, '_ID', '');
    var dados = _payload(constraints);
    if (dados === null) return _status('ERRO', 'PAYLOAD JSON invalido.', id);
    var codigo = _campo(dados, constraints, 'CODIGO');
    var nome = _campo(dados, constraints, 'NOME');
    var valor = _campo(dados, constraints, 'VALOR');
    var ativo = _campo(dados, constraints, 'ATIVO') === '0' ? 0 : 1;
    if (!codigo || !nome) return _status('ERRO', 'CODIGO e NOME sao obrigatorios.', id);
    if (valor !== '' && isNaN(Number(String(valor).replace(',', '.')))) return _status('ERRO', 'VALOR invalido.', id);

    var usuario = _getUser();
    var pstmt = null, rs = null;
    try {
        if (id) {
            pstmt = conn.prepareStatement('UPDATE ' + TAB + ' SET CODIGO = ?, NOME = ?, VALOR = ?, ATIVO = ?, ' +
                'RECMODIFIEDBY = ?, RECMODIFIEDON = SYSDATETIME() WHERE ID = ?');
            pstmt.setQueryTimeout(QUERY_TIMEOUT);
            _setStr(pstmt, 1, codigo);
            _setStr(pstmt, 2, nome);
            _setDec(pstmt, 3, valor);
            pstmt.setInt(4, ativo);
            _setStr(pstmt, 5, usuario);
            pstmt.setInt(6, parseInt(id, 10));
            var n = pstmt.executeUpdate();
            return n > 0 ? _status('OK', 'Registro atualizado.', id) : _status('ERRO', 'Registro nao encontrado.', id);
        }
        pstmt = conn.prepareStatement('INSERT INTO ' + TAB + ' (CODIGO, NOME, VALOR, ATIVO, RECCREATEDBY, RECCREATEDON) ' +
            'VALUES (?, ?, ?, ?, ?, SYSDATETIME())', java.sql.Statement.RETURN_GENERATED_KEYS);
        pstmt.setQueryTimeout(QUERY_TIMEOUT);
        _setStr(pstmt, 1, codigo);
        _setStr(pstmt, 2, nome);
        _setDec(pstmt, 3, valor);
        pstmt.setInt(4, ativo);
        _setStr(pstmt, 5, usuario);
        pstmt.executeUpdate();
        rs = pstmt.getGeneratedKeys();
        var novoId = rs.next() ? String(rs.getObject(1)) : '';
        return _status('OK', 'Registro criado.', novoId);
    } finally {
        _fechar(rs, pstmt);
    }
}

function _excluir(conn, constraints) {
    var id = parseInt(_get(constraints, '_ID', ''), 10);
    if (isNaN(id)) return _status('ERRO', '_ID invalido.', '');
    var pstmt = null;
    try {
        pstmt = conn.prepareStatement('UPDATE ' + TAB + ' SET ATIVO = 0, RECMODIFIEDBY = ?, RECMODIFIEDON = SYSDATETIME() WHERE ID = ?');
        pstmt.setQueryTimeout(QUERY_TIMEOUT);
        _setStr(pstmt, 1, _getUser());
        pstmt.setInt(2, id);
        var n = pstmt.executeUpdate();
        return n > 0 ? _status('OK', 'Registro inativado.', String(id)) : _status('ERRO', 'Registro nao encontrado.', String(id));
    } finally {
        _fechar(null, pstmt);
    }
}

/* ---- Helpers ----------------------------------------------------------- */

/* Constraint por metodo (chamada REST) com fallback para propriedades. */
function _get(constraints, name, defVal) {
    if (!constraints || !constraints.length) return defVal;
    for (var i = 0; i < constraints.length; i++) {
        var c = constraints[i], campo = null, valor = null;
        try {
            campo = String(c.getFieldName());
            valor = c.getInitialValue();
        } catch (e) {
            campo = String(c.fieldName !== undefined ? c.fieldName : c._field);
            valor = (c.initialValue !== undefined) ? c.initialValue : c._initialValue;
        }
        if (campo === name) return (valor == null) ? defVal : String(valor);
    }
    return defVal;
}

function _getUser() {
    try { var u = getValue('WKUser'); if (u) return String(u); } catch (e) {}
    return 'sistema';
}

function _openConnection() {
    return new javax.naming.InitialContext().lookup(JNDI_DATASOURCE).getConnection();
}

function _dsCom(cols) {
    var ds = DatasetBuilder.newDataset();
    for (var c = 0; c < cols.length; c++) ds.addColumn(cols[c]);
    return ds;
}

function _linha(rs, cols) {
    var row = [];
    for (var i = 0; i < cols.length; i++) row.push(_txt(rs.getObject(cols[i])));
    return row;
}

function _txt(v) { return (v == null) ? '' : String(v); }

function _setStr(pstmt, idx, v) {
    if (v === null || v === undefined || String(v) === '') pstmt.setNull(idx, java.sql.Types.NVARCHAR);
    else pstmt.setString(idx, String(v));
}

/* Dinheiro/decimal: BigDecimal a partir do texto (aceita virgula decimal). */
function _setDec(pstmt, idx, v) {
    if (v === null || v === undefined || String(v) === '') pstmt.setNull(idx, java.sql.Types.DECIMAL);
    else pstmt.setBigDecimal(idx, new java.math.BigDecimal(String(v).replace(',', '.')));
}

/* _PAYLOAD JSON (objeto) ou {} quando ausente; null quando invalido. */
function _payload(constraints) {
    var raw = _get(constraints, '_PAYLOAD', '');
    if (!raw) return {};
    try { var o = JSON.parse(String(raw)); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
}

/* Campo vindo do _PAYLOAD; se ausente, da constraint de mesmo nome. */
function _campo(dados, constraints, nome) {
    if (dados && dados[nome] !== undefined && dados[nome] !== null) return String(dados[nome]);
    return _get(constraints, nome, '');
}

function _escLike(v) { return String(v).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/\[/g, '\\['); }

function _fechar(rs, st) {
    try { if (rs) rs.close(); } catch (e) {}
    try { if (st) st.close(); } catch (e) {}
}

function _status(status, mensagem, id) {
    var ds = _dsCom(COLS_STATUS);
    ds.addRow([status, mensagem, id == null ? '' : String(id)]);
    return ds;
}

function _erroLeitura(cols, msg) {
    var ds = _dsCom(cols), row = [msg];
    for (var i = 1; i < cols.length; i++) row.push('');
    ds.addRow(row);
    return ds;
}

/* Exigidos pelo Fluig, sem uso aqui. */
function defineStructure() {}
function onSync(lastSyncDate) {}
function onMobileSync(user) {}
