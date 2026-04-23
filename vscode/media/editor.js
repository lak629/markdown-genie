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
      const source = node.querySelector('.mermaid-source')?.value || node.querySelector('.mermaid-source')?.textContent || 'graph TD\n  A[Start] --> B[Finish]';
      const normalizedSource = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
      html(token) {
        return escapeHtml(token.text || '');
      },
      code(token) {
        const text = token.text || '';
        const lang = token.lang || '';
        if (lang.trim().toLowerCase() === 'mermaid') {
          const escaped = escapeHtml(text);
          return `
            <div class="mermaid-card" contenteditable="false" data-mdg-owned="true">
              <div class="mermaid-toolbar" data-mdg-owned="true">
                <div class="mermaid-title">Mermaid Diagram</div>
                <button class="rerender-mermaid-btn" type="button" data-mdg-owned="true">Render</button>
              </div>
              <textarea class="mermaid-source" spellcheck="false" data-mdg-owned="true">${escaped}</textarea>
              <div class="mermaid-render" data-mdg-owned="true"></div>
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

    editorHost.replaceChildren(sanitizeRenderedMarkdown(marked.parse(bodyMarkdown)));
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

    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

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

    if (!textarea.hasAttribute('data-listener-added')) {
      textarea.setAttribute('data-listener-added', 'true');
    }

    try {
      const result = await window.mermaid.render(`mermaid-${Date.now()}-${index}`, source);
      setMermaidPreviewFrame(renderHost, result.svg);
    } catch (error) {
      clearMermaidPreviewFrame(renderHost);
      const pre = document.createElement('pre');
      pre.textContent = String(error);
      renderHost.replaceChildren(pre);
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
      const source = textarea?.value || textarea?.textContent || '';
      if (textarea) {
        textarea.value = source;
        textarea.textContent = source;
      }
    });

    const rawMarkdown = turndownService.turndown(cloned);
    const { text: protectedMarkdown, blocks } = protectFencedBlocks(rawMarkdown);
    const markdown = restoreProtectedBlocks(
      protectedMarkdown
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      blocks
    );

    bodyMarkdown = markdown ? `${markdown}\n` : '';
    return joinFrontmatter(frontmatter, bodyMarkdown);
  }

  function joinFrontmatter(front, body) {
    if (front) {
      return body ? `${front}\n\n${body}` : `${front}\n`;
    }
    return body;
  }

  function protectFencedBlocks(markdown) {
    const blocks = [];
    const text = markdown.replace(/```[^\n]*\n[\s\S]*?\n```/g, (block) => {
      const token = `@@MDG_FENCE_${blocks.length}@@`;
      blocks.push(block);
      return token;
    });

    return { text, blocks };
  }

  function restoreProtectedBlocks(markdown, blocks) {
    return markdown.replace(/@@MDG_FENCE_(\d+)@@/g, (_match, index) => blocks[Number(index)] || '');
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

  function getSelectedCell() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    let node = selection.anchorNode;
    while (node && node !== editorHost && node.nodeName !== 'TD' && node.nodeName !== 'TH') {
      node = node.parentElement;
    }
    return node && (node.nodeName === 'TD' || node.nodeName === 'TH') ? node : null;
  }

  function createTableRow(cellCount, cellType = 'td') {
    const tr = document.createElement('tr');
    for (let i = 0; i < cellCount; i += 1) {
      const cell = document.createElement(cellType);
      cell.textContent = '';
      tr.appendChild(cell);
    }
    return tr;
  }

  function addTableRow(position) {
    const cell = getSelectedCell();
    if (!cell) return;

    const row = cell.parentElement;
    const table = row.closest('table');
    if (!table) return;

    const cellCount = row.children.length;
    const isHeader = row.querySelector('th') !== null;
    const newRow = createTableRow(cellCount, isHeader ? 'th' : 'td');

    if (position === 'above') {
      row.parentElement.insertBefore(newRow, row);
    } else {
      row.parentElement.insertBefore(newRow, row.nextSibling);
    }

    scheduleSave();
  }

  function deleteTableRow() {
    const cell = getSelectedCell();
    if (!cell) return;

    const row = cell.parentElement;
    const table = row.closest('table');
    if (!table) return;

    row.remove();
    if (table.querySelectorAll('tr').length === 0) {
      table.remove();
    }

    scheduleSave();
  }

  function addTableColumn(position) {
    const cell = getSelectedCell();
    if (!cell) return;

    const row = cell.parentElement;
    const table = row.closest('table');
    if (!table) return;

    const cellIndex = Array.from(row.children).indexOf(cell);
    const rows = Array.from(table.querySelectorAll('tr'));

    rows.forEach((currentRow) => {
      const referenceCell = currentRow.children[cellIndex];
      const newCellType = referenceCell ? referenceCell.nodeName.toLowerCase() : 'td';
      const newCell = document.createElement(newCellType);
      newCell.textContent = '';

      if (position === 'left') {
        if (referenceCell) {
          currentRow.insertBefore(newCell, referenceCell);
        } else {
          currentRow.appendChild(newCell);
        }
      } else {
        if (referenceCell && referenceCell.nextSibling) {
          currentRow.insertBefore(newCell, referenceCell.nextSibling);
        } else {
          currentRow.appendChild(newCell);
        }
      }
    });

    scheduleSave();
  }

  function deleteTableColumn() {
    const cell = getSelectedCell();
    if (!cell) return;

    const row = cell.parentElement;
    const table = row.closest('table');
    if (!table) return;

    const cellIndex = Array.from(row.children).indexOf(cell);
    const rows = Array.from(table.querySelectorAll('tr'));

    rows.forEach((currentRow) => {
      const targetCell = currentRow.children[cellIndex];
      if (targetCell) {
        targetCell.remove();
      }
    });

    if (table.querySelectorAll('tr').length === 0 || table.querySelectorAll('tr:first-child td, tr:first-child th').length === 0) {
      table.remove();
    }

    scheduleSave();
  }

  function insertMermaidBlock() {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="mermaid-card" contenteditable="false" data-mdg-owned="true">
        <div class="mermaid-toolbar" data-mdg-owned="true">
          <div class="mermaid-title">Mermaid Diagram</div>
          <button class="rerender-mermaid-btn" type="button" data-mdg-owned="true">Render</button>
        </div>
        <textarea class="mermaid-source" spellcheck="false" data-mdg-owned="true">graph TD
  A[Start] --> B[Review] --> C[Done]</textarea>
        <div class="mermaid-render" data-mdg-owned="true"></div>
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

  function getInlineCodeAncestor(node) {
    let current = node;
    while (current && current !== editorHost) {
      if (current.nodeType === Node.ELEMENT_NODE && current.nodeName === 'CODE' && current.classList?.contains('inline-code')) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function isExactInlineCodeSelection(range, codeNode) {
    const codeRange = document.createRange();
    codeRange.selectNodeContents(codeNode);
    return (
      range.compareBoundaryPoints(Range.START_TO_START, codeRange) === 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, codeRange) === 0
    );
  }

  function unwrapInlineCode(codeNode) {
    const fragment = document.createDocumentFragment();
    while (codeNode.firstChild) {
      fragment.appendChild(codeNode.firstChild);
    }

    const parent = codeNode.parentNode;
    if (!parent) {
      return null;
    }

    parent.replaceChild(fragment, codeNode);
    return parent;
  }

  function toggleInlineCode() {
    editorHost.focus();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editorHost.contains(range.commonAncestorContainer)) {
      return;
    }

    const startCode = getInlineCodeAncestor(range.startContainer);
    const endCode = getInlineCodeAncestor(range.endContainer);
    if (startCode && startCode === endCode && isExactInlineCodeSelection(range, startCode)) {
      const parent = unwrapInlineCode(startCode);
      if (parent) {
        parent.normalize();
      }
      scheduleSave();
      return;
    }

    if (range.collapsed) {
      return;
    }

    const code = document.createElement('code');
    code.classList.add('inline-code');

    try {
      range.surroundContents(code);
    } catch (_) {
      const fragment = range.extractContents();
      code.appendChild(fragment);
      range.insertNode(code);
    }

    const nextRange = document.createRange();
    nextRange.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(nextRange);
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

  document.getElementById('toggleInlineCodeBtn').addEventListener('click', toggleInlineCode);
  document.getElementById('toggleCodeBlock').addEventListener('click', toggleCodeBlock);
  document.getElementById('insertTableBtn').addEventListener('click', () => insertTable(3, 3));
  document.getElementById('addRowAboveBtn').addEventListener('click', () => addTableRow('above'));
  document.getElementById('addRowBelowBtn').addEventListener('click', () => addTableRow('below'));
  document.getElementById('deleteRowBtn').addEventListener('click', deleteTableRow);
  document.getElementById('addColLeftBtn').addEventListener('click', () => addTableColumn('left'));
  document.getElementById('addColRightBtn').addEventListener('click', () => addTableColumn('right'));
  document.getElementById('deleteColBtn').addEventListener('click', deleteTableColumn);
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
            const safeSrc = sanitizeImageSrc(mappings[raw]);
            if (safeSrc) {
              img.setAttribute('src', safeSrc);
            }
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
        const safePreviewSrc = sanitizeImageSrc(message.previewSrc);
        if (!safePreviewSrc) {
          break;
        }
        img.setAttribute('src', safePreviewSrc);
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

  function sanitizeImageSrc(value) {
    if (typeof value !== 'string') {
      return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (trimmed.startsWith('data:')) {
      return /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/.test(trimmed) ? trimmed : '';
    }

    try {
      const parsed = new URL(trimmed, window.location.href);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:') {
        return parsed.href;
      }
    } catch (_) {
      return '';
    }

    return '';
  }

  function sanitizeRenderedMarkdown(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, option, link[rel="import"], meta[http-equiv="refresh"]').forEach((node) => {
      if (node.closest('[data-mdg-owned="true"]')) {
        return;
      }
      node.remove();
    });

    template.content.querySelectorAll('*').forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();

        if (name.startsWith('on')) {
          element.removeAttribute(attribute.name);
          return;
        }

        if ((name === 'src' || name === 'href' || name === 'xlink:href') && !isSafeUrl(attribute.value)) {
          element.removeAttribute(attribute.name);
        }
      });
    });

    return template.content.cloneNode(true);
  }

  function setMermaidPreviewFrame(renderHost, svgMarkup) {
    clearMermaidPreviewFrame(renderHost);

    const iframe = document.createElement('iframe');
    iframe.className = 'mermaid-preview-frame';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('title', 'Mermaid diagram preview');
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        const nextHeight = Math.max(
          doc?.documentElement?.scrollHeight || 0,
          doc?.body?.scrollHeight || 0,
          240
        );
        iframe.style.height = `${nextHeight}px`;
      } catch (_) {
        iframe.style.height = '240px';
      }
    });
    iframe.srcdoc = getMermaidPreviewDocument(svgMarkup);
    renderHost.replaceChildren(iframe);
  }

  function clearMermaidPreviewFrame(renderHost) {
    renderHost.replaceChildren();
  }

  function getMermaidPreviewDocument(svgMarkup) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
    }

    body {
      display: inline-block;
    }

    svg {
      display: block;
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
${svgMarkup}
</body>
</html>`;
  }

  function isSafeUrl(value) {
    if (typeof value !== 'string') {
      return false;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed.startsWith('#')) {
      return true;
    }

    if (trimmed.startsWith('data:')) {
      return /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/i.test(trimmed);
    }

    try {
      const parsed = new URL(trimmed, window.location.href);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:';
    } catch (_) {
      return false;
    }
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
    return escapeHtml(value).replace(/\n/g, '&#10;');
  }
})();
