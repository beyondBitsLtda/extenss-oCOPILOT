// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const $messages = /** @type {HTMLElement} */ (document.getElementById('messages'));
  const $form = /** @type {HTMLFormElement} */ (document.getElementById('composer'));
  const $input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
  const $send = /** @type {HTMLButtonElement} */ (document.getElementById('send'));
  const $include = /** @type {HTMLInputElement} */ (document.getElementById('includeContext'));
  const $provider = /** @type {HTMLElement} */ (document.getElementById('provider'));
  const $model = /** @type {HTMLSelectElement} */ (document.getElementById('model'));
  const $autoApply = /** @type {HTMLInputElement} */ (document.getElementById('autoApply'));
  const $usage = /** @type {HTMLElement} */ (document.getElementById('usage'));
  const $mode = /** @type {HTMLSelectElement} */ (document.getElementById('mode'));
  const $plan = /** @type {HTMLElement} */ (document.getElementById('plan'));
  const $images = /** @type {HTMLElement} */ (document.getElementById('images'));

  /** Imagens coladas aguardando envio: { name, mime, data (base64), url (miniatura) } */
  /** @type {{ name: string, mime: string, data: string, url: string }[]} */
  let pendingImages = [];
  const MAX_IMAGES = 4;
  const MAX_SIDE = 1600;
  const $attachments = /** @type {HTMLElement} */ (document.getElementById('attachments'));

  /** @type {{ el: HTMLElement, body: HTMLElement } | null} */
  let current = null;
  let busy = false;

  const state = vscode.getState() || {};
  if (typeof state.includeContext === 'boolean') {
    $include.checked = state.includeContext;
  }
  /** @param {Record<string, unknown>} patch */
  function saveState(patch) {
    Object.assign(state, patch);
    vscode.setState(state);
  }

  // ---------- Ícones (SVG em linha: o CSP do webview não carrega fontes de ícones) ----------

  /** @param {string} body */
  const svg = (body) =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  /** @type {Record<string, string>} */
  const ICONS = {
    history: svg('<path d="M2.7 9A5.5 5.5 0 1 0 4 4.2"/><path d="M2.6 2v2.6h2.6"/><path d="M8 5v3.2l2.2 1.4"/>'),
    plus: svg('<path d="M8 3v10M3 8h10"/>'),
    pencil: svg('<path d="M10.3 3.2l2.5 2.5M3 13l.6-3.1 7.7-7.7a1.2 1.2 0 0 1 1.7 0l.8.8a1.2 1.2 0 0 1 0 1.7L6.1 12.4z"/>'),
    archive: svg('<rect x="2" y="2.5" width="12" height="3.5" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/>'),
    unarchive: svg('<rect x="2" y="2.5" width="12" height="3.5" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M8 12V8.4M6.4 10L8 8.4 9.6 10"/>'),
    trash: svg('<path d="M2.5 4.5h11M6.2 4.5V3h3.6v1.5M4 4.5l.7 9h6.6l.7-9M6.8 7v4M9.2 7v4"/>'),
    search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>'),
    chevron: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  };
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = ICONS[el.getAttribute('data-icon') || ''] || '';
  });

  // ---------- Markdown mínimo (sem dependências, tudo escapado) ----------

  /** @param {string} s */
  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  }

  /** @param {string} s */
  function inline(s) {
    /** @type {string[]} */
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  }

  /** @param {string} code @param {string} lang */
  function codeBlock(code, lang) {
    return (
      '<div class="code"><div class="code-head">' +
      `<span class="lang">${esc(lang || 'código')}</span>` +
      '<button data-act="copy" title="Copiar para a área de transferência">Copiar</button>' +
      '<button data-act="insert" title="Inserir na posição do cursor">Inserir</button>' +
      '<button data-act="apply" class="apply" title="Ver diff e aplicar no trecho de origem">Aplicar</button>' +
      `</div><pre><code>${esc(code)}</code></pre></div>`
    );
  }

  /** Checklist de escopo (- [x] / - [ ]) como lista com marcadores. */
  /** @param {string[]} lines */
  function checklistBlock(lines) {
    const items = lines
      .map((l) => /^\s*[-*]?\s*\[([ xX✓✔])\]\s*(.+)$/.exec(l))
      .filter(Boolean)
      .map((m) => `<li class="${m && m[1] !== ' ' ? 'ok' : 'pend'}">${inline(m ? m[2] : '')}</li>`);
    return `<div class="tool">📋 Checklist do escopo</div><ul class="checklist">${items.join('')}</ul>`;
  }

  /** Plano em etapas como lista numerada. */
  /** @param {string[]} lines */
  function planBlock(lines) {
    const items = lines
      .map((l) => /^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(l))
      .filter(Boolean)
      .map((m) => `<li>${inline(m ? m[1] : '')}</li>`);
    return `<div class="tool">🧭 Plano proposto</div><ol class="plan-render">${items.join('')}</ol>`;
  }

  /** @param {string} row */
  function cells(row) {
    return row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  }

  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TOOL_RE = /^\s*[`*_]*@(ler|listar|buscar|gerar):\s*[`'"]?([^`\n]+?)[`'"]?[`*_]*\s*$/i;
  const TOOL_LABEL = { ler: '📂 Lendo', listar: '📁 Listando', buscar: '🔎 Buscando', gerar: '🧱 Gerando estrutura' };

  /** Bloco de edição proposto pelo agente: mostra como diff e oferece revisar/aplicar. */
  /** @param {string} kind @param {string} path @param {string} code */
  function editBlock(kind, path, code) {
    let mode = kind === 'criar' ? 'add' : '';
    const lines = code.split('\n').map((l) => {
      if (/^<{5,}\s*BUSCAR/.test(l)) {
        mode = 'del';
        return '<span class="marker">— trecho atual —</span>';
      }
      if (/^={5,}\s*$/.test(l) && mode === 'del') {
        mode = 'add';
        return '<span class="marker">— novo trecho —</span>';
      }
      if (/^>{5,}\s*SUBSTITUIR/.test(l)) {
        mode = '';
        return '<span class="marker">⋯</span>';
      }
      return `<span class="${mode}">${mode === 'del' ? '- ' : mode === 'add' ? '+ ' : '  '}${esc(l)}</span>`;
    });
    return (
      `<div class="code edit" data-lang="${esc(kind + ' ' + path)}"><div class="code-head">` +
      `<span class="lang">${kind === 'criar' ? '🆕 Criar' : '✏️ Editar'} ${esc(path)}</span>` +
      '<button data-act="applyEdits" class="apply" title="Abrir a pré-visualização e aplicar">Revisar e aplicar</button>' +
      `</div><pre><code>${lines.join('\n')}</code></pre><pre class="raw" hidden>${esc(code)}</pre></div>`
    );
  }

  /** @param {string} md @returns {string} */
  function render(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    /** @type {string[]} */
    let para = [];
    const flush = () => {
      if (para.length) {
        html += `<p>${inline(para.join(' '))}</p>`;
        para = [];
      }
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      const fence = /^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/.exec(line);
      if (fence) {
        flush();
        const close = new RegExp(`^\\s*\\${fence[1][0]}{${fence[1].length},}\\s*$`);
        /** @type {string[]} */
        const code = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) {
          code.push(lines[i++]);
        }
        i++;
        const editInfo = /^(editar|criar)$/i.test(fence[2]) ? /^\s*(?:`{3,}|~{3,})\s*(editar|criar)\s+(\S+)/i.exec(line) : null;
        if (/^checklist$/i.test(fence[2])) {
          html += checklistBlock(code);
        } else if (/^plano$/i.test(fence[2])) {
          html += planBlock(code);
        } else {
          html += editInfo ? editBlock(editInfo[1].toLowerCase(), editInfo[2], code.join('\n')) : codeBlock(code.join('\n'), fence[2]);
        }
        continue;
      }
      const tool = TOOL_RE.exec(line);
      if (tool) {
        flush();
        html += `<div class="tool">${TOOL_LABEL[/** @type {'ler'|'listar'|'buscar'|'gerar'} */ (tool[1].toLowerCase())]} <code>${esc(tool[2])}</code></div>`;
        i++;
        continue;
      }
      if (/^\s*$/.test(line)) {
        flush();
        i++;
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        const level = Math.min(heading[1].length + 1, 4);
        html += `<h${level}>${inline(heading[2])}</h${level}>`;
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        html += '<hr>';
        i++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        }
        html += `<blockquote>${render(quote.join('\n'))}</blockquote>`;
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
        flush();
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i++]);
        }
        const head = cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('');
        const body = rows
          .slice(2)
          .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('');
        html += `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
        continue;
      }
      const li = LIST_RE.exec(line);
      if (li) {
        flush();
        const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
        /** @type {string[]} */
        const items = [];
        while (i < lines.length) {
          const m = LIST_RE.exec(lines[i]);
          if (m) {
            items.push(m[3]);
            i++;
          } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(`{3,}|~{3,})/.test(lines[i])) {
            items[items.length - 1] += ' ' + lines[i++].trim();
          } else {
            break;
          }
        }
        html += `<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`;
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return html;
  }

  // ---------- Mensagens ----------

  const WHO = { user: 'Você', assistant: '', error: 'Erro', note: '' };

  /**
   * @param {'user'|'assistant'|'error'|'note'} role
   * @param {string} text
   * @param {string} [contextLabel]
   */
  function addTurn(role, text, contextLabel) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    const body = document.createElement('div');
    body.className = 'body';
    if (role === 'assistant') {
      body.innerHTML = render(text);
    } else {
      body.textContent = text;
    }
    if (role === 'user' || role === 'error') {
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = WHO[role];
      el.append(who);
    }
    el.append(body);
    if (contextLabel) {
      const ctx = document.createElement('div');
      ctx.className = 'ctx-label';
      ctx.textContent = `📎 ${contextLabel}`;
      el.append(ctx);
    }
    $messages.append(el);
    document.body.classList.add('has-messages');
    scrollToBottom(true);
    return { el, body };
  }

  /** Botões da ponte manual com o Copilot web, exibidos enquanto a resposta não chega. */
  function manualBar() {
    const bar = document.createElement('div');
    bar.className = 'manual-bar';
    /** @type {[string, string, string][]} */
    const buttons = [
      ['paste', 'Colar resposta', 'primary'],
      ['copyPrompt', 'Copiar pedido de novo', ''],
      ['open', 'Abrir Copilot', ''],
    ];
    for (const [action, label, cls] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = cls;
      b.addEventListener('click', () => vscode.postMessage({ type: 'manual', action }));
      bar.append(b);
    }
    return bar;
  }

  /** @param {boolean} [force] */
  function scrollToBottom(force) {
    const nearBottom = $messages.scrollHeight - $messages.scrollTop - $messages.clientHeight < 80;
    if (force || nearBottom) {
      $messages.scrollTop = $messages.scrollHeight;
    }
  }

  /** @param {boolean} value */
  function setBusy(value) {
    busy = value;
    $send.textContent = value ? 'Parar' : 'Enviar';
    $send.classList.toggle('stop', value);
  }

  window.addEventListener('message', (event) => {
    const m = event.data;
    switch (m.type) {
      case 'conversation':
        setConversation(m.id, m.title);
        if (historyOpen) {
          renderHistory();
        }
        break;
      case 'openHistory':
        openHistory();
        break;
      case 'history': {
        const first = !historyLoaded;
        historyItems = m.items || [];
        activeConversation = m.activeId || '';
        historyLoaded = true;
        if (historyOpen) {
          renderHistory(first);
        }
        break;
      }
      case 'references':
        renderReferences(m.items || []);
        break;
      case 'restore':
        $messages.innerHTML = '';
        current = null;
        document.body.classList.remove('has-messages');
        for (const t of m.turns) {
          addTurn(t.role, t.text, t.contextLabel);
        }
        $provider.textContent = m.provider;
        setBusy(false);
        break;
      case 'user':
        addTurn('user', m.text, m.contextLabel);
        break;
      case 'note':
        addTurn('note', m.text);
        break;
      case 'provider':
        $provider.textContent = m.provider;
        break;
      case 'models': {
        $model.innerHTML = '';
        for (const label of m.items) {
          const opt = document.createElement('option');
          opt.value = label;
          opt.textContent = label;
          opt.selected = label === m.active;
          $model.append(opt);
        }
        const add = document.createElement('option');
        add.value = '__add__';
        add.textContent = '+ Adicionar modelo…';
        $model.append(add);
        $model.hidden = !m.enabled;
        $provider.hidden = !!m.enabled;
        $provider.textContent = m.provider;
        break;
      }
      case 'settings':
        $autoApply.checked = !!m.autoApply;
        if (m.mode) {
          $mode.value = m.mode;
          document.body.dataset.mode = m.mode;
        }
        break;
      case 'plan':
        renderPlan(m.steps || [], !!m.busy);
        break;
      case 'specActions': {
        const last = [...$messages.querySelectorAll('.msg.assistant')].pop();
        if (last && !last.querySelector('.spec-bar')) {
          const bar = document.createElement('div');
          bar.className = 'manual-bar spec-bar';
          bar.append(
            actionButton('💾 Salvar especificação', '', () => vscode.postMessage({ type: 'specAction', action: 'save' })),
            actionButton('🧭 Gerar plano de desenvolvimento', 'primary', () => vscode.postMessage({ type: 'specAction', action: 'plan' }))
          );
          last.append(bar);
          scrollToBottom(true);
        }
        break;
      }
      case 'usage':
        $usage.textContent = m.text;
        $usage.classList.toggle('over', !!m.over);
        break;
      case 'applied': {
        const turn = addTurn('note', m.text);
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'undo';
        undo.dataset.undo = m.id;
        undo.textContent = 'Desfazer';
        undo.addEventListener('click', () => vscode.postMessage({ type: 'undo', id: m.id }));
        turn.el.append(undo);
        break;
      }
      case 'undone': {
        const btn = /** @type {HTMLButtonElement | null} */ (document.querySelector(`button[data-undo="${m.id}"]`));
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Desfeito';
        }
        break;
      }
      case 'attachments':
        $attachments.innerHTML = '';
        m.items.forEach((/** @type {string} */ name, /** @type {number} */ index) => {
          const chip = document.createElement('span');
          chip.className = 'attachment';
          chip.textContent = `📄 ${name}`;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.title = 'Remover anexo';
          remove.textContent = '×';
          remove.addEventListener('click', () => vscode.postMessage({ type: 'removeAttachment', index }));
          chip.append(remove);
          $attachments.append(chip);
        });
        break;
      case 'assistantStart':
        current = addTurn('assistant', '');
        current.body.classList.add('typing');
        if (m.manual) {
          current.el.append(manualBar());
        }
        setBusy(true);
        break;
      case 'assistantUpdate':
        if (current) {
          current.body.innerHTML = render(m.text);
          scrollToBottom();
        }
        break;
      case 'assistantDone':
        if (current) {
          current.body.innerHTML = render(m.text);
          current.body.classList.remove('typing');
          current.el.querySelector('.manual-bar')?.remove();
          const edits = current.body.querySelectorAll('.code.edit').length;
          if (edits > 1) {
            const bar = document.createElement('div');
            bar.className = 'manual-bar';
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'primary';
            all.dataset.act = 'applyAllEdits';
            all.textContent = `Revisar e aplicar todas (${edits})`;
            bar.append(all);
            current.el.append(bar);
          }
          scrollToBottom();
        }
        current = null;
        setBusy(false);
        break;
      case 'error':
        if (current) {
          current.el.remove();
          current = null;
        }
        addTurn('error', m.text);
        setBusy(false);
        break;
    }
  });

  // ---------- Interações ----------

  $messages.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button[data-act]');
    if (!button) {
      return;
    }
    const act = button.getAttribute('data-act');
    if (act === 'applyEdits' || act === 'applyAllEdits') {
      const scope = act === 'applyEdits' ? [button.closest('.code')] : [...(button.closest('.msg')?.querySelectorAll('.code.edit') ?? [])];
      const blocks = scope.filter(Boolean).map((el) => ({
        lang: /** @type {HTMLElement} */ (el).dataset.lang ?? '',
        code: /** @type {HTMLElement} */ (el).querySelector('pre.raw')?.textContent ?? '',
      }));
      vscode.postMessage({ type: 'applyEdits', blocks });
      return;
    }
    const code = button.closest('.code')?.querySelector('code')?.textContent ?? '';
    vscode.postMessage({ type: act, code });
  });

  document.querySelectorAll('[data-command]').forEach((el) =>
    el.addEventListener('click', () => {
      const command = el.getAttribute('data-command');
      if (command === 'delpCopilot.history') {
        openHistory();
      } else {
        vscode.postMessage({ type: 'command', command });
      }
    })
  );

  // ---------- Histórico (funções puras) ----------

  /** Tempo desde a última atividade, curto como no Claude Code ("agora", "5 min", "3 h", "2 d"). */
  /** @param {string} iso @param {number} [now] */
  function timeAgo(iso, now = Date.now()) {
    const min = Math.floor((now - Date.parse(iso)) / 60000);
    const h = Math.floor(min / 60);
    const d = Math.floor(h / 24);
    const mo = Math.floor(d / 30);
    const y = Math.floor(d / 365);
    if (y > 0) {
      return `${y} ano${y > 1 ? 's' : ''}`;
    }
    if (mo > 0) {
      return `${mo} ${mo > 1 ? 'meses' : 'mês'}`;
    }
    if (d > 0) {
      return `${d} d`;
    }
    if (h > 0) {
      return `${h} h`;
    }
    return min > 0 ? `${min} min` : 'agora';
  }

  /** Título escapado, com o trecho buscado destacado. */
  /** @param {string} text @param {string} query */
  function highlightMatch(text, query) {
    const q = query.trim().toLowerCase();
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) {
      return esc(text);
    }
    return `${esc(text.slice(0, i))}<mark class="hist-hl">${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  }

  /**
   * Divide a lista: ativas e arquivadas que casam com a busca. As arquivadas aparecem com a seção
   * aberta ou durante uma busca.
   * @template {{ title: string, archived: boolean }} T
   * @param {T[]} items @param {string} query @param {boolean} archivedOpen
   */
  function historyRows(items, query, archivedOpen) {
    const q = query.trim().toLowerCase();
    /** @param {T} c */
    const match = (c) => !q || c.title.toLowerCase().includes(q);
    const live = items.filter((c) => !c.archived && match(c));
    const archived = items.filter((c) => c.archived && match(c));
    const showArchived = !!q || archivedOpen;
    return { live, archived, showArchived, rows: [...live, ...(showArchived ? archived : [])] };
  }

  // ---------- Histórico (lista suspensa, como no Claude Code) ----------

  const $convTitle = /** @type {HTMLButtonElement} */ (document.getElementById('convTitle'));
  const $convTitleText = /** @type {HTMLElement} */ (document.getElementById('convTitleText'));
  const $historyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('historyBtn'));

  /** @typedef {{ id: string, title: string, updated: string, archived: boolean, detail: string }} HistoryItem */
  /** @type {HistoryItem[]} */
  let historyItems = [];
  /** @type {HistoryItem[]} */
  let visibleRows = [];
  let historyLoaded = false;
  let historyOpen = false;
  let historyIndex = 0;
  let activeConversation = '';
  let renamingId = '';
  let archivedCollapsed = state.archivedCollapsed !== false;

  const $histLayer = document.createElement('div');
  $histLayer.hidden = true;
  $histLayer.innerHTML =
    '<div class="hist-overlay"></div>' +
    '<div class="hist-dropdown" role="dialog" aria-label="Conversas anteriores" tabindex="-1">' +
    `<div class="hist-search">${ICONS.search}<input type="text" placeholder="Buscar conversas…" aria-label="Buscar conversas" aria-controls="hist-list"></div>` +
    '<div class="hist-content" id="hist-list" role="listbox" aria-label="Conversas"></div>' +
    '</div>';
  document.body.append($histLayer);
  const $histDropdown = /** @type {HTMLElement} */ ($histLayer.querySelector('.hist-dropdown'));
  const $histSearch = /** @type {HTMLInputElement} */ ($histLayer.querySelector('input'));
  const $histList = /** @type {HTMLElement} */ ($histLayer.querySelector('.hist-content'));

  /** @param {string | undefined} id @param {string | undefined} title */
  function setConversation(id, title) {
    activeConversation = id || '';
    $convTitleText.textContent = title || 'Nova conversa';
    $convTitle.title = id ? `${title} — clique para renomear` : 'Nova conversa';
    $convTitle.disabled = !id;
  }

  function openHistory() {
    if (historyOpen) {
      $histSearch.focus();
      return;
    }
    historyOpen = true;
    renamingId = '';
    $histSearch.value = '';
    $histLayer.hidden = false;
    $historyBtn.setAttribute('aria-expanded', 'true');
    positionHistory();
    renderHistory(true);
    $histSearch.focus();
    vscode.postMessage({ type: 'listHistory' });
  }

  function closeHistory() {
    historyOpen = false;
    renamingId = '';
    $histLayer.hidden = true;
    $historyBtn.setAttribute('aria-expanded', 'false');
  }

  /** Abaixo do botão de histórico, alinhada ao lado mais próximo da borda. */
  function positionHistory() {
    const r = $historyBtn.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    $histDropdown.style.top = `${r.bottom + 4}px`;
    if (r.left + r.right < width) {
      $histDropdown.style.left = `${Math.max(16, r.left)}px`;
      $histDropdown.style.right = '';
    } else {
      $histDropdown.style.right = `${Math.max(16, width - r.right)}px`;
      $histDropdown.style.left = '';
    }
  }

  /** @param {string} cls @param {string} text */
  function histMessage(cls, text) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  /** @param {string} icon @param {string} title @param {() => void} onSelect */
  function histAction(icon, title, onSelect) {
    const b = document.createElement('span');
    b.className = 'hist-action';
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ICONS[icon];
    /** @param {Event} e */
    const run = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
    };
    b.addEventListener('click', run);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        run(e);
      }
    });
    return b;
  }

  /** @param {boolean} [focusActive] destaca a conversa atual (ao abrir a lista) */
  function renderHistory(focusActive) {
    const { live, archived, showArchived, rows } = historyRows(historyItems, $histSearch.value, !archivedCollapsed);
    visibleRows = rows;
    if (focusActive) {
      historyIndex = Math.max(0, rows.findIndex((c) => c.id === activeConversation));
    }
    historyIndex = Math.min(historyIndex, Math.max(0, rows.length - 1));
    $histList.innerHTML = '';
    if (!historyLoaded) {
      $histList.append(histMessage('hist-null', 'Carregando conversas…'));
      return;
    }
    if (!historyItems.length) {
      $histList.append(histMessage('hist-null', 'Nenhuma conversa ainda'));
      return;
    }
    if (!live.length && !archived.length) {
      $histList.append(histMessage('hist-empty', 'Nenhuma conversa encontrada'));
      return;
    }
    live.forEach((c) => $histList.append(historyRow(c)));
    if (archived.length) {
      $histList.append(archivedHeader(archived, showArchived));
      if (showArchived) {
        archived.forEach((c) => $histList.append(historyRow(c)));
      }
    }
    markHighlighted(!!focusActive);
  }

  /** @param {HistoryItem} c */
  function historyRow(c) {
    const index = visibleRows.indexOf(c);
    const row = document.createElement('div');
    row.className = `hist-item${c.id === activeConversation ? ' active' : ''}`;
    row.setAttribute('role', 'option');
    row.dataset.index = String(index);
    row.title = `${c.title}\n${c.detail} · ${new Date(c.updated).toLocaleString('pt-BR')}`;
    row.addEventListener('mousemove', () => {
      if (historyIndex !== index) {
        historyIndex = index;
        markHighlighted(false);
      }
    });
    if (c.id === renamingId) {
      row.append(renameInput(c));
      return row;
    }
    const name = document.createElement('span');
    name.className = 'hist-name';
    name.innerHTML = highlightMatch(c.title, $histSearch.value);
    const time = document.createElement('span');
    time.className = 'hist-time';
    time.textContent = timeAgo(c.updated);
    const actions = document.createElement('span');
    actions.className = 'hist-actions';
    actions.append(histAction('pencil', 'Renomear conversa', () => startRename(c.id)));
    if (c.archived) {
      actions.append(
        histAction('unarchive', 'Desarquivar conversa', () => archive([c], false)),
        histAction('trash', 'Excluir conversa', () => vscode.postMessage({ type: 'deleteConversation', id: c.id }))
      );
    } else {
      actions.append(histAction('archive', 'Arquivar conversa', () => archive([c], true)));
    }
    const meta = document.createElement('span');
    meta.className = 'hist-meta';
    meta.append(time, actions);
    row.append(name, meta);
    row.addEventListener('click', () => openConversation(c));
    return row;
  }

  /** Cabeçalho recolhível da seção de arquivadas, com contador e "desarquivar todas". */
  /** @param {HistoryItem[]} archived @param {boolean} open */
  function archivedHeader(archived, open) {
    const searching = !!$histSearch.value.trim();
    const head = document.createElement('div');
    head.className = `hist-group${open ? ' open' : ''}`;
    head.innerHTML = `<span class="hist-chev">${ICONS.chevron}</span><span class="hist-group-name">Conversas arquivadas</span>`;
    if (!searching) {
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.title = open ? 'Recolher conversas arquivadas' : 'Expandir conversas arquivadas';
      head.append(
        histAction('unarchive', archived.length === 1 ? 'Desarquivar conversa' : `Desarquivar todas as ${archived.length} conversas`, () =>
          archive(archived, false)
        )
      );
      const toggle = () => {
        archivedCollapsed = !archivedCollapsed;
        saveState({ archivedCollapsed });
        renderHistory();
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      });
    }
    const count = document.createElement('span');
    count.className = 'hist-count';
    count.textContent = String(archived.length);
    head.append(count);
    return head;
  }

  /** @param {boolean} scroll */
  function markHighlighted(scroll) {
    $histList.querySelectorAll('.hist-item').forEach((el) => {
      const on = Number(/** @type {HTMLElement} */ (el).dataset.index) === historyIndex;
      el.toggleAttribute('data-highlighted', on);
      el.setAttribute('aria-selected', String(on));
      if (on && scroll) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /** @param {HistoryItem} c */
  function openConversation(c) {
    if (renamingId) {
      return;
    }
    closeHistory();
    if (c.id !== activeConversation) {
      vscode.postMessage({ type: 'openConversation', id: c.id });
    }
    $input.focus();
  }

  /** @param {HistoryItem[]} list @param {boolean} value */
  function archive(list, value) {
    list.forEach((c) => {
      c.archived = value;
    });
    vscode.postMessage({ type: 'archiveConversations', ids: list.map((c) => c.id), archived: value });
    renderHistory();
    $histSearch.focus();
  }

  /** @param {string} id */
  function startRename(id) {
    renamingId = id;
    renderHistory();
  }

  /** Campo de renomear no lugar do título: Enter grava, Esc cancela, sair do campo grava. */
  /** @param {HistoryItem} c */
  function renameInput(c) {
    const input = document.createElement('input');
    input.className = 'hist-rename';
    input.value = c.title;
    input.setAttribute('aria-label', 'Novo nome da conversa');
    /** @param {boolean} commit */
    const finish = (commit) => {
      if (renamingId !== c.id) {
        return;
      }
      renamingId = '';
      const title = input.value.replace(/\s+/g, ' ').trim();
      if (commit && title && title !== c.title) {
        c.title = title;
        vscode.postMessage({ type: 'renameConversation', id: c.id, title });
      }
      renderHistory();
      $histSearch.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // não navega na lista nem abre a conversa
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    return input;
  }

  $histSearch.addEventListener('input', () => {
    historyIndex = 0;
    renderHistory();
  });

  $histDropdown.addEventListener('keydown', (e) => {
    if (renamingId || e.isComposing) {
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (visibleRows.length) {
          historyIndex = Math.min(Math.max(historyIndex + (e.key === 'ArrowDown' ? 1 : -1), 0), visibleRows.length - 1);
          markHighlighted(true);
        }
        break;
      case 'Enter': {
        if (e.target !== $histSearch && e.target !== $histDropdown) {
          break;
        }
        e.preventDefault();
        const c = visibleRows[historyIndex];
        if (c && !e.repeat) {
          openConversation(c);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if ($histSearch.value) {
          $histSearch.value = '';
          historyIndex = 0;
          renderHistory();
        } else {
          closeHistory();
          $historyBtn.focus();
        }
        break;
    }
  });

  $histLayer.querySelector('.hist-overlay')?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    closeHistory();
  });
  window.addEventListener('resize', () => historyOpen && positionHistory());
  $historyBtn.addEventListener('click', () => (historyOpen ? closeHistory() : openHistory()));
  document.getElementById('newChatBtn')?.addEventListener('click', () => {
    closeHistory();
    vscode.postMessage({ type: 'newChat' });
    $input.focus();
  });

  // Título da conversa no cabeçalho: clique para renomear.
  $convTitle.addEventListener('click', () => {
    if (!activeConversation) {
      return;
    }
    const input = document.createElement('input');
    input.className = 'topbar__rename';
    input.value = $convTitleText.textContent || '';
    input.setAttribute('aria-label', 'Nome da conversa');
    $convTitle.hidden = true;
    $convTitle.after(input);
    input.focus();
    input.select();
    let done = false;
    /** @param {boolean} commit */
    const finish = (commit) => {
      if (done) {
        return;
      }
      done = true;
      const title = input.value.replace(/\s+/g, ' ').trim();
      input.remove();
      $convTitle.hidden = false;
      if (commit && title && title !== $convTitleText.textContent) {
        $convTitleText.textContent = title;
        vscode.postMessage({ type: 'renameConversation', id: activeConversation, title });
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
        $input.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
        $convTitle.focus();
      }
    });
    input.addEventListener('blur', () => finish(true));
  });

  // ---------- Referências somente leitura (caminhos citados na mensagem) ----------

  const $references = /** @type {HTMLElement} */ (document.getElementById('references'));

  /** @param {{ path: string, name: string, isFile: boolean }[]} items */
  function renderReferences(items) {
    $references.innerHTML = '';
    for (const r of items) {
      const chip = document.createElement('span');
      chip.className = 'attachment reference';
      chip.title = `${r.path}\nReferência somente leitura: o agente consulta, mas não altera.`;
      chip.innerHTML = ICONS.lock;
      const name = document.createElement('span');
      name.textContent = r.name || r.path;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Remover referência';
      remove.textContent = '×';
      remove.addEventListener('click', () => vscode.postMessage({ type: 'removeReference', path: r.path }));
      chip.append(name, remove);
      $references.append(chip);
    }
  }

  $form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) {
      vscode.postMessage({ type: 'stop' });
      return;
    }
    const text = $input.value.trim();
    if (!text && !pendingImages.length) {
      return;
    }
    vscode.postMessage({
      type: 'send',
      text,
      includeContext: $include.checked,
      images: pendingImages.map((i) => ({ name: i.name, mime: i.mime, data: i.data })),
    });
    $input.value = '';
    pendingImages = [];
    renderImages();
  });

  // ---------- Imagens (Ctrl+V ou arrastar) ----------

  /** Reduz a imagem (lado maior até MAX_SIDE) e converte para base64. */
  /** @param {Blob} blob @param {string} name */
  function addImage(blob, name) {
    if (pendingImages.length >= MAX_IMAGES) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG preserva prints de tela; se ficar grande, JPEG reduz bastante.
        let url = canvas.toDataURL('image/png');
        let mime = 'image/png';
        if (url.length > 1400000) {
          url = canvas.toDataURL('image/jpeg', 0.85);
          mime = 'image/jpeg';
        }
        pendingImages.push({ name: name || `imagem-${pendingImages.length + 1}.png`, mime, data: url.split(',')[1], url });
        renderImages();
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(blob);
  }

  function renderImages() {
    $images.innerHTML = '';
    pendingImages.forEach((im, index) => {
      const box = document.createElement('span');
      box.className = 'thumb';
      const pic = document.createElement('img');
      pic.src = im.url;
      pic.alt = im.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Remover imagem';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        pendingImages.splice(index, 1);
        renderImages();
      });
      box.append(pic, remove);
      $images.append(box);
    });
  }

  $input.addEventListener('paste', (event) => {
    const items = event.clipboardData ? [...event.clipboardData.items] : [];
    const files = items.filter((it) => it.kind === 'file' && it.type.indexOf('image/') === 0);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    files.forEach((it) => {
      const f = it.getAsFile();
      if (f) {
        addImage(f, f.name);
      }
    });
  });

  $form.addEventListener('dragover', (event) => event.preventDefault());
  $form.addEventListener('drop', (event) => {
    const files = event.dataTransfer ? [...event.dataTransfer.files].filter((f) => f.type.indexOf('image/') === 0) : [];
    if (files.length) {
      event.preventDefault();
      files.forEach((f) => addImage(f, f.name));
    }
  });

  // ---------- Plano (modo Desenvolvimento planejado) ----------

  const STATUS = { pendente: '○', executando: '◐', concluida: '●', falhou: '✕' };

  /** @param {string} label @param {string} cls @param {() => void} onClick */
  function actionButton(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) {
      b.className = cls;
    }
    b.addEventListener('click', onClick);
    return b;
  }

  /** @param {{ title: string, detail: string, status: 'pendente'|'executando'|'concluida'|'falhou' }[]} steps @param {boolean} running */
  function renderPlan(steps, running) {
    $plan.innerHTML = '';
    $plan.hidden = !steps.length;
    if (!steps.length) {
      return;
    }
    const done = steps.filter((s) => s.status === 'concluida').length;
    const head = document.createElement('div');
    head.className = 'plan__head';
    const title = document.createElement('strong');
    title.textContent = `🧭 Plano · ${done}/${steps.length} etapas`;
    const bar = document.createElement('div');
    bar.className = 'plan__progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.round((done / steps.length) * 100)}%`;
    bar.append(fill);
    head.append(title, bar);
    const list = document.createElement('ol');
    list.className = 'plan__list';
    steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = `plan__step plan__step--${s.status}`;
      const mark = document.createElement('span');
      mark.className = 'plan__mark';
      mark.textContent = STATUS[s.status] || '○';
      const text = document.createElement('span');
      text.className = 'plan__text';
      text.textContent = s.title;
      if (s.detail) {
        text.title = s.detail;
      }
      li.append(mark, text);
      if (!running && s.status !== 'concluida') {
        li.append(
          actionButton(s.status === 'falhou' ? 'Repetir' : 'Executar', 'plan__run', () =>
            vscode.postMessage({ type: 'planAction', action: 'step', index: i })
          )
        );
      }
      list.append(li);
    });
    const actions = document.createElement('div');
    actions.className = 'plan__actions';
    if (!running && done < steps.length) {
      actions.append(actionButton('▶ Executar todas', 'primary', () => vscode.postMessage({ type: 'planAction', action: 'all' })));
    }
    if (!running) {
      actions.append(actionButton('Descartar plano', '', () => vscode.postMessage({ type: 'planAction', action: 'discard' })));
    }
    $plan.append(head, list, actions);
  }

  $input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $form.requestSubmit();
    }
  });

  document.getElementById('attach')?.addEventListener('click', () => vscode.postMessage({ type: 'attach' }));

  $include.addEventListener('change', () => saveState({ includeContext: $include.checked }));
  $model.addEventListener('change', () => vscode.postMessage({ type: 'selectModel', label: $model.value }));
  $autoApply.addEventListener('change', () => vscode.postMessage({ type: 'setAutoApply', value: $autoApply.checked }));
  $usage.addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'command', command: 'delpCopilot.showUsage' });
  });

  $mode.addEventListener('change', () => {
    document.body.dataset.mode = $mode.value;
    vscode.postMessage({ type: 'setMode', mode: $mode.value });
  });

  // ---------- Abertura animada ----------
  const $splash = document.getElementById('splash');
  if ($splash) {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      $splash.classList.add('splash--out');
      setTimeout(() => $splash.remove(), 450);
    }, reduced ? 150 : 1700);
  }

  vscode.postMessage({ type: 'ready' });
  $input.focus();
})();
