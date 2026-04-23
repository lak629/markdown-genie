import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'advancedMarkdownWysiwyg.editor',
      new AdvancedMarkdownEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('advancedMarkdownWysiwyg.openEditor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !/\.(md|markdown)$/i.test(editor.document.uri.fsPath)) {
        vscode.window.showInformationMessage('Open a Markdown file first.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', editor.document.uri, 'advancedMarkdownWysiwyg.editor');
    })
  );
}

class AdvancedMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    let ignoreDocumentChange = false;
    let ignoreDocumentChangeTimeout: NodeJS.Timeout | undefined;
    let pendingSave: (() => void) | undefined;
    let pendingSaveReject: ((reason?: any) => void) | undefined;
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(document.uri, '..'),
        ...(vscode.workspace.workspaceFolders?.map((w) => w.uri) ?? [])
      ]
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, document);

    const updateWebview = async () => {
      await webviewPanel.webview.postMessage({
        type: 'setDocument',
        text: document.getText(),
        documentUri: document.uri.toString(),
        documentPath: document.uri.fsPath,
        documentDir: path.dirname(document.uri.fsPath)
      });
    };

    const replaceDocumentText = async (text: string): Promise<void> => {
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, text);
      ignoreDocumentChange = true;
      if (ignoreDocumentChangeTimeout) {
        clearTimeout(ignoreDocumentChangeTimeout);
      }
      ignoreDocumentChangeTimeout = setTimeout(() => {
        ignoreDocumentChange = false;
      }, 500);
      await vscode.workspace.applyEdit(edit);
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      if (ignoreDocumentChange) {
        return;
      }
      updateWebview().catch(console.error);
    });

    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      const savePromise = new Promise<void>((resolve, reject) => {
        pendingSave = resolve;
        pendingSaveReject = reject;
        webviewPanel.webview.postMessage({ type: 'requestSave' });
      });

      e.waitUntil(savePromise);
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      willSaveSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          await updateWebview();
          break;
        case 'updateText':
          await replaceDocumentText(message.text ?? '');
          break;
        case 'resolveImageSrcs': {
          const srcs: string[] = Array.isArray(message.srcs) ? message.srcs : [];
          const mappings: Record<string, string> = {};
          for (const src of srcs) {
            try {
              mappings[src] = await this.resolveImageUri(webviewPanel.webview, document, src);
            } catch {
              mappings[src] = src;
            }
          }
          await webviewPanel.webview.postMessage({ type: 'resolvedImageSrcs', mappings });
          break;
        }
        case 'saveImage': {
          try {
            const saved = await this.saveImage(document, message);
            await webviewPanel.webview.postMessage({ type: 'imageSaved', ...saved });
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Unable to save image: ${text}`);
          }
          break;
        }
        case 'saveDocument': {
          if (pendingSave) {
            try {
              await replaceDocumentText(message.text ?? '');
              pendingSave();
            } catch (error) {
              pendingSaveReject?.(error);
            } finally {
              pendingSave = undefined;
              pendingSaveReject = undefined;
            }
          }
          break;
        }
      }
    });
  }

  private async resolveImageUri(webview: vscode.Webview, document: vscode.TextDocument, rawSrc: string): Promise<string> {
    if (/^(https?:|data:)/i.test(rawSrc)) {
      return rawSrc;
    }

    let target: vscode.Uri;
    if (rawSrc.startsWith('/')) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      target = workspaceFolder ? vscode.Uri.joinPath(workspaceFolder.uri, rawSrc) : vscode.Uri.file(rawSrc);
    } else {
      target = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(document.uri.fsPath)), rawSrc);
    }

    return webview.asWebviewUri(target).toString();
  }

  private async saveImage(document: vscode.TextDocument, message: any): Promise<{ markdownPath: string; previewSrc: string }> {
    const dataUrl: string = message.dataUrl;
    const originalName: string = message.fileName || 'image.png';
    const match = /^data:(.+);base64,(.+)$/s.exec(dataUrl || '');
    if (!match) {
      throw new Error('Image payload was not a valid base64 data URL.');
    }

    const base64 = match[2];
    const buffer = Buffer.from(base64, 'base64');
    const ext = path.extname(originalName) || '.png';
    const safeBase = path.basename(originalName, ext).replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'image';

    const documentDir = path.dirname(document.uri.fsPath);
    const documentBase = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
    const assetDir = path.join(documentDir, `${documentBase}.assets`);
    await fs.mkdir(assetDir, { recursive: true });

    let candidate = `${safeBase}${ext}`;
    let outputPath = path.join(assetDir, candidate);
    let counter = 1;

    while (await exists(outputPath)) {
      candidate = `${safeBase}-${counter}${ext}`;
      outputPath = path.join(assetDir, candidate);
      counter += 1;
    }

    await fs.writeFile(outputPath, buffer);
    const markdownPath = `${documentBase}.assets/${candidate}`.replace(/\\/g, '/');
    return {
      markdownPath,
      previewSrc: vscode.Uri.file(outputPath).toString()
    };
  }

  private getHtml(webview: vscode.Webview, document: vscode.TextDocument): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'editor.css'));
    const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'marked', 'lib', 'marked.umd.js'));
    const turndownUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'turndown', 'dist', 'turndown.js'));
    const turndownGfmUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'turndown-plugin-gfm', 'dist', 'turndown-plugin-gfm.js'));
    const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; frame-src ${webview.cspSource} data: blob:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Markdown Genie</title>
</head>
<body data-document-path="${escapeHtml(document.uri.fsPath)}">
  <div class="app-shell">
    <div class="title-row">
      <div>
        <div class="app-title">Markdown Genie</div>
        <div class="app-subtitle">Ribbon editor with frontmatter protection, images, Mermaid, and tables</div>
      </div>
      <div class="doc-chip" id="docPathChip"></div>
    </div>

    <div class="frontmatter-panel" id="frontmatterPanel" hidden>
      <div class="panel-title">Protected frontmatter</div>
      <textarea id="frontmatterText" readonly spellcheck="false"></textarea>
    </div>

    <div class="ribbon" role="toolbar" aria-label="Markdown formatting ribbon">
      <div class="ribbon-group">
        <div class="ribbon-group-title">Format</div>
        <div class="ribbon-buttons">
          <button data-cmd="bold">Bold</button>
          <button data-cmd="italic">Italic</button>
          <button data-cmd="underline">Underline</button>
          <button data-cmd="strikeThrough">Strike</button>
          <button id="toggleInlineCodeBtn">Inline Code</button>
          <button data-cmd="removeFormat">Clear</button>
        </div>
      </div>
      <div class="ribbon-group">
        <div class="ribbon-group-title">Blocks</div>
        <div class="ribbon-buttons">
          <button data-block="P">Paragraph</button>
          <button data-block="H1">H1</button>
          <button data-block="H2">H2</button>
          <button data-block="H3">H3</button>
          <button data-block="BLOCKQUOTE">Quote</button>
          <button id="toggleCodeBlock">Code Block</button>
        </div>
      </div>
      <div class="ribbon-group">
        <div class="ribbon-group-title">Lists</div>
        <div class="ribbon-buttons">
          <button data-cmd="insertUnorderedList">Bullets</button>
          <button data-cmd="insertOrderedList">Numbering</button>
          <button id="indentBtn">Indent</button>
          <button id="outdentBtn">Outdent</button>
        </div>
      </div>
      <div class="ribbon-group">
        <div class="ribbon-group-title">Insert</div>
        <div class="ribbon-buttons">
          <button id="insertLinkBtn">Link</button>
          <button id="insertImageBtn">Image</button>
          <button id="insertTableBtn">Table</button>
          <button id="insertHrBtn">Rule</button>
          <button id="insertMermaidBtn">Mermaid</button>
        </div>
      </div>
      <div class="ribbon-group">
        <div class="ribbon-group-title">Table</div>
        <div class="ribbon-buttons">
          <button id="addRowAboveBtn">Row above</button>
          <button id="addRowBelowBtn">Row below</button>
          <button id="deleteRowBtn">Delete row</button>
          <button id="addColLeftBtn">Col left</button>
          <button id="addColRightBtn">Col right</button>
          <button id="deleteColBtn">Delete column</button>
        </div>
      </div>
      <div class="ribbon-group">
        <div class="ribbon-group-title">View</div>
        <div class="ribbon-buttons">
          <button id="refreshMermaidBtn">Refresh Diagrams</button>
          <button id="toggleFrontmatterBtn">Frontmatter</button>
          <button id="sourceModeBtn">Source</button>
          <button id="designModeBtn">Design</button>
        </div>
      </div>
    </div>

    <div class="editor-layout">
      <div id="editorHost" class="editor-host" contenteditable="true" spellcheck="true"></div>
      <textarea id="sourceHost" class="source-host" hidden spellcheck="false"></textarea>
    </div>

    <input id="imageInput" type="file" accept="image/*" hidden />
  </div>

  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${turndownUri}"></script>
  <script nonce="${nonce}" src="${turndownGfmUri}"></script>
  <script nonce="${nonce}" src="${mermaidUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function deactivate() {}
