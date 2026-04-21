# Markdown Genie

By [Lou Kaltz](https://markdowngenie.com)

All I wanted was a simple WYSIWYG markdown editor. I could not find one so I made one!  

Below all the steps to build this thing yourself using my repo.  I will gladly take feedback at support@markdowngenie.com.

This is a VS Code Markdown WYSIWYG markdown editor.

-   WYSIWYG editing surface with a ribbon-style toolbar
-   Standard formatting buttons for bold, italic, headings, lists, links, and rules
-   Protected YAML frontmatter panel that is preserved separately from the body
-   Image import workflow that copies selected images into a sibling `*.assets/` folder
-   Mermaid fenced block support with live rendering inside the editor
-   Table insertion and round-tripping back to Markdown
-   Source mode and design mode toggle

## Why this architecture

The project uses a VS Code custom editor backed by a webview and applies changes to the underlying Markdown text document. Mermaid rendering happens in the browser view from fenced `mermaid` blocks.  

## Project structure

-   `src/extension.ts` — VS Code extension activation and custom editor provider
-   `media/editor.js` — webview editor logic, serializer, ribbon actions, Mermaid rendering
-   `media/editor.css` — ribbon and editor styling
-   `package.json` — extension manifest and dependencies
-   `tsconfig.json` — TypeScript build config

## Installation

To install this extension locally in VS Code:

1.  Ensure you have Node.js and npm installed.
    
2.  Install the VS Code Extension Manager (vsce) globally:
    
    ```bash
    npm install -g @vscode/vsce
    ```
    
3.  Clone this repository:
    
    ```bash
    git clone https://github.com/lak629/markdown-genie.git
    ```
    
4.  Navigate to the project directory and install dependencies:
    
    ```bash
    npm install
    ```
    
5.  Compile the extension:
    
    ```bash
    npm run compile
    ```
    
6.  Package the extension:
    
    ```bash
    npm run package
    ```
    
    This command runs the `prepackage` lifecycle script first, which bumps the patch version and compiles the extension. Then it packages the VSIX into `build/`, for example `build/markdown-genie-0.2.1.vsix`.
    
    The full flow is:
    ```bash
    npm run prepackage
    npm run package
    ```
    
    But you only need to run `npm run package` because npm executes `prepackage` automatically.
    
7.  In VS Code, open the Extensions view (Ctrl+Shift+X), click the "..." menu, and select "Install from VSIX...".
    
8.  Select the generated `.vsix` file to install the extension.
    

Once installed, you can open Markdown files with Markdown Genie by right-clicking the file and selecting "Open with..." or using the command palette.

## Run locally

```bash
npm install
npm run compile
```

Then press `F5` in VS Code.

Open a Markdown file and run:

-   `Open Markdown Genie`

Or use:

-   `Reopen Editor With...` → `Markdown Genie`

## Notes

This is a simple WYSIWYG markdown editor meant for non-techies, not a full replacement for Word or Google Docs. The adoption of using mardown in many business cases is its learning curve for not techies.  This is meant to help fix that so we can start leveraging markdown more easily for ingestion into other systems such as LLM and business documentation, standard operating procedures and such.  

Future area to improve:

-   drag and drop image upload
-   resize handles for images and tables
-   richer keyboard shortcuts and slash commands
-   schema-driven frontmatter validation
-   inline Mermaid editing overlays
-   collaborative editing
