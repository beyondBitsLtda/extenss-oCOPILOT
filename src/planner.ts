/**
 * Leitura dos blocos estruturados que o modelo devolve:
 * - ```plano      etapas numeradas do modo "Desenvolvimento planejado";
 * - ```checklist  itens do escopo pedido, marcados [x] (entregue) ou [ ] (pendente);
 * e detecção de resposta cortada no meio de um bloco de código.
 */

export type StepStatus = 'pendente' | 'executando' | 'concluida' | 'falhou';

export interface PlanStep {
  title: string;
  detail: string;
  status: StepStatus;
}

export interface Checklist {
  done: string[];
  pending: string[];
}

interface Fence {
  info: string;
  body: string[];
  closed: boolean;
}

/** Percorre os blocos de código cercados (``` ou ~~~), incluindo o último sem fechamento. */
function fences(text: string): Fence[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      continue;
    }
    const close = new RegExp(`^\\s*\\${open[1][0]}{${open[1].length},}\\s*$`);
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) {
      body.push(lines[j++]);
    }
    out.push({ info: open[2].trim(), body, closed: j < lines.length });
    i = j;
  }
  return out;
}

/** Linha de abertura do bloco que ficou sem fechamento (resposta cortada), se houver. */
export function truncatedFence(reply: string): string | undefined {
  const last = fences(reply).pop();
  return last && !last.closed ? `\`\`\`${last.info}`.trim() : undefined;
}

/** Etapas do bloco ```plano ("1. Titulo — detalhe"). */
export function parsePlan(reply: string): PlanStep[] | undefined {
  const block = fences(reply).find((f) => /^plano\b/i.test(f.info) && f.closed);
  if (!block) {
    return undefined;
  }
  const steps: PlanStep[] = [];
  for (const raw of block.body) {
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(raw);
    if (m) {
      const [title, ...rest] = m[1].split(/\s+[—–-]\s+/);
      steps.push({ title: title.replace(/\*\*/g, '').trim(), detail: rest.join(' — ').trim(), status: 'pendente' });
    } else if (steps.length && raw.trim()) {
      // continuação da etapa anterior
      const last = steps[steps.length - 1];
      last.detail = `${last.detail} ${raw.trim()}`.trim();
    }
  }
  return steps.length ? steps : undefined;
}

/** Itens do bloco ```checklist (- [x] entregue / - [ ] pendente). */
export function parseChecklist(reply: string): Checklist | undefined {
  const block = [...fences(reply)].reverse().find((f) => /^checklist\b/i.test(f.info) && f.closed);
  if (!block) {
    return undefined;
  }
  const list: Checklist = { done: [], pending: [] };
  for (const raw of block.body) {
    const m = /^\s*[-*]?\s*\[([ xX✓✔])\]\s*(.+)$/.exec(raw);
    if (m) {
      (m[1] === ' ' ? list.pending : list.done).push(m[2].trim());
    }
  }
  return list.done.length || list.pending.length ? list : undefined;
}

export function planToText(steps: PlanStep[]): string {
  return steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ''}`).join('\n');
}
