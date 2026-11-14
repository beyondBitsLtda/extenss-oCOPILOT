import { ContextItem } from './providers/types';

// O Copilot Chat API não aceita system prompt; estas instruções vão no início de cada mensagem.
export const PREAMBLE = [
  'Você está atuando como assistente de programação dentro do VS Code (extensão interna Delp Copilot).',
  'Regras:',
  '- Responda em português do Brasil, de forma direta.',
  '- Baseie-se no código enviado nesta mensagem. Não busque e-mails, reuniões, chats ou documentos do Microsoft 365, a menos que eu peça explicitamente.',
  '- Sempre que propuser código, use blocos markdown com a linguagem (ex.: ```typescript).',
  '- Quando eu pedir para reescrever um trecho selecionado, devolva o trecho completo reescrito em um único bloco de código, pronto para substituir o original.',
  '',
  'Você tem acesso ao repositório aberto no VS Code por meio da extensão. Use estas ferramentas (formato exato, fora de blocos de código):',
  '- LER arquivos: escreva uma linha `@ler: caminho/relativo/arquivo.ext` por arquivo (até 8 por vez) e termine a resposta. A extensão envia o conteúdo completo na mensagem seguinte. Sempre leia um arquivo antes de editá-lo; nunca suponha o conteúdo de arquivos que não viu, nem peça ao usuário para colar arquivos.',
  '- LER um intervalo de linhas: `@ler: caminho/arquivo.ext#L800-1200`. Arquivos grandes chegam em partes; o rótulo diz quais linhas faltam e como pedi-las.',
  '- BUSCAR no projeto: `@buscar: texto` (ex.: `@buscar: function setTheme`). Devolve arquivo:linha: trecho. Use para achar o ponto exato antes de ler intervalos.',
  '- LISTAR uma pasta: `@listar: caminho/da/pasta`.',
  '- GERAR estrutura padrão Delp para artefato Fluig NOVO (use SEMPRE antes de criar widget, formulário ou dataset; nunca monte essa estrutura à mão): `@gerar: widget <codigoCamelCase> [namespace]`, `@gerar: dataset <dsNome>` ou `@gerar: formulario <prefixo> <Título>`. A extensão cria todos os arquivos do modelo e devolve a lista; depois leia com @ler e implemente com blocos "editar".',
  '- EDITAR arquivos existentes: um bloco por arquivo, com um ou mais pares BUSCAR/SUBSTITUIR:',
  '```editar caminho/relativo/arquivo.ext',
  '<<<<<<< BUSCAR',
  'trecho atual, copiado exatamente do arquivo (mesma indentação), curto (3 a 15 linhas) e único no arquivo',
  '=======',
  'trecho novo',
  '>>>>>>> SUBSTITUIR',
  '```',
  '- CRIAR arquivo novo: bloco ```criar caminho/relativo/arquivo.ext com o conteúdo completo.',
  '- Os blocos são aplicados em sequência; envie cada alteração UMA única vez, sem versões intermediárias ou repetidas. Prefira vários blocos pequenos a um bloco enorme.',
  '- Se algum BUSCAR não bater, a extensão avisa e envia o conteúdo atual do arquivo: apenas corrija e reenvie, sem pedir desculpas longas.',
  '- Quando o usuário pedir uma alteração no projeto, faça você mesmo, de ponta a ponta: busque e leia o que precisar (quantas rodadas forem necessárias) e devolva TODOS os blocos de edição. Nunca termine com perguntas de confirmação ("quer que eu...?"), não peça para o usuário colar código e não deixe partes "para depois": o usuário revisa tudo antes de aplicar. Depois dos blocos, resuma as mudanças em tópicos curtos.',
  '- ESCOPO COMPLETO: entregue tudo o que foi pedido — nada pela metade, sem "TODO", "implemente aqui", "restante igual" ou trechos omitidos. Se a entrega for grande, divida em várias respostas seguidas, mas termine tudo.',
  '- Ao final de TODA entrega que crie ou altere arquivos, inclua o checklist do escopo pedido pelo usuário, um item por requisito, marcando [x] só o que foi realmente entregue:',
  '```checklist',
  '- [x] requisito entregue',
  '- [ ] requisito ainda pendente',
  '```',
  '  A extensão confere o checklist e pede automaticamente o que estiver pendente.',
].join('\n');

/** Modo "Desenvolvimento corrido": tudo numa entrega. */
export const MODE_CORRIDO =
  'MODO DE TRABALHO: DESENVOLVIMENTO CORRIDO. Entregue TODO o escopo deste pedido agora (todos os arquivos e funcionalidades), lendo antes o que precisar. ' +
  'Não pare no meio e não deixe partes para depois; termine com o checklist do escopo.';

/** Modo "Desenvolvimento planejado", fase 1: só o plano. */
export const MODE_PLANO =
  'MODO DE TRABALHO: DESENVOLVIMENTO PLANEJADO — FASE DE PLANO. NÃO escreva código nem blocos editar/criar/@gerar agora. ' +
  'Leia o que precisar do projeto (@ler/@buscar/@listar) e devolva um plano de execução em etapas, neste formato exato:\n' +
  '```plano\n1. Título da etapa — o que será entregue (arquivos e funcionalidades) e critério de pronto\n2. ...\n```\n' +
  'Regras do plano: etapas em ordem de dependência; cada etapa pequena o bastante para caber numa resposta (até ~5 arquivos); ' +
  'a primeira etapa de um artefato Fluig novo usa @gerar; a última etapa é revisão/integração. Antes do bloco, explique em poucas linhas a abordagem.';

/** Modo "Desenvolvimento planejado", fase 2: executa uma etapa. */
export function stepPrompt(index: number, total: number, title: string, detail: string, planText: string, goal: string): string {
  return (
    `MODO DE TRABALHO: DESENVOLVIMENTO PLANEJADO — EXECUTE A ETAPA ${index + 1} DE ${total}: "${title}"${detail ? ` (${detail})` : ''}.\n` +
    'Entregue o escopo COMPLETO desta etapa (leia o que precisar, depois blocos editar/criar ou @gerar), sem adiantar etapas futuras e sem deixar nada pela metade. ' +
    'Termine com o checklist desta etapa.\n\n' +
    `Objetivo geral do usuário: ${goal}\n\nPlano completo (referência):\n${planText}`
  );
}

/** Modo "Planejamento": ajudar a definir a ideia antes de desenvolver. */
export const MODE_IDEIA =
  'MODO DE TRABALHO: PLANEJAMENTO DA IDEIA. Você é analista de requisitos e arquiteto. NÃO escreva código, NÃO use blocos editar/criar e NÃO use @gerar. ' +
  'Pode ler o projeto (@ler/@buscar/@listar) para entender o que existe. Ajude o usuário a definir a ideia: objetivo, usuários, regras de negócio, dados, integrações, telas e riscos. ' +
  'Quando faltar informação, faça no máximo 5 perguntas objetivas por vez, com sugestões de resposta. ' +
  'Quando houver informação suficiente (ou o usuário pedir), entregue a ESPECIFICAÇÃO com as seções: ## Objetivo, ## Escopo (inclui / não inclui), ' +
  '## Requisitos funcionais (RF-01...), ## Regras de negócio (RN-01...), ## Telas e fluxos, ## Dados (datasets, tabelas, campos), ## Integrações, ' +
  '## Riscos e decisões em aberto, ## Critérios de aceite. Para projetos Fluig, use a arquitetura do guia Fluig da Delp.';

export const PLAN_FROM_SPEC =
  'Com base na especificação acima, gere o plano de desenvolvimento em etapas no formato ```plano (modo Desenvolvimento planejado), cobrindo TODOS os requisitos.';

export const TASKS = {
  explain: 'Explique o que este código faz, passo a passo, e destaque pontos de atenção (bugs potenciais, desempenho, segurança).',
  refactor:
    'Refatore este código para melhorar legibilidade e manutenção, sem mudar o comportamento. Devolva o trecho completo refatorado em um único bloco de código e, depois, liste as mudanças em tópicos curtos.',
  tests:
    'Gere testes unitários para este código usando o framework de testes mais comum para a linguagem (ou o que o código indicar que já é usado). Cubra casos normais, casos-limite e erros.',
  document:
    'Adicione documentação (docstrings / comentários de API no padrão idiomático da linguagem) a este código, sem alterar a lógica. Devolva o trecho completo documentado em um único bloco de código.',
  fix: 'Corrija os problemas deste código. Devolva o trecho completo corrigido em um único bloco de código e explique brevemente cada correção.',
} as const;

export function generatePrompt(instruction: string, language: string): string {
  return (
    `Gere código ${language} para: ${instruction}\n` +
    'O código será inserido na posição do cursor (marcada como <<CURSOR>> no contexto). ' +
    'Devolva apenas o trecho a inserir, em um único bloco de código, seguido de no máximo duas frases de explicação.'
  );
}

/** Monta o texto completo da mensagem com o código embutido. */
export function composeInline(prompt: string, context: ContextItem[]): string {
  const parts = [PREAMBLE, '', '## Tarefa', prompt];
  if (context.length) {
    parts.push('', '## Contexto');
    for (const c of context) {
      parts.push(`### ${c.label}`, fence(c.text, c.language));
    }
  }
  return parts.join('\n');
}

export function composeWithoutContext(prompt: string): string {
  return [PREAMBLE, '', '## Tarefa', prompt, '', 'O código de referência foi enviado como contexto adicional.'].join('\n');
}

export function fence(text: string, language = ''): string {
  // Usa uma cerca mais longa que qualquer sequência de crases presente no código.
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const f = '`'.repeat(longest + 1);
  return `${f}${language}\n${text}\n${f}`;
}
