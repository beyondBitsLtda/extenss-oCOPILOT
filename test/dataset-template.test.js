// Testa o modelo de dataset (templates/dataset) com dublês de DatasetBuilder, JDBC e constraints.
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const ROOT = process.argv[2];
const src = fs.readFileSync(path.join(ROOT, 'templates/dataset/datasets/{{DATASET}}.js'), 'utf8')
  .replace(/\{\{DATASET\}\}/g, 'dsTeste').replace(/\{\{TABELA\}\}/g, 'Z_DELP_TESTE').replace(/\{\{[A-Z_]+\}\}/g, 'x');
assert.ok(!/\blet\b|\bconst\b|=>|`/.test(src), 'ES5 apenas');

let executed = [];
let failNext = false;
function makeConn(rows) {
  return {
    prepareStatement(sql) {
      if (failNext) { failNext = false; throw new Error('falha simulada'); }
      const st = { sql, params: {}, setQueryTimeout() {}, setString(i, v) { this.params[i] = v; }, setInt(i, v) { this.params[i] = v; },
        setNull(i) { this.params[i] = null; }, setBigDecimal(i, v) { this.params[i] = v; },
        executeQuery() { executed.push(this); let k = -1; return { next: () => ++k < rows.length, getObject: (c) => rows[k][c], close() {} }; },
        executeUpdate() { executed.push(this); return 1; },
        getGeneratedKeys() { let k = -1; return { next: () => ++k < 1, getObject: () => 42, close() {} }; },
        close() {} };
      return st;
    },
    close() { this.closed = true; },
  };
}
let conn;
const builder = { newDataset() { const d = { cols: [], rows: [], addColumn(c) { this.cols.push(c); }, addRow(r) { this.rows.push(r); } }; return d; } };
const java = { sql: { Statement: { RETURN_GENERATED_KEYS: 1 }, Types: { NVARCHAR: -9, DECIMAL: 3 } }, math: { BigDecimal: function (v) { this.v = v; this.toString = () => v; } } };
const javax = { naming: { InitialContext: function () { this.lookup = () => ({ getConnection: () => conn }); } } };
const log = { error() {}, info() {} };
const run = new Function('DatasetBuilder', 'java', 'javax', 'log', 'getValue', 'cons',
  src + '\nreturn createDataset(null, cons, null);');
const c = (f, v) => ({ getFieldName: () => f, getInitialValue: () => v });
const exec = (cons, rows = []) => { conn = makeConn(rows); executed = []; return run(builder, java, javax, log, () => 'GUID-1', cons); };

let ds = exec([c('_ACAO', 'LISTAR'), c('_BUSCA', 'ob_ra%')], [{ ID: 1, CODIGO: 'A', NOME: 'Obra', VALOR: null, ATIVO: 1 }]);
assert.strictEqual(ds.cols[0], 'ID'); assert.strictEqual(ds.rows[0][2], 'Obra'); assert.strictEqual(ds.rows[0][3], '', 'nulo vira vazio');
assert.ok(executed[0].sql.includes('ATIVO = 1') && executed[0].sql.includes('NOME LIKE ?'));
assert.strictEqual(executed[0].params[1], String.raw`%ob\_ra\%%`, 'LIKE escapado');
assert.ok(conn.closed, 'conexao fechada');

ds = exec([c('_ACAO', 'SALVAR'), c('_PAYLOAD', JSON.stringify({ CODIGO: 'A1', NOME: 'Obra 1', VALOR: '10,5', ATIVO: '1' }))]);
assert.deepStrictEqual(ds.rows[0], ['OK', 'Registro criado.', '42']);
assert.ok(executed[0].sql.startsWith('INSERT') && executed[0].params[5] === 'GUID-1', 'usuario do WKUser');
assert.strictEqual(String(executed[0].params[3]), '10.5', 'VALOR como BigDecimal');

ds = exec([c('_ACAO', 'SALVAR'), c('_PAYLOAD', '{invalido')]);
assert.deepStrictEqual(ds.rows[0].slice(0, 2), ['ERRO', 'PAYLOAD JSON invalido.']);

ds = exec([c('_ACAO', 'SALVAR'), c('_ID', '7'), c('CODIGO', 'A1'), c('NOME', 'Obra 1')]);
assert.strictEqual(ds.rows[0][0], 'OK'); assert.ok(executed[0].sql.startsWith('UPDATE'));

ds = exec([c('_ACAO', 'SALVAR'), c('CODIGO', 'A1')]);
assert.strictEqual(ds.rows[0][0], 'ERRO', 'NOME obrigatorio');

ds = exec([c('_ACAO', 'EXCLUIR'), c('_ID', '7')]);
assert.strictEqual(ds.rows[0][0], 'OK'); assert.ok(executed[0].sql.includes('SET ATIVO = 0'));

ds = exec([]);
assert.deepStrictEqual(ds.rows[0].slice(0, 2), ['ERRO', 'Acao desconhecida: (vazia)']);

failNext = true; ds = exec([c('_ACAO', 'LISTAR')]);
assert.ok(String(ds.rows[0][0]).startsWith('ERRO: falha simulada'), 'erro de leitura como linha ERRO:');
assert.ok(conn.closed);

// fallback para constraints como propriedades (_field/_initialValue)
ds = exec([{ _field: '_ACAO', _initialValue: 'OBTER' }, { _field: '_ID', _initialValue: '3' }], [{ ID: 3, CODIGO: 'B', NOME: 'X', ATIVO: 1 }]);
assert.strictEqual(ds.rows[0][0], '3');
console.log('TODOS OS TESTES PASSARAM');
