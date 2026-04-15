(() => {
  const vscode = acquireVsCodeApi();
  const editorHost = document.getElementById('editorHost');
  const sourceHost = document.getElementById('sourceHost');
  const frontmatterPanel = document.getElementById('frontmatterPanel');
  const frontmatterText = document.getElementById('frontmatterText');
  const docPathChip = document.getElementById('docPathChip');
  const imageInput = document.getElementById('imageInput');

  let currentMarkdown = '';
  let frontmatter = '';
  let bodyMarkdown = '';
  let isSourceMode = false;
  let suspendSave = false;

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*'
  });
  turndownService.use(window.turndownPluginGfm.gfm);

  turndownService.addRule('mermaidCard', {
    filter(node) {
      return node.nodeType === Node.ELEMENT_NODE && node.classList?.contains('mermaid-card');
    },
    replacement(_content, node) {
      const source = node.querySelector('.mermaid-source')?.textContent || node.getAttribute('data-mermaid-source') || 'graph TD\n  A[Start] --> B[Finish]';
      const normalizedSource = source.replace(/&#10;/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      return `\n\n\`\`\`mermaid\n${normalizedSource}\n\`\`\`\n\n`;
    }
  });

  turndownService.addRule('preserveHr', {
    filter: 'hr',
    replacement() {
      return '\n\n---\n\n';
    }
  });

  turndownService.addRule('inlineCodeClass', {
    filter(node) {
      return node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'CODE' && node.classList?.contains('inline-code');
    },
    replacement(content) {
      return '`' + content + '`';
    }
  });

  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      code(token) {
        const text = token.text || '';
        const lang = token.lang || '';
        if (lang.trim().toLowerCase() === 'mermaid') {
          const escaped = escapeHtml(text);
          return `
            <div class="mermaid-card" contenteditable="false" data-mermaid-source="${escapeAttribute(text)}">
              <div class="mermaid-toolbar">
                <div class="mermaid-title">Mermaid Diagram</div>
                <button class="rerender-mermaid-btn" type="button">Render</button>
              </div>
              <textarea class="mermaid-source" spellcheck="false">${escaped}</textarea>
              <div class="mermaid-render"></div>
            </div>
          `;
        }
        return `<pre><code class="language-${escapeAttribute(lang)}">${escapeHtml(text)}</code></pre>`;
      },
      image(token) {
        const href = token.href || '';
        const text = token.text || '';
        const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
        return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${title} data-md-src="${escapeAttribute(href)}" />`;
      }
    }
  });

  function splitFrontmatter(markdown) {
    const match = /^---\n([\s\S]*?)\n---\n?/m.exec(markdown);
    if (match && match.index === 0) {
      return {
        frontmatter: `---\n${match[1]}\n---`,
        body: markdown.slice(match[0].length)
      };
    }
    return { frontmatter: '', body: markdown };
  }

  function renderMarkdown(markdown) {
    const parts = splitFrontmatter(markdown);
    frontmatter = parts.frontmatter;
    bodyMarkdown = parts.body;

    frontmatterText.value = frontmatter;
    frontmatterPanel.hidden = !frontmatter;
    sourceHost.value = bodyMarkdown;

    editorHost.innerHTML = marked.parse(bodyMarkdown);
    editorHost.querySelectorAll('.mermaid-card').forEach((card) => {
      const textarea = card.querySelector('.mermaid-source');
      const data = card.getAttribute('data-mermaid-source');
      if (textarea && data) {
        textarea.value = data.replace(/&#10;/g, '\n');
      }
    });
    normalizeEditableMarkup();
    resolveImages();
    renderAllMermaid();
  }

  function normalizeEditableMarkup() {
    editorHost.querySelectorAll('pre > code').forEach((code) => {
      code.parentElement.setAttribute('contenteditable', 'true');
    });

    editorHost.querySelectorAll('code').forEach((code) => {
      if (code.parentElement?.tagName !== 'PRE') {
        code.classList.add('inline-code');
      }
    });

    editorHost.querySelectorAll('a').forEach((link) => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });
  }

  function resolveImages() {
    const srcs = Array.from(editorHost.querySelectorAll('img[data-md-src]'))
      .map((img) => img.getAttribute('data-md-src'))
      .filter(Boolean);

    if (srcs.length) {
      vscode.postMessage({ type: 'resolveImageSrcs', srcs });
    }
  }

  async function renderAllMermaid() {
    if (!window.mermaid) {
      return;
    }

    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

    const cards = Array.from(editorHost.querySelectorAll('.mermaid-card'));
    for (const [index, card] of cards.entries()) {
      await renderMermaidCard(card, index);
    }
  }

  async function renderMermaidCard(card, index) {
    const textarea = card.querySelector('.mermaid-source');
    const renderHost = card.querySelector('.mermaid-render');
    if (!textarea || !renderHost) {
      return;
    }

    const source = textarea.value || 'graph TD\n  A[Start] --> B[Finish]';
    card.setAttribute('data-mermaid-source', source);

    if (!textarea.hasAttribute('data-listener-added')) {
      textarea.addEventListener('input', () => {
        card.setAttribute('data-mermaid-source', textarea.value);
      });
      textarea.setAttribute('data-listener-added', 'true');
    }

    try {
      const result = await window.mermaid.render(`mermaid-${Date.now()}-${index}`, source);
      renderHost.innerHTML = result.svg;
    } catch (error) {
      renderHost.innerHTML = `<pre>${escapeHtml(String(error))}</pre>`;
    }
  }

  function serializeDocument() {
    if (isSourceMode) {
      bodyMarkdown = sourceHost.value;
      return joinFrontmatter(frontmatter, bodyMarkdown);
    }

    const cloned = editorHost.cloneNode(true);
    cloned.querySelectorAll('button').forEach((el) => el.remove());
    cloned.querySelectorAll('.mermaid-card').forEach((card) => {
      const textarea = card.querySelector('.mermaid-source');
      const source = textarea?.value || card.getAttribute('data-mermaid-source') || '';
      card.setAttribute('data-mermaid-source', escapeAttribute(source));
      const clonedTextarea = cloned.querySelector('.mermaid-source');
      if (clonedTextarea) {
        clonedTextarea.textContent = source;
      }
    });

    const markdown = turndownService.turndown(cloned.innerHTML)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    bodyMarkdown = markdown ? `${markdown}\n` : '';
    return joinFrontmatter(frontmatter, bodyMarkdown);
  }

  function joinFrontmatter(front, body) {
    if (front) {
      return `${front}\n\n${body}`.replace(/\n{3,}/g, '\n\n');
    }
    return body;
  }

  let saveTimer;
  function scheduleSave() {
    if (suspendSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const next = serializeDocument();
      if (next !== currentMarkdown) {
        currentMarkdown = next;
        vscode.postMessage({ type: 'updateText', text: next });
      }
    }, 250);
  }

  function exec(command, value = null) {
    editorHost.focus();
    document.execCommand(command, false, value);
    scheduleSave();
  }

  function formatBlock(tag) {
    editorHost.focus();
    document.execCommand('formatBlock', false, tag);
    scheduleSave();
  }

  function insertTable(rows = 3, cols = 3) {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    for (let c = 0; c < cols; c += 1) {
      const th = document.createElement('th');
      th.textContent = `Header ${c + 1}`;
      trHead.appendChild(th);
    }
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows - 1; r += 1) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c += 1) {
        const td = document.createElement('td');
        td.textContent = `Cell ${r + 1}-${c + 1}`;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    insertNodeAtCursor(table);
    scheduleSave();
  }

  function insertMermaidBlock() {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="mermaid-card" contenteditable="false" data-mermaid-source="graph TD\n  A[Start] --> B[Review] --> C[Done]">
        <div class="mermaid-toolbar">
          <div class="mermaid-title">Mermaid Diagram</div>
          <button class="rerender-mermaid-btn" type="button">Render</button>
        </div>
        <textarea class="mermaid-source" spellcheck="false">graph TD
  A[Start] --> B[Review] --> C[Done]</textarea>
        <div class="mermaid-render"></div>
      </div>
    `;
    insertNodeAtCursor(wrapper.firstElementChild);
    renderAllMermaid();
    scheduleSave();
  }

  function toggleCodeBlock() {
    const selection = window.getSelection();
    const text = selection?.toString() || 'code';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = text;
    pre.appendChild(code);
    insertNodeAtCursor(pre);
    scheduleSave();
  }

  function insertHr() {
    insertNodeAtCursor(document.createElement('hr'));
    scheduleSave();
  }

  function insertNodeAtCursor(node) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editorHost.appendChild(node);
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function switchMode(sourceMode) {
    isSourceMode = sourceMode;
    if (sourceMode) {
      sourceHost.hidden = false;
      editorHost.hidden = true;
      sourceHost.value = bodyMarkdown || serializeDocument().replace(/^---[\s\S]*?---\n\n?/, '');
      sourceHost.focus();
    } else {
      sourceHost.hidden = true;
      editorHost.hidden = false;
      bodyMarkdown = sourceHost.value;
      renderMarkdown(joinFrontmatter(frontmatter, bodyMarkdown));
      editorHost.focus();
      scheduleSave();
    }
  }

  document.querySelectorAll('[data-cmd]').forEach((button) => {
    button.addEventListener('click', () => exec(button.getAttribute('data-cmd')));
  });

  document.querySelectorAll('[data-block]').forEach((button) => {
    button.addEventListener('click', () => formatBlock(button.getAttribute('data-block')));
  });

  document.getElementById('toggleCodeBlock').addEventListener('click', toggleCodeBlock);
  document.getElementById('insertTableBtn').addEventListener('click', () => insertTable(3, 3));
  document.getElementById('insertMermaidBtn').addEventListener('click', insertMermaidBlock);
  document.getElementById('insertHrBtn').addEventListener('click', insertHr);
  document.getElementById('indentBtn').addEventListener('click', () => exec('indent'));
  document.getElementById('outdentBtn').addEventListener('click', () => exec('outdent'));
  document.getElementById('toggleFrontmatterBtn').addEventListener('click', () => {
    frontmatterPanel.hidden = !frontmatterPanel.hidden;
  });
  document.getElementById('sourceModeBtn').addEventListener('click', () => switchMode(true));
  document.getElementById('designModeBtn').addEventListener('click', () => switchMode(false));
  document.getElementById('refreshMermaidBtn').addEventListener('click', renderAllMermaid);

  document.getElementById('insertLinkBtn').addEventListener('click', () => {
    const url = window.prompt('Enter a URL', 'https://');
    if (url) {
      exec('createLink', url);
    }
  });

  document.getElementById('insertImageBtn').addEventListener('click', () => {
    imageInput.value = '';
    imageInput.click();
  });

  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    vscode.postMessage({ type: 'saveImage', fileName: file.name, dataUrl });
  });

  editorHost.addEventListener('input', scheduleSave);
  sourceHost.addEventListener('input', scheduleSave);

  editorHost.addEventListener('click', (event) => {
    const target = event.target;
    if (target.classList?.contains('rerender-mermaid-btn')) {
      const card = target.closest('.mermaid-card');
      renderMermaidCard(card, Array.from(editorHost.querySelectorAll('.mermaid-card')).indexOf(card));
      scheduleSave();
    }
  });

  editorHost.addEventListener('change', (event) => {
    if (event.target.classList?.contains('mermaid-source')) {
      const card = event.target.closest('.mermaid-card');
      renderMermaidCard(card, Array.from(editorHost.querySelectorAll('.mermaid-card')).indexOf(card));
      scheduleSave();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'setDocument': {
        suspendSave = true;
        currentMarkdown = message.text || '';
        docPathChip.textContent = message.documentPath || '';
        renderMarkdown(currentMarkdown);
        suspendSave = false;
        break;
      }
      case 'resolvedImageSrcs': {
        const mappings = message.mappings || {};
        editorHost.querySelectorAll('img[data-md-src]').forEach((img) => {
          const raw = img.getAttribute('data-md-src');
          if (raw && mappings[raw]) {
            img.setAttribute('src', mappings[raw]);
          }
        });
        break;
      }
      case 'requestSave': {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
        }
        const next = serializeDocument();
        currentMarkdown = next;
        vscode.postMessage({ type: 'saveDocument', text: next });
        break;
      }
      case 'imageSaved': {
        const img = document.createElement('img');
        img.setAttribute('src', message.previewSrc);
        img.setAttribute('data-md-src', message.markdownPath);
        img.setAttribute('alt', 'Inserted image');
        insertNodeAtCursor(img);
        scheduleSave();
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/\r\n/g, '&#10;').replace(/[\r\n]/g, '&#10;');
  }
})();
