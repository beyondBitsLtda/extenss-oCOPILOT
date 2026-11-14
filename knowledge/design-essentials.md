Lembrete de design DELP (o guia completo foi enviado no início da conversa):
- Forma pelo trabalho do dado: KPI para 1 número, barras para comparar (horizontais com nomes longos, ordenadas), linha para tempo, rosca só com até 5 partes. Nunca eixo duplo.
- Cores na ordem fixa Subsea #2362D3 -> Indústria #FF6B05 -> Mooring #213D75 -> Serviços #0B861D; máximo 4 séries, o resto em "Outros" #B0B0B0; Delp Red #CC0F10 só para destaque de 1 item/CTA; nada fora da paleta.
- Gráfico em widget: sempre <ns>.grafico.barras/linha/rosca (chartHelper.js), nunca new Chart; lib/chart.umd.min.js tem de ser o Chart.js real.
- Toda tela: toolbar com filtros numa linha, KPIs, cards com título curto, estados de carregando/vazio/erro, tokens CSS (sem style inline, sem alert/confirm), legenda + rótulos + "Ver tabela".
