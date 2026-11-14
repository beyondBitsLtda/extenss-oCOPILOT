# Guia de design DELP para telas e gráficos

Use este guia sempre que criar ou alterar uma tela, painel, dashboard, gráfico, KPI, tabela ou CSS. Ele vale para widgets Fluig e para qualquer HTML gerado. O objetivo é que a tela saia bonita **por construção**: forma certa, cores da paleta validada, marcas finas, estados completos e acessibilidade.

## 1. Ordem de decisão (cor vem por último)

1. **Qual é o trabalho do dado?** Comparar tamanhos, mostrar evolução, mostrar parte do todo, dar um número-manchete, listar detalhes.
2. **Escolha a forma** pela tabela da seção 2. Às vezes a resposta é *não fazer gráfico* (um KPI ou uma tabela resolve).
3. **Atribua cor pela função** (seção 3), sempre na ordem fixa.
4. **Aplique as especificações de marca** (seção 4).
5. **Complete os estados**: carregando, vazio, erro, sem permissão (seção 6).
6. **Revise acessibilidade** (seção 8) e os antipadrões (seção 9).

## 2. Escolha da forma

| Trabalho do dado | Forma | Observação |
|---|---|---|
| Um número que importa (total, % atingido) | **KPI** (card com rótulo, valor, detalhe) | Não transforme 1 número em gráfico |
| Comparar categorias | **Barras** | Horizontais quando os nomes são longos ou há mais de 6 categorias; ordene do maior para o menor (exceto ordem natural: meses, etapas) |
| Evolução no tempo | **Linha** | Até 4 séries; área só com 1 série |
| Composição no tempo | **Barras empilhadas** | Até 4 segmentos; o resto vira "Outros" |
| Parte do todo, poucas partes | **Rosca** | Até 4 fatias com cor + "Outros"; com mais, use barras |
| Destacar 1 item entre vários | **Barras com destaque** | Item em Delp Red, resto em cinza (`destaque`) |
| Muitos detalhes, busca, ordenação | **Tabela** | Números alinhados à direita, `tabular-nums` |

Nunca: pizza 3D, gráfico de radar, gauge decorativo, **eixo duplo** (duas escalas no mesmo gráfico; faça dois gráficos), mais de 4 séries coloridas.

## 3. Cores (paleta DELP validada)

- **Ordem categórica fixa:** `Subsea #2362D3 → Indústria #FF6B05 → Mooring #213D75 → Serviços #0B861D`. Esta ordem foi validada para daltonismo (Indústria nunca fica ao lado de Serviços, que se confundem no vermelho-verde). Não reordene e não cicle cores.
- **Cor segue a entidade:** série com nome de unidade de negócio usa a cor da unidade (o helper faz isso sozinho). Filtrar não pode repintar as séries que sobraram.
- **5ª série em diante** vira "Outros" em cinza `#B0B0B0`. Nunca invente uma 5ª cor.
- **Delp Red `#CC0F10`** só para **destaque** (1 item, CTA, alerta). Nunca é série, nunca fundo de bloco grande de texto.
- **Magnitude (sequencial):** uma cor só, de clara para escura (`<ns>.grafico.rampa(n, cor)`). Nunca arco-íris.
- **Status** (ok/aviso/erro/info) só em badges e indicadores, sempre com texto ou ícone, nunca como cor de série.
- **Texto nunca usa a cor da série:** rótulos, valores e legendas usam tinta (`--<ns>-ink`) ou texto apagado (`--<ns>-muted`). A cor fica na marca ao lado.
- **Fundos:** `#EAE5DF` (areia, fundo da página), `#FFFFFF` (cards), `#000000` (sidebar, tema escuro), `#B0B0B0` (neutro/linhas).
- Fora da paleta: proibido sem pedido explícito. Tons suaves = transparência de uma cor da paleta (`rgba(...)`), nunca um hex novo.
- **Limitações conhecidas** (por isso legenda, rótulos e "Ver tabela" são obrigatórios): Indústria tem contraste 2,85:1 no branco (não use como cor de texto); Mooring quase some no tema escuro (o helper põe contorno).

## 4. Especificações de marca

- Barras com no máximo 24px de espessura e cantos de 4px só na ponta de dados; base reta no eixo; eixo de valor começa em zero.
- Linhas de 2px, pontas arredondadas; ponto só no último valor (os outros aparecem no hover).
- Separação de 2px na cor da superfície entre segmentos empilhados e fatias.
- Grade só no eixo de valor, linha fina e discreta; eixo de categoria sem grade.
- Rótulos diretos **seletivos**: valor na ponta de cada barra quando há 1 série e até 12 categorias; último valor no fim de cada linha. Nunca número em todos os pontos.
- Legenda sempre que houver 2 séries ou mais, no topo, à esquerda. Com 1 série, o título do card nomeia o dado (sem legenda).
- Eixos com números compactos (`1,2 mil`, `3,4 mi`); tooltip com o valor completo, valor primeiro e nome da série depois.
- Hover/tooltip em todo gráfico (o helper já configura).

## 5. Layout de tela (widget)

- Estrutura padrão: sidebar preta, topbar com crumb e título, abas em `<section>`. Dentro da aba: **toolbar** (filtros à esquerda, ações à direita, numa única linha acima dos gráficos) → **KPIs** (grade de 4, cai para 2 e 1 no responsivo) → **cards** com gráfico → **card** com tabela de detalhe.
- Cada gráfico mora em um `<ns>-card` com `__cab` (título curto, substantivo: "Valor por unidade", não "Gráfico 1") e `__corpo` com `data-<ns>-container`.
- Dois gráficos lado a lado: grade CSS com `minmax(0, 1fr)`, que vira 1 coluna abaixo de 1100px.
- Espaçamento em múltiplos de 4px (8, 12, 16, 24). Cards com `--<ns>-radius-lg` e `--<ns>-shadow`.
- Tipografia: Barlow 500 no corpo; 600 em títulos de card; 700 só no valor do KPI. Rótulos de KPI e cabeçalhos de tabela em caixa alta pequena (11-12px, `letter-spacing .4px`).
- KPI: rótulo, valor grande com `tabular-nums`, detalhe opcional (variação, período) e faixa lateral de 4px na cor da unidade (`unidade: 'subsea'`...). No máximo 1 KPI em destaque vermelho.
- Tabela: números à direita, datas `dd/mm/aaaa hh:mm`, moeda `R$ 1.234,56`, linha inteira clicável quando abre detalhe.

## 6. Estados obrigatórios

Todo container nasce com placeholder "Carregando..." e precisa tratar:
- **Carregando:** `C.Spinner.no(host, 'Carregando ...')` ou o placeholder.
- **Vazio:** mensagem clara do que falta ("Nenhum pedido no período selecionado."), nunca gráfico vazio com eixos. O helper mostra `cfg.vazio` quando não há valores.
- **Erro:** placeholder `--erro` com a causa e o que fazer, e `C.Toast.erro`. Limpe também os containers de KPI e gráfico.
- **Sem permissão:** esconda o módulo (Permissoes.js), não mostre botão que vai falhar.

## 7. Gráficos na widget: sempre `<ns>.grafico`

Todo gráfico passa pelo `chartHelper.js` (já vem no modelo gerado por `@gerar: widget`). **Nunca** chame `new Chart(...)` direto nem configure cores à mão.

```js
// barras: comparar categorias (1 série, horizontal, valor na ponta)
<ns>.grafico.barras(self._host('vg-grafico-unidades'), {
    categorias: ['Subsea', 'Indústria', 'Mooring', 'Serviços'],
    series: [{ nome: 'Receita', valores: [120, 80, 45, 60] }],
    horizontal: true, formato: 'moeda', vazio: 'Sem receita no período.'
});

// barras com destaque de 1 item (vermelho) e o resto cinza
<ns>.grafico.barras($host, { categorias: meses, series: [{ nome: 'Pedidos', valores: v }], destaque: 'Jun' });

// linha: evolução (até 4 séries; area: true com 1 série)
<ns>.grafico.linha($host, { categorias: meses, series: [{ nome: 'Subsea', valores: a }, { nome: 'Mooring', valores: b }], formato: 'compacto' });

// rosca: parte do todo
<ns>.grafico.rosca($host, { itens: [{ nome: 'Aberto', valor: 12 }, { nome: 'Fechado', valor: 30 }], rotuloTotal: 'Chamados' });
```

- `formato`: `'numero'` | `'moeda'` | `'percentual'` | `'compacto'`. `altura` em px (padrão 280; barras horizontais: ~36px por categoria + 40).
- `aoClicar(categoria, indice, serie)` para drill-down.
- Todo gráfico ganha o botão "Ver tabela" (tabela acessível com os mesmos números).
- Troca de tema: o Controller chama `<ns>.grafico.redesenhar()`; não precisa refazer nada.
- `lib/chart.umd.min.js` precisa ser o **Chart.js real** (v4, ~200 KB). Se for um arquivo pequeno de placeholder, o helper cai no plano B (barras HTML simples) e avisa no console. Em widget antiga, copie a lib do modelo gerado.
- Widget criada antes do helper: crie `resources/js/chartHelper.js` copiando do modelo (`@gerar: widget` em pasta temporária) e declare no application.info logo depois do Permissoes.js, renumerando.

## 8. Acessibilidade

- Contraste mínimo WCAG AA: texto 4,5:1 (texto pequeno nunca em Indústria ou cinza sobre branco); elementos gráficos 3:1.
- Identidade nunca só pela cor: legenda + rótulo direto + tabela.
- Foco visível em botões e links (`--<ns>-foco`), `role`/`aria-label` em navegação, `aria-live` em toasts.
- Respeite `prefers-reduced-motion` (o helper desliga animação).
- Tema escuro é **escolhido**, não invertido: use os tokens do tema (`.<ns>--tema-escuro`), nunca `filter: invert`.

## 9. Antipadrões (se a tela tem um destes, está errada)

- Cor fora da paleta, hex novo "parecido", gradiente decorativo, sombra pesada.
- Vermelho como cor de série ou fundo de bloco de texto.
- Mais de 4 cores num gráfico; legenda com 10 itens; cores repetidas para séries diferentes.
- Eixo duplo; eixo de barras que não começa em zero; pizza com 8 fatias.
- Número em todos os pontos da linha; rótulos girados a 45°.
- `style="..."` inline no HTML/FTL (toda aparência vai para o CSS com tokens).
- `alert()`/`confirm()`; FLUIGC/Bootstrap (`btn btn-primary`, `col-md-*`) nas widgets.
- Dado mockado no HTML; container sem estado de vazio e erro.
- Gráfico sem título; título genérico ("Gráfico", "Dados").
- CDN para bibliotecas (sempre `resources/js/lib`).

## 10. Revisão de design por print

Quando o usuário colar um print da tela e pedir revisão (ou disser que "está feio"):
1. Descreva em 1-2 linhas o que a tela mostra.
2. Liste os problemas em ordem de impacto, cada um com a regra deste guia que ele quebra (forma errada, cor fora da paleta, excesso de séries, falta de legenda/estado, hierarquia, espaçamento, contraste).
3. Corrija no código com blocos `editar` (CSS com tokens, troca para `<ns>.grafico.*`, estados), sem pedir confirmação.
4. Feche com o checklist do que mudou visualmente.
