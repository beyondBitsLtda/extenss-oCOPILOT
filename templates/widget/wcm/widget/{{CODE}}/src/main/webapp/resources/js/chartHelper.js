/* ============================================================================
 * chartHelper.js - {{TITULO}} DELP  (widget {{CODE}})
 * ============================================================================
 * Ponto UNICO de graficos da widget. Nenhum modulo chama "new Chart" direto:
 * use {{NS}}.grafico.barras / linha / rosca. Assim todo grafico sai no padrao
 * visual DELP (fonte, paleta validada, grade discreta, rotulos, tabela).
 *
 * Paleta categorica DELP validada (daltonismo, OKLab):
 *   ORDEM = Subsea -> Industria -> Mooring -> Servicos
 *   (Industria nunca vizinha de Servicos: no daltonismo vermelho-verde eles se confundem)
 *   Ate 4 series. A 5a em diante vira "Outros" em cinza (#B0B0B0).
 *   Delp Red (#CC0F10) so para DESTAQUE de um item (forma "enfase"), nunca serie.
 *   Industria tem contraste 2,85:1 no branco e Mooring some no tema escuro:
 *   por isso todo grafico tem legenda, rotulos diretos seletivos e "Ver tabela".
 *
 * API:
 *   {{NS}}.grafico.disponivel()                -> Chart.js real carregado?
 *   {{NS}}.grafico.barras(host$, cfg)          -> comparar magnitudes / series
 *   {{NS}}.grafico.linha(host$, cfg)           -> evolucao no tempo
 *   {{NS}}.grafico.rosca(host$, cfg)           -> parte do todo (ate 5 fatias)
 *   {{NS}}.grafico.redesenhar(raiz$)           -> refaz tudo (Controller chama ao trocar tema)
 *   cfg comum: { titulo, categorias, series:[{nome, valores}], formato, altura, aoClicar }
 *   formato: 'numero' (padrao) | 'moeda' | 'percentual' | 'compacto'
 *   barras: horizontal, empilhado, destaque (indice/categoria em vermelho, resto cinza)
 *   linha:  area (preenche quando ha 1 serie)
 *   rosca:  itens:[{nome, valor}]
 *
 * Sem Chart.js (lib ausente): mostra barras simples em HTML + tabela.
 * Ordem de carga: depois de Objects.js/Componentes.js e de lib/chart.umd.min.js.
 * v1.0.0 - {{DATA}} - criacao
 * ============================================================================ */
(function (global, $) {
    'use strict';

    var {{NS}} = global.{{NS}} = global.{{NS}} || {};
    var G = {{NS}}.grafico = {{NS}}.grafico || {};
    var PREFIXO = '[{{CODE}}.grafico]';

    // ------------------------------------------------------------------
    // Paleta e cores
    // ------------------------------------------------------------------
    G.PALETA = {
        red: '#CC0F10',
        subsea: '#2362D3',
        industria: '#FF6B05',
        mooring: '#213D75',
        servicos: '#0B861D',
        cinza: '#B0B0B0',
        areia: '#EAE5DF',
        preto: '#000000',
        branco: '#FFFFFF'
    };
    G.ORDEM = [G.PALETA.subsea, G.PALETA.industria, G.PALETA.mooring, G.PALETA.servicos];
    G.MAX_SERIES = 4;

    /* Series com nome de unidade de negocio usam a cor da unidade (cor segue a entidade). */
    var UNIDADES = [
        { re: /subsea/i, cor: G.PALETA.subsea },
        { re: /ind[uú]stria/i, cor: G.PALETA.industria },
        { re: /mooring/i, cor: G.PALETA.mooring },
        { re: /servi[cç]os/i, cor: G.PALETA.servicos }
    ];

    G.disponivel = function () {
        return typeof global.Chart === 'function' && typeof global.Chart.register === 'function';
    };

    G.corDaSerie = function (nome, indice) {
        for (var i = 0; i < UNIDADES.length; i++) {
            if (UNIDADES[i].re.test(String(nome || ''))) { return UNIDADES[i].cor; }
        }
        return indice < G.ORDEM.length ? G.ORDEM[indice] : G.PALETA.cinza;
    };

    /* Cor com transparencia (lavagem de area, rampa sequencial). */
    G.alfa = function (hex, a) {
        var h = String(hex).replace('#', '');
        var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    };

    /* Rampa sequencial de UMA cor (magnitude/ordinal): claro -> escuro. */
    G.rampa = function (n, hex) {
        var base = hex || G.PALETA.subsea, out = [], i;
        for (i = 0; i < n; i++) { out.push(G.alfa(base, n === 1 ? 1 : 0.35 + (0.65 * i) / (n - 1))); }
        return out;
    };

    // ------------------------------------------------------------------
    // Tema (claro/escuro) lido do conteiner raiz
    // ------------------------------------------------------------------
    function tema($host) {
        var escuro = $host.closest('.{{NS}}--tema-escuro').length > 0;
        return escuro
            ? { escuro: true, superficie: '#000000', tinta: '#FFFFFF', apagado: 'rgba(255,255,255,.70)', grade: 'rgba(255,255,255,.12)', tooltip: '#000000' }
            : { escuro: false, superficie: '#FFFFFF', tinta: '#000000', apagado: 'rgba(0,0,0,.62)', grade: 'rgba(0,0,0,.08)', tooltip: '#FFFFFF' };
    }

    // ------------------------------------------------------------------
    // Formatacao pt-BR
    // ------------------------------------------------------------------
    G.formatar = function (v, formato) {
        var n = Number(v);
        if (v === null || v === undefined || v === '' || isNaN(n)) { return '-'; }
        if (formato === 'moeda') { return 'R$ ' + {{NS}}.util.formatarNumero(n, 2); }
        if (formato === 'percentual') { return {{NS}}.util.formatarNumero(n, 1) + '%'; }
        if (formato === 'compacto') {
            var abs = Math.abs(n);
            if (abs >= 1e9) { return {{NS}}.util.formatarNumero(n / 1e9, 1) + ' bi'; }
            if (abs >= 1e6) { return {{NS}}.util.formatarNumero(n / 1e6, 1) + ' mi'; }
            if (abs >= 1e3) { return {{NS}}.util.formatarNumero(n / 1e3, 1) + ' mil'; }
        }
        return {{NS}}.util.formatarNumero(n, Math.round(n) === n ? 0 : 2);
    };

    function eixo(v, formato) {
        return G.formatar(v, formato === 'moeda' || formato === 'numero' || !formato ? 'compacto' : formato);
    }

    // ------------------------------------------------------------------
    // Estrutura comum: area do grafico + "Ver tabela" + tabela acessivel
    // ------------------------------------------------------------------
    function montar($host, cfg, linhasTabela, colunasTabela) {
        destruir($host);
        $host.empty();
        var $raiz = $('<div class="{{NS}}-grafico"></div>');
        if (cfg.titulo) { $raiz.append($('<div class="{{NS}}-grafico__titulo"></div>').text(cfg.titulo)); }
        var $area = $('<div class="{{NS}}-grafico__area"></div>');
        $area.css('height', (cfg.altura || 280) + 'px');
        var $tabela = $('<table class="{{NS}}-tabela {{NS}}-grafico__tabela" hidden></table>');
        var $cab = $('<tr></tr>');
        /* 1a coluna = rotulo; as demais sao numeros (alinhados a direita) */
        for (var c = 0; c < colunasTabela.length; c++) {
            $cab.append($('<th></th>').addClass(c ? '{{NS}}-tabela__cel--dir' : '').text(colunasTabela[c]));
        }
        $tabela.append($('<thead></thead>').append($cab));
        var $corpo = $('<tbody></tbody>');
        for (var l = 0; l < linhasTabela.length; l++) {
            var $tr = $('<tr></tr>');
            for (var k = 0; k < linhasTabela[l].length; k++) {
                $tr.append($('<td></td>').addClass(k ? '{{NS}}-tabela__cel--dir' : '').text(linhasTabela[l][k]));
            }
            $corpo.append($tr);
        }
        $tabela.append($corpo);
        var $alternar = $('<button type="button" class="{{NS}}-btn {{NS}}-btn--ghost {{NS}}-btn--mini {{NS}}-grafico__alternar">Ver tabela</button>');
        $alternar.on('click', function () {
            var aberta = !$tabela.prop('hidden');
            $tabela.prop('hidden', aberta);
            $area.prop('hidden', !aberta);
            $alternar.text(aberta ? 'Ver tabela' : 'Ver gráfico');
        });
        $raiz.append($area, $('<div class="{{NS}}-grafico__acoes"></div>').append($alternar), $tabela);
        $host.append($raiz);
        return $area;
    }

    function destruir($host) {
        var atual = $host.data('{{NS}}-grafico');
        if (atual && typeof atual.destroy === 'function') { atual.destroy(); }
        $host.removeData('{{NS}}-grafico');
    }

    /* Guarda o pedido para redesenhar (troca de tema) sem o modulo precisar refazer a chamada. */
    function lembrar($host, tipo, cfg) {
        $host.attr('data-{{NS}}-grafico-tipo', tipo).data('{{NS}}-grafico-cfg', cfg);
    }

    function vazio(cfg) {
        var series = cfg.series || [];
        for (var i = 0; i < series.length; i++) {
            var vs = series[i].valores || [];
            for (var j = 0; j < vs.length; j++) { if (Number(vs[j])) { return false; } }
        }
        return true;
    }

    function semDados($host, msg) {
        destruir($host);
        $host.empty().append($('<div class="{{NS}}-grafico__vazio"></div>').text(msg || 'Sem dados para o período selecionado.'));
    }

    function reduzido() {
        return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /* Ate MAX_SERIES series; o restante soma em "Outros". */
    function limitarSeries(series) {
        if (series.length <= G.MAX_SERIES) { return series; }
        var mantidas = series.slice(0, G.MAX_SERIES - 1);
        var resto = series.slice(G.MAX_SERIES - 1);
        var soma = [];
        for (var i = 0; i < resto.length; i++) {
            var vs = resto[i].valores || [];
            for (var j = 0; j < vs.length; j++) { soma[j] = (soma[j] || 0) + (Number(vs[j]) || 0); }
        }
        mantidas.push({ nome: 'Outros', valores: soma, outros: true });
        return mantidas;
    }

    // ------------------------------------------------------------------
    // Rotulos diretos seletivos (plugin local): ponta da barra / fim da linha
    // ------------------------------------------------------------------
    function pluginRotulos(t, formato, modo) {
        return {
            id: '{{NS}}Rotulos',
            afterDatasetsDraw: function (chart) {
                var ctx = chart.ctx;
                ctx.save();
                ctx.font = '600 11px Barlow, Inter, system-ui, sans-serif';
                ctx.fillStyle = t.apagado;
                for (var d = 0; d < chart.data.datasets.length; d++) {
                    var meta = chart.getDatasetMeta(d);
                    if (meta.hidden) { continue; }
                    var ds = chart.data.datasets[d];
                    if (modo === 'barras') {
                        for (var i = 0; i < meta.data.length; i++) {
                            var el = meta.data[i], v = ds.data[i];
                            if (v === null || v === undefined) { continue; }
                            var txt = G.formatar(v, formato);
                            if (chart.options.indexAxis === 'y') {
                                ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                                ctx.fillText(txt, el.x + 6, el.y);
                            } else {
                                ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                                ctx.fillText(txt, el.x, el.y - 4);
                            }
                        }
                    } else if (modo === 'linha') {
                        var ult = meta.data.length - 1;
                        if (ult >= 0 && ds.data[ult] !== null && ds.data[ult] !== undefined) {
                            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                            ctx.fillText(G.formatar(ds.data[ult], formato), meta.data[ult].x + 8, meta.data[ult].y);
                        }
                    }
                }
                ctx.restore();
            }
        };
    }

    function opcoesBase(t, formato, legenda, estiloLegenda) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: reduzido() ? false : { duration: 400 },
            layout: { padding: { top: 18, right: 40 } },
            font: { family: 'Barlow, Inter, system-ui, sans-serif' },
            plugins: {
                legend: {
                    display: legenda,
                    position: 'top',
                    align: 'start',
                    labels: { color: t.tinta, usePointStyle: true, pointStyle: estiloLegenda, boxWidth: 10, boxHeight: 10, padding: 14,
                        font: { family: 'Barlow, Inter, system-ui, sans-serif', size: 12, weight: '500' } }
                },
                tooltip: {
                    backgroundColor: t.tooltip,
                    titleColor: t.tinta,
                    bodyColor: t.tinta,
                    borderColor: t.grade,
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 6,
                    usePointStyle: true,
                    titleFont: { family: 'Barlow, Inter, system-ui, sans-serif', weight: '600' },
                    bodyFont: { family: 'Barlow, Inter, system-ui, sans-serif' },
                    callbacks: {
                        /* valor primeiro, nome da serie depois */
                        label: function (item) {
                            var v = item.parsed && typeof item.parsed === 'object' ? (item.chart.options.indexAxis === 'y' ? item.parsed.x : item.parsed.y) : item.parsed;
                            return ' ' + G.formatar(v, formato) + '  ' + (item.dataset.label || item.label || '');
                        }
                    }
                }
            }
        };
    }

    function eixos(t, formato, horizontal, empilhado) {
        var valor = {
            beginAtZero: true,
            stacked: !!empilhado,
            grid: { color: t.grade, lineWidth: 1, drawTicks: false },
            border: { display: false },
            ticks: { color: t.apagado, padding: 8, maxTicksLimit: 6, font: { family: 'Barlow, Inter, system-ui, sans-serif', size: 11 },
                callback: function (v) { return eixo(v, formato); } }
        };
        var categoria = {
            stacked: !!empilhado,
            grid: { display: false },
            border: { color: t.grade },
            ticks: { color: t.apagado, padding: 6, autoSkip: true, maxRotation: 0, font: { family: 'Barlow, Inter, system-ui, sans-serif', size: 11 } }
        };
        return horizontal ? { x: valor, y: categoria } : { x: categoria, y: valor };
    }

    function clique(cfg, categorias) {
        if (typeof cfg.aoClicar !== 'function') { return undefined; }
        return function (ev, elementos) {
            if (elementos && elementos.length) {
                var e = elementos[0];
                cfg.aoClicar(categorias[e.index], e.index, e.datasetIndex);
            }
        };
    }

    // ------------------------------------------------------------------
    // Barras / colunas
    // ------------------------------------------------------------------
    G.barras = function ($host, cfg) {
        cfg = cfg || {};
        lembrar($host, 'barras', cfg);
        var categorias = cfg.categorias || [];
        if (!categorias.length || vazio(cfg)) { semDados($host, cfg.vazio); return null; }
        var series = limitarSeries(cfg.series || []);
        var t = tema($host);
        var formato = cfg.formato || 'numero';
        var cols = ['Categoria'], linhas = [], i, j;
        for (j = 0; j < series.length; j++) { cols.push(series[j].nome || 'Valor'); }
        for (i = 0; i < categorias.length; i++) {
            var linha = [String(categorias[i])];
            for (j = 0; j < series.length; j++) { linha.push(G.formatar((series[j].valores || [])[i], formato)); }
            linhas.push(linha);
        }
        var $area = montar($host, cfg, linhas, cols);
        if (!G.disponivel()) { return fallbackBarras($area, categorias, series, formato); }

        var destaque = cfg.destaque;
        if (typeof destaque === 'string') { destaque = categorias.indexOf(destaque); }
        var datasets = [];
        for (j = 0; j < series.length; j++) {
            var cor = series[j].outros ? G.PALETA.cinza : G.corDaSerie(series[j].nome, j);
            var cores = cor;
            if (series.length === 1 && destaque !== undefined && destaque !== null && destaque >= 0) {
                cores = [];
                for (i = 0; i < categorias.length; i++) { cores.push(i === destaque ? G.PALETA.red : G.PALETA.cinza); }
            }
            var escuroMooring = t.escuro && cor === G.PALETA.mooring;
            datasets.push({
                label: series[j].nome || 'Valor',
                data: series[j].valores || [],
                backgroundColor: cores,
                hoverBackgroundColor: cores,
                maxBarThickness: 24,
                borderRadius: cfg.empilhado ? 0 : 4,
                borderSkipped: 'start',
                /* empilhado: 2px na cor da superficie separa os segmentos; Mooring no escuro ganha contorno */
                borderColor: cfg.empilhado ? t.superficie : (escuroMooring ? G.PALETA.cinza : 'transparent'),
                borderWidth: cfg.empilhado ? 2 : (escuroMooring ? 1 : 0)
            });
        }
        var opcoes = opcoesBase(t, formato, series.length >= 2, 'rectRounded');
        opcoes.indexAxis = cfg.horizontal ? 'y' : 'x';
        opcoes.scales = eixos(t, formato, cfg.horizontal, cfg.empilhado);
        opcoes.interaction = { mode: 'nearest', intersect: true };
        opcoes.onClick = clique(cfg, categorias);
        var rotular = series.length === 1 && !cfg.empilhado && categorias.length <= 12;
        var grafico = new global.Chart($('<canvas></canvas>').appendTo($area)[0], {
            type: 'bar',
            data: { labels: categorias, datasets: datasets },
            options: opcoes,
            plugins: rotular ? [pluginRotulos(t, formato, 'barras')] : []
        });
        $host.data('{{NS}}-grafico', grafico);
        return grafico;
    };

    // ------------------------------------------------------------------
    // Linha / area
    // ------------------------------------------------------------------
    G.linha = function ($host, cfg) {
        cfg = cfg || {};
        lembrar($host, 'linha', cfg);
        var categorias = cfg.categorias || [];
        if (!categorias.length || vazio(cfg)) { semDados($host, cfg.vazio); return null; }
        var series = limitarSeries(cfg.series || []);
        var t = tema($host);
        var formato = cfg.formato || 'numero';
        var cols = ['Período'], linhas = [], i, j;
        for (j = 0; j < series.length; j++) { cols.push(series[j].nome || 'Valor'); }
        for (i = 0; i < categorias.length; i++) {
            var l = [String(categorias[i])];
            for (j = 0; j < series.length; j++) { l.push(G.formatar((series[j].valores || [])[i], formato)); }
            linhas.push(l);
        }
        var $area = montar($host, cfg, linhas, cols);
        if (!G.disponivel()) { $area.prop('hidden', true); $host.find('.{{NS}}-grafico__tabela').prop('hidden', false); return null; }

        var datasets = [];
        for (j = 0; j < series.length; j++) {
            var cor = series[j].outros ? G.PALETA.cinza : G.corDaSerie(series[j].nome, j);
            var preencher = !!cfg.area && series.length === 1;
            datasets.push({
                label: series[j].nome || 'Valor',
                data: series[j].valores || [],
                borderColor: cor,
                backgroundColor: preencher ? G.alfa(cor, 0.10) : cor,
                fill: preencher ? 'origin' : false,
                borderWidth: 2,
                borderCapStyle: 'round',
                borderJoinStyle: 'round',
                tension: 0.25,
                /* so o ultimo ponto aparece; os demais surgem no hover */
                pointRadius: function (c) { return c.dataIndex === c.dataset.data.length - 1 ? 4 : 0; },
                pointBackgroundColor: cor,
                pointBorderColor: t.superficie,
                pointBorderWidth: 2,
                pointHoverRadius: 5,
                pointHoverBorderWidth: 2,
                pointHitRadius: 12
            });
        }
        var opcoes = opcoesBase(t, formato, series.length >= 2, 'line');
        opcoes.scales = eixos(t, formato, false, false);
        opcoes.interaction = { mode: 'index', intersect: false };
        opcoes.onClick = clique(cfg, categorias);
        var grafico = new global.Chart($('<canvas></canvas>').appendTo($area)[0], {
            type: 'line',
            data: { labels: categorias, datasets: datasets },
            options: opcoes,
            plugins: series.length <= 4 ? [pluginRotulos(t, formato, 'linha')] : []
        });
        $host.data('{{NS}}-grafico', grafico);
        return grafico;
    };

    // ------------------------------------------------------------------
    // Rosca (parte do todo; 4 fatias com cor + "Outros" em cinza)
    // ------------------------------------------------------------------
    G.rosca = function ($host, cfg) {
        cfg = cfg || {};
        lembrar($host, 'rosca', cfg);
        var itens = (cfg.itens || []).slice().sort(function (a, b) { return (Number(b.valor) || 0) - (Number(a.valor) || 0); });
        var total = 0, i;
        for (i = 0; i < itens.length; i++) { total += Number(itens[i].valor) || 0; }
        if (!itens.length || !total) { semDados($host, cfg.vazio); return null; }
        if (itens.length > G.MAX_SERIES + 1) {
            var outros = 0;
            for (i = G.MAX_SERIES; i < itens.length; i++) { outros += Number(itens[i].valor) || 0; }
            itens = itens.slice(0, G.MAX_SERIES).concat([{ nome: 'Outros', valor: outros, outros: true }]);
        }
        var t = tema($host);
        var formato = cfg.formato || 'numero';
        var linhas = [];
        for (i = 0; i < itens.length; i++) {
            linhas.push([String(itens[i].nome), G.formatar(itens[i].valor, formato), G.formatar((Number(itens[i].valor) / total) * 100, 'percentual')]);
        }
        var $area = montar($host, cfg, linhas, ['Item', 'Valor', 'Participação']);
        if (!G.disponivel()) { return fallbackBarras($area, itens.map(function (x) { return x.nome; }), [{ nome: 'Valor', valores: itens.map(function (x) { return x.valor; }) }], formato); }

        /* 4 cores da ORDEM; a 5a fatia (unica sobra ou "Outros") sai em cinza */
        var cores = [];
        for (i = 0; i < itens.length; i++) {
            cores.push(itens[i].outros ? G.PALETA.cinza : G.corDaSerie(itens[i].nome, i));
        }
        var centro = {
            id: '{{NS}}Centro',
            afterDraw: function (chart) {
                var a = chart.chartArea, ctx = chart.ctx;
                var x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.fillStyle = t.tinta;
                ctx.font = '600 20px Barlow, Inter, system-ui, sans-serif';
                ctx.textBaseline = 'bottom';
                ctx.fillText(G.formatar(total, formato === 'moeda' ? 'moeda' : 'compacto'), x, y + 4);
                ctx.fillStyle = t.apagado;
                ctx.font = '500 11px Barlow, Inter, system-ui, sans-serif';
                ctx.textBaseline = 'top';
                ctx.fillText(cfg.rotuloTotal || 'Total', x, y + 8);
                ctx.restore();
            }
        };
        var opcoes = opcoesBase(t, formato, true, 'rectRounded');
        opcoes.cutout = '68%';
        opcoes.layout = { padding: 8 };
        opcoes.plugins.legend.position = 'right';
        opcoes.plugins.legend.align = 'center';
        opcoes.onClick = clique(cfg, itens.map(function (x) { return x.nome; }));
        var grafico = new global.Chart($('<canvas></canvas>').appendTo($area)[0], {
            type: 'doughnut',
            data: {
                labels: itens.map(function (x) { return x.nome; }),
                datasets: [{ data: itens.map(function (x) { return Number(x.valor) || 0; }), backgroundColor: cores, borderColor: t.superficie, borderWidth: 2, hoverOffset: 4 }]
            },
            options: opcoes,
            plugins: [centro]
        });
        $host.data('{{NS}}-grafico', grafico);
        return grafico;
    };

    // ------------------------------------------------------------------
    // Plano B sem Chart.js: barras horizontais em HTML (mesmo visual DELP)
    // ------------------------------------------------------------------
    function fallbackBarras($area, categorias, series, formato) {
        console.warn(PREFIXO + ' Chart.js indisponivel (lib/chart.umd.min.js ausente ou placeholder); usando barras simples.');
        $area.css('height', 'auto');
        var valores = series[0].valores || [], max = 0, i;
        for (i = 0; i < valores.length; i++) { max = Math.max(max, Math.abs(Number(valores[i]) || 0)); }
        var $lista = $('<div class="{{NS}}-grafico__simples"></div>');
        for (i = 0; i < categorias.length; i++) {
            var v = Number(valores[i]) || 0;
            var $barra = $('<span class="{{NS}}-grafico__barra"></span>').css('width', (max ? Math.max(2, (Math.abs(v) / max) * 100) : 0) + '%');
            $lista.append(
                $('<div class="{{NS}}-grafico__linha"></div>').append(
                    $('<span class="{{NS}}-grafico__rotulo"></span>').text(String(categorias[i])),
                    $('<span class="{{NS}}-grafico__trilho"></span>').append($barra),
                    $('<span class="{{NS}}-grafico__valor"></span>').text(G.formatar(v, formato))
                )
            );
        }
        $area.append($lista);
        return null;
    }

    /* Refaz os graficos ao trocar o tema: as cores de texto/grade/superficie
       sao lidas no momento do desenho, entao o grafico e montado de novo. */
    G.redesenhar = function ($raiz) {
        ($raiz || $('.{{CODE}}')).find('[data-{{NS}}-grafico-tipo]').each(function () {
            var $h = $(this), tipo = $h.attr('data-{{NS}}-grafico-tipo'), cfg = $h.data('{{NS}}-grafico-cfg');
            if (cfg && typeof G[tipo] === 'function') { G[tipo]($h, cfg); }
        });
    };

}(window, jQuery));
