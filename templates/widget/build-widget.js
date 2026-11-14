/* =============================================================================
   build-widget.js - monta o .war de uma widget Fluig DELP a partir do FONTE
   -----------------------------------------------------------------------------
   POR QUE ISTO EXISTE

   O Fluig carrega EXATAMENTE o que o application.info declara. Subir um .js
   novo sem declarar nao produz erro nenhum: o arquivo fica no servidor e
   ninguem pede por ele. Este script empacota o WAR e CONFERE os dois lados,
   reprovando (exit 1) quando:

     - um recurso declarado no application.info nao esta no WAR (404 na tela);
     - ha chave application.resource.* repetida (a ultima vence, a primeira
       some em silencio);
     - o "var X = SuperWidget.extend" do main.function.js tem nome diferente
       do application.code (a widget monta o HTML e nunca inicia);
     - ha caractere invisivel no fonte (controle, BOM no meio, espaco de
       largura zero) - passa no node --check e quebra no Rhino/navegador;
     - application.version difere de <ns>.VERSAO no Objects.js (o carimbo do
       rodape mentiria);
     - a versao e a mesma do build anterior (target/.ultima-versao): o Fluig
       serve js/css com cache atrelado a ela.

   E AVISA (sem reprovar) quando ha .js/.css no WAR sem declaracao.

   COMO USAR (na raiz do repositorio, onde fica este arquivo)
     node build-widget.js                    -> usa a UNICA pasta em wcm/widget
     node build-widget.js <codigo>           -> escolhe a widget pelo nome da pasta
     node build-widget.js --mesma-versao     -> so confere o empacotamento,
                                                sem exigir versao nova

   Gera wcm/widget/<codigo>/target/<codigo>.war. Publique ESSE arquivo no
   Fluig - nunca arquivos soltos. Datasets (datasets/) e SQL (sql/) NAO vao no
   WAR: sao publicados a parte (ordem: SQL -> datasets -> WAR).

   Node puro, sem dependencias: o WAR e um zip comum (stored, sem compressao).
============================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var RAIZ_REPO = __dirname;
var PASTA_WIDGETS = path.join(RAIZ_REPO, 'wcm', 'widget');

var args = process.argv.slice(2);
var repetirVersao = args.indexOf('--mesma-versao') >= 0;
var codigoArg = null;
args.forEach(function (a) { if (a.indexOf('--') !== 0 && !codigoArg) { codigoArg = a; } });

function falhar(msg) {
    console.log('!! ' + msg);
    process.exit(1);
}

/* ------------------------------------------------------------------
   Qual widget? Argumento explicito ou a unica pasta em wcm/widget.
   ------------------------------------------------------------------ */
function detectarCodigo() {
    if (!fs.existsSync(PASTA_WIDGETS)) {
        falhar('Não achei ' + PASTA_WIDGETS + '. Rode este script na raiz do repositório.');
    }
    var pastas = fs.readdirSync(PASTA_WIDGETS).filter(function (n) {
        return n.charAt(0) !== '.' && fs.statSync(path.join(PASTA_WIDGETS, n)).isDirectory();
    });
    if (codigoArg) {
        if (pastas.indexOf(codigoArg) < 0) {
            falhar('Widget "' + codigoArg + '" não existe em wcm/widget. Disponíveis: ' +
                   (pastas.join(', ') || '(nenhuma)'));
        }
        return codigoArg;
    }
    if (pastas.length === 1) { return pastas[0]; }
    if (!pastas.length) { falhar('Nenhuma widget em wcm/widget.'); }
    falhar('Há mais de uma widget em wcm/widget (' + pastas.join(', ') + '). ' +
           'Informe qual: node build-widget.js <codigo>');
    return '';
}

var CODIGO  = detectarCodigo();
var RAIZ    = path.join(PASTA_WIDGETS, CODIGO);
var SRC_RES = path.join(RAIZ, 'src', 'main', 'resources');
var SRC_WEB = path.join(RAIZ, 'src', 'main', 'webapp');
var DESTINO = path.join(RAIZ, 'target', CODIGO + '.war');
var INFO    = path.join(SRC_RES, 'application.info');

if (!fs.existsSync(INFO)) { falhar('Não achei ' + INFO + '.'); }

/* ------------------------------------------------------------------
   Zip minimo (stored) - sem pacote npm: menos um passo para errar numa
   maquina que talvez nao tenha acesso ao registro.
   ------------------------------------------------------------------ */
var TABELA_CRC = null;
function crc32(buf) {
    var c, i, k;
    if (!TABELA_CRC) {
        TABELA_CRC = [];
        for (i = 0; i < 256; i++) {
            c = i;
            for (k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
            TABELA_CRC[i] = c >>> 0;
        }
    }
    c = 0xFFFFFFFF;
    for (i = 0; i < buf.length; i++) { c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dataDos(d) {
    var hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    var dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { hora: hora & 0xFFFF, dia: dia & 0xFFFF };
}

function zip(entradas) {
    var locais = [], centrais = [], off = 0;
    var dos = dataDos(new Date());

    entradas.forEach(function (e) {
        var nome = Buffer.from(e.nome, 'utf8');
        var crc = crc32(e.dados);

        var cab = Buffer.alloc(30);
        cab.writeUInt32LE(0x04034b50, 0);
        cab.writeUInt16LE(20, 4);              /* versao necessaria */
        cab.writeUInt16LE(0x0800, 6);          /* nomes em UTF-8 */
        cab.writeUInt16LE(0, 8);               /* stored */
        cab.writeUInt16LE(dos.hora, 10);
        cab.writeUInt16LE(dos.dia, 12);
        cab.writeUInt32LE(crc, 14);
        cab.writeUInt32LE(e.dados.length, 18);
        cab.writeUInt32LE(e.dados.length, 22);
        cab.writeUInt16LE(nome.length, 26);
        locais.push(cab, nome, e.dados);

        var cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0);
        cen.writeUInt16LE(20, 4);
        cen.writeUInt16LE(20, 6);
        cen.writeUInt16LE(0x0800, 8);
        cen.writeUInt16LE(0, 10);
        cen.writeUInt16LE(dos.hora, 12);
        cen.writeUInt16LE(dos.dia, 14);
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(e.dados.length, 20);
        cen.writeUInt32LE(e.dados.length, 24);
        cen.writeUInt16LE(nome.length, 28);
        cen.writeUInt32LE(off, 42);
        centrais.push(cen, nome);

        off += 30 + nome.length + e.dados.length;
    });

    var corpoLocal = Buffer.concat(locais);
    var corpoCen = Buffer.concat(centrais);
    var fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(entradas.length, 8);
    fim.writeUInt16LE(entradas.length, 10);
    fim.writeUInt32LE(corpoCen.length, 12);
    fim.writeUInt32LE(corpoLocal.length, 16);
    return Buffer.concat([corpoLocal, corpoCen, fim]);
}

/* ------------------------------------------------------------------
   Varredura. Arquivos que comecam com "." (.gitkeep, .DS_Store) nao vao
   para o WAR.
   ------------------------------------------------------------------ */
function varrer(base, prefixo, saida) {
    if (!fs.existsSync(base)) { return saida; }
    fs.readdirSync(base).sort().forEach(function (nome) {
        if (nome.charAt(0) === '.') { return; }
        var cheio = path.join(base, nome);
        if (fs.statSync(cheio).isDirectory()) { varrer(cheio, prefixo + nome + '/', saida); }
        else { saida.push({ nome: prefixo + nome, dados: fs.readFileSync(cheio) }); }
    });
    return saida;
}

/* resources/**            -> WEB-INF/classes/
   webapp/WEB-INF/**       -> WEB-INF/
   webapp/resources/**     -> resources/ */
var entradas = [];
varrer(SRC_RES, 'WEB-INF/classes/', entradas);
varrer(path.join(SRC_WEB, 'WEB-INF'), 'WEB-INF/', entradas);
varrer(path.join(SRC_WEB, 'resources'), 'resources/', entradas);

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, zip(entradas));

console.log('WAR gerado: ' + path.relative(RAIZ_REPO, DESTINO));
console.log('  ' + entradas.length + ' arquivos, ' + (fs.statSync(DESTINO).size / 1024).toFixed(0) + ' KB');

/* =============================================================================
   CONFERENCIA
============================================================================= */
var info = fs.readFileSync(INFO, 'utf8');
var linhas = info.split(/\r?\n/);
var erros = 0;
var avisos = 0;

function erro(msg) { console.log('  !! ' + msg); erros++; }
function aviso(msg) { console.log('  .. ' + msg); avisos++; }

function prop(chave) {
    var re = new RegExp('^' + chave.replace(/\./g, '\\.') + '=(.*?)\\s*$', 'm');
    var m = info.match(re);
    return m ? m[1].trim() : '';
}

/* 1) chave repetida = perda silenciosa */
var vistas = {};
linhas.forEach(function (l) {
    var m = l.match(/^(application\.resource\.(?:js|css)\.\d+)\s*=/);
    if (!m) { return; }
    vistas[m[1]] = (vistas[m[1]] || 0) + 1;
    if (vistas[m[1]] === 2) {
        erro('CHAVE REPETIDA: ' + m[1] + ' - num .properties a última vence e o recurso da primeira nunca carrega');
    }
});

/* 2) declarado x presente */
var declarados = [];
linhas.forEach(function (l) {
    var m = l.match(/^application\.resource\.(?:js|css)\.\d+\s*=\s*(.+?)\s*$/);
    if (m) { declarados.push(m[1].replace(/^\//, '')); }
});

var dentro = {};
entradas.forEach(function (e) { dentro[e.nome] = true; });

declarados.forEach(function (d) {
    if (!dentro[d]) { erro('DECLARADO E AUSENTE: ' + d + ' - a página vai pedir este arquivo e receber 404'); }
});

entradas.forEach(function (e) {
    if (!/^resources\/(js|css)\/.+\.(js|css)$/.test(e.nome)) { return; }
    if (declarados.indexOf(e.nome) < 0) { aviso('no WAR e NÃO declarado: ' + e.nome + ' - nunca será carregado'); }
});

/* 3) application.code x var do SuperWidget */
var code = prop('application.code');
if (!code) { erro('application.code ausente no application.info'); }
if (code && code !== CODIGO) {
    aviso('application.code=' + code + ' difere do nome da pasta wcm/widget/' + CODIGO);
}

var main = path.join(SRC_WEB, 'resources', 'js', 'main.function.js');
if (!fs.existsSync(main)) {
    erro('main.function.js não encontrado em webapp/resources/js');
} else {
    var mVar = fs.readFileSync(main, 'utf8').match(/var\s+([A-Za-z_$][\w$]*)\s*=\s*SuperWidget\.extend/);
    if (!mVar) {
        erro('main.function.js não declara "var <nome> = SuperWidget.extend"');
    } else if (mVar[1] !== code) {
        erro('NOME DIVERGENTE: application.code=' + code + ' mas main.function.js declara "' + mVar[1] +
             '" - o SuperWidget não encontra a widget e ela nunca inicia');
    }
}

var jboss = path.join(SRC_WEB, 'WEB-INF', 'jboss-web.xml');
if (fs.existsSync(jboss)) {
    var mCtx = fs.readFileSync(jboss, 'utf8').match(/<context-root>\s*\/?([^<\s]+)\s*<\/context-root>/);
    if (mCtx && code && mCtx[1] !== code) {
        aviso('jboss-web.xml usa context-root /' + mCtx[1] + ' (esperado /' + code + ')');
    }
}

/* .properties e lido em ISO-8859-1: acento vira lixo na tela do Fluig */
if (/[^\x00-\x7F]/.test(info)) {
    aviso('application.info tem caractere não ASCII (acento) - o Fluig lê .properties em ISO-8859-1');
}

/* 4) caractere invisivel no fonte (vale tambem para datasets/, que nao vao
      no WAR: o build e o unico lugar por onde todo o fonte passa) */
function varrerInvisiveis(dir, achados) {
    if (!fs.existsSync(dir)) { return achados; }
    fs.readdirSync(dir).forEach(function (nome) {
        var cheio = path.join(dir, nome);
        if (fs.statSync(cheio).isDirectory()) {
            if (nome === 'node_modules' || nome === 'target' || nome.charAt(0) === '.') { return; }
            varrerInvisiveis(cheio, achados);
            return;
        }
        if (!/\.(js|css|ftl|html|info|properties|xml)$/.test(nome)) { return; }
        if (/\.min\.(js|css)$/.test(nome)) { return; }      /* bibliotecas de terceiros */
        var txt = fs.readFileSync(cheio, 'utf8');
        for (var i = 0; i < txt.length; i++) {
            var c = txt.charCodeAt(i);
            var suspeito = (c < 9) || (c > 13 && c < 32) || c === 0xFEFF || c === 0x200B ||
                           c === 0x200C || c === 0x200D || c === 0x2028 || c === 0x2029;
            if (!suspeito) { continue; }
            if (i === 0 && c === 0xFEFF) { continue; }    /* BOM no inicio e marca de arquivo */
            var hex = c.toString(16).toUpperCase();
            while (hex.length < 4) { hex = '0' + hex; }
            achados.push({
                arquivo: path.relative(RAIZ_REPO, cheio),
                codigo: 'U+' + hex,
                contexto: txt.slice(Math.max(0, i - 45), i + 15).replace(/\r?\n/g, ' ')
            });
        }
    });
    return achados;
}

var invisiveis = [];
varrerInvisiveis(path.join(RAIZ, 'src'), invisiveis);
varrerInvisiveis(path.join(RAIZ_REPO, 'datasets'), invisiveis);
invisiveis.forEach(function (a) {
    erro('CARACTERE INVISÍVEL ' + a.codigo + ' em ' + a.arquivo);
    console.log('     ...' + a.contexto + '...');
    console.log('     Escreva a sequência de escape (ex.: \\uFEFF) em vez do caractere.');
});

/* 5) versao: application.info x <ns>.VERSAO (ns detectado no Objects.js) */
var versao = prop('application.version');
var objects = path.join(SRC_WEB, 'resources', 'js', 'Objects.js');
var ns = '';

if (!versao) {
    erro('application.version ausente no application.info');
} else if (/\$\{/.test(versao)) {
    erro('application.version usa variável de build (' + versao + ') - use um número fixo (ex.: 1.0.0)');
} else if (!fs.existsSync(objects)) {
    erro('Objects.js não encontrado - não há como conferir <ns>.VERSAO');
} else {
    var txtObj = fs.readFileSync(objects, 'utf8');
    var mNs = txtObj.match(/global\.([A-Za-z_$][\w$]*)\s*=\s*global\.\1\s*\|\|/) ||
              txtObj.match(/window\.([A-Za-z_$][\w$]*)\s*=\s*window\.\1\s*\|\|/);
    var mVer = null;
    if (mNs) {
        ns = mNs[1];
        mVer = txtObj.match(new RegExp('(?:^|[^\\w$.])' + ns.replace(/\$/g, '\\$') +
                                       '\\.VERSAO\\s*=\\s*[\'"]([^\'"]+)[\'"]'));
    } else {
        mVer = txtObj.match(/([A-Za-z_$][\w$]*)\.VERSAO\s*=\s*['"]([^'"]+)['"]/);
        if (mVer) { ns = mVer[1]; mVer = [mVer[0], mVer[2]]; }
    }
    if (!mVer) {
        erro('Objects.js não declara ' + (ns || '<ns>') + ".VERSAO = '<versao>'");
    } else if (mVer[1] !== versao) {
        erro('VERSÃO DIVERGENTE: application.info=' + versao + ' mas Objects.js declara ' + ns + '.VERSAO="' +
             mVer[1] + '" - o carimbo no rodapé mostraria a versão errada');
    }
}

/* 6) versao tem de MUDAR entre builds */
var marcaVersao = path.join(path.dirname(DESTINO), '.ultima-versao');
var anterior = fs.existsSync(marcaVersao) ? fs.readFileSync(marcaVersao, 'utf8').trim() : null;

if (versao && anterior && anterior === versao && !repetirVersao) {
    console.log('');
    erro('A VERSÃO NÃO MUDOU desde o build anterior (' + versao + ').');
    console.log('     O Fluig serve js/css com cache atrelado a ela: a estrutura nova da tela');
    console.log('     aparece e o estilo/comportamento continuam os velhos. Suba');
    console.log('     application.version E ' + (ns || '<ns>') + '.VERSAO (Objects.js).');
    console.log('     Só conferindo o empacotamento? node build-widget.js --mesma-versao');
}

var jsQtd = declarados.filter(function (d) { return /\.js$/.test(d); }).length;
var cssQtd = declarados.filter(function (d) { return /\.css$/.test(d); }).length;
console.log('  widget ' + CODIGO + ' · versão ' + (versao || '?') + ' · application.info declara ' +
            jsQtd + ' js e ' + cssQtd + ' css' + (avisos ? ' · ' + avisos + ' aviso(s)' : ''));

if (erros) {
    console.log('\n' + erros + ' problema(s). NÃO publique este WAR.');
    process.exit(1);
}

/* So grava a marca quando o build passou: build recusado nao "gasta" versao. */
fs.writeFileSync(marcaVersao, versao);

console.log('\nPronto para publicar - versão ' + versao + '.');
console.log('Depois de publicar, confira o rodapé da barra lateral: deve mostrar "v' + versao + '".');
console.log('Se aparecer outra coisa, é cache do navegador (Ctrl+Shift+R).');
console.log('Lembre: datasets/ e sql/ são publicados à parte (ordem: SQL -> datasets -> WAR).');
