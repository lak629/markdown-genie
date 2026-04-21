---
title: "Markdown Genie Feature Test"
description: "Comprehensive formatting and editing test file for Markdown Genie."
tags:
  - markdown
  - test
  - mermaid
  - table
  - image
  - frontmatter
---

# Markdown Genie Feature Test

This file exercises the Markdown Genie editor features, including formatting, lists, tables, images, Mermaid diagrams, frontmatter protection, and code blocks.

## 1\. Text Formatting

-   **Bold text**
-   *Italic text*
-   ***Bold + italic***
-   ~Strikethrough~
-   Underline text
-   `Inline code`

### 1.1 Block formatting

> This is a blockquote. It should preserve the quoted block style and allow line breaks inside the quote.
> 
> -   Blockquote list item
> -   Another item inside quote

## 2\. Headings

### H3 Heading

#### H4 Heading

##### H5 Heading

## 3\. Lists

### 3.1 Unordered list

-   Bullet item one
-   Bullet item two
    -   Nested bullet item
    -   Another nested item

### 3.2 Ordered list

1.  First numbered item
2.  Second numbered item
    1.  Nested numbered item
    2.  Another nested numbered item
3.  Back to top-level

### 3.3 Task list

-   [x]  Completed item
-   [ ]  Incomplete item
-   [ ]  Another task for review

## 4\. Links

-   Regular link: [Markdown Genie homepage](https://example.com)
-   Email link: [support@example.com](mailto:support@example.com)

## 5\. Images

Inline image reference to verify asset handling:

![Markdown Genie sample image](https://file%2B.vscode-resource.vscode-cdn.net/Users/lkaltz/Documents/code/personal/markdown-genie/images/markdown-genie.png)

> Note: Replace `./markdown-genie.assets/sample-image.png` with a real image path after import.

## 6\. Mermaid Diagram

```mermaid
flowchart TD A[Start] --> B{Decision} B -->|Yes| C[Continue] B -->|No| D[Stop] C --> E[Finish]
```

## 7\. Tables

| Feature | Expected Result | Notes |
| --- | --- | --- |
| Bold | `**bold**` | Should render correctly |
| Italic | `*italic*` | Should render correctly |
| Mermaid | `mermaid` fenced block | Should render live preview |
| Image | `![...](...)` | Should preserve path and asset folder |

### 7.1 Aligned table

| Left aligned | Center aligned | Right aligned |
| :-- | :-: | --: |
| Left text | Center text | Right text |
| A | B | C |

## 8\. Code Blocks

```js
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet('Markdown Genie'));
```

## 9\. Mixed content

This paragraph contains **bold**, *italic*, and `inline code` together. It should still round-trip correctly when edited.

-   A list item with an [inline link](https://markdowngenie.com)
-   A second list item with **bold text** and a `code span`

## 10\. Final Review

Use this file to verify that:

-   frontmatter remains intact when editing the body
-   Mermaid blocks render and refresh properly
-   tables round-trip between editor and markdown source
-   images preserve asset references and are imported into a sibling assets folder
-   formatting buttons create the proper markdown syntax

  

  

| Header 1 | Header 2 | Header 3 |
| --- | --- | --- |
| Cell 2-1 | Cell 2-2 | Cell 2-3 |
| test | test | test |
