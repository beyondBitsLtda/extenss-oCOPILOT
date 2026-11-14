/* embutir-css.js - copia o delp-copilot-addon.css para dentro do delp-copilot-addon.js

   O addon e UM arquivo so: quem usa copia o .js e pronto. O visual mora no
   .css (legivel, comentado) e entra no .js como texto, entre as marcas
   @@CSS-INICIO@@ e @@CSS-FIM@@, sem comentarios e sem espaco sobrando.
   O .js injeta esse texto num <style id="dca-estilo">.

   Uma copia so vale enquanto for igual ao original: o teste do addon refaz a
   copia e compara. Mudou o .css e nao rodou este script, o teste acusa.

   Rodar (de qualquer pasta):
     node addon/ferramentas/embutir-css.js

   (Mesmo esquema do componente-de-apresentacao/ferramentas/embutir-css.js.)
*/
const fs = require('fs');
const path = require('path');

const PASTA = path.resolve(__dirname, '..');
const ARQ_CSS = path.join(PASTA, 'delp-copilot-addon.css');
const ARQ_JS = path.join(PASTA, 'delp-copilot-addon.js');
const INICIO = '/* @@CSS-INICIO@@';
const FIM = '/* @@CSS-FIM@@ */';

/* tira comentarios e espaco; nao mexe dentro de strings ('...' e "...") */
function compactar(css) {
    let out = '', i = 0, aspas = '';
    while (i < css.length) {
        const c = css[i];
        if (aspas) {
            out += c;
            if (c === '\\') { out += css[i + 1] || ''; i += 2; continue; }
            if (c === aspas) aspas = '';
            i++; continue;
        }
        if (c === '"' || c === "'") { aspas = c; out += c; i++; continue; }
        if (c === '/' && css[i + 1] === '*') {
            const f = css.indexOf('*/', i + 2);
            i = f < 0 ? css.length : f + 2;
            continue;
        }
        out += c; i++;
    }
    return out.replace(/\s+/g, ' ')
              .replace(/\s*([{};,>])\s*/g, '$1')
              .replace(/;}/g, '}')
              .trim();
}

function linhaCss(cssTexto) {
    return '    var CSS = ' + JSON.stringify(compactar(cssTexto)) + ';';
}

function embutir(jsTexto, cssTexto) {
    const ini = jsTexto.indexOf(INICIO);
    const fim = jsTexto.indexOf(FIM);
    if (ini < 0 || fim < 0 || fim < ini) throw new Error('marcas @@CSS-INICIO@@/@@CSS-FIM@@ nao encontradas no delp-copilot-addon.js');
    const fimLinhaIni = jsTexto.indexOf('\n', ini) + 1;
    const iniLinhaFim = jsTexto.lastIndexOf('\n', fim) + 1;
    return jsTexto.slice(0, fimLinhaIni) + linhaCss(cssTexto) + '\n' + jsTexto.slice(iniLinhaFim);
}

module.exports = { compactar, linhaCss, embutir, ARQ_CSS, ARQ_JS };

if (require.main === module) {
    const css = fs.readFileSync(ARQ_CSS, 'utf8');
    const js = fs.readFileSync(ARQ_JS, 'utf8');
    const novo = embutir(js, css);
    if (novo === js) { console.log('delp-copilot-addon.js ja esta com o CSS atual.'); process.exit(0); }
    fs.writeFileSync(ARQ_JS, novo);
    console.log('CSS embutido em delp-copilot-addon.js (' + (compactar(css).length / 1024).toFixed(1) + ' KB).');
}
