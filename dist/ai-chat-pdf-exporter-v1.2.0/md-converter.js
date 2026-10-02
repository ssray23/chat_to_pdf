/**
 * HTML to Markdown Converter Engine for AI Chat Exporter
 * 
 * Accurately translates sanitized conversation HTML from Claude, ChatGPT, Gemini,
 * Perplexity, Grok, and Rovo into clean, GitHub-Flavored Markdown (GFM).
 * Preserves code blocks, language tags, tables, math, lists, links, and media.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // CommonJS / Node.js
    module.exports = factory();
  } else {
    // Browser global
    root.MDConverter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Zero-dependency lightweight HTML parser for Node.js environments
   */
  function createLightweightDOM(html) {
    class MockNode {
      constructor(tagName, text = '') {
        this.nodeType = tagName === '#text' ? 3 : 1;
        this.tagName = tagName ? tagName.toUpperCase() : 'DIV';
        this.nodeValue = text;
        this.textContent = text;
        this.childNodes = [];
        this.children = [];
        this.attributes = new Map();
        this._classListSet = new Set();
        const set = this._classListSet;
        this.classList = {
          contains: (c) => set.has(c),
          add: (c) => set.add(c),
          remove: (c) => set.delete(c),
          [Symbol.iterator]: () => set.values()
        };
        this.parentElement = null;
        this.previousElementSibling = null;
        this.nextElementSibling = null;
        this.style = {};
      }
      getAttribute(k) { return this.attributes.get(k) || null; }
      setAttribute(k, v) {
        this.attributes.set(k, v);
        if (k === 'class' && typeof v === 'string') {
          v.split(/\s+/).forEach(c => c && this._classListSet.add(c));
        }
      }
      hasAttribute(k) { return this.attributes.has(k); }
      appendChild(c) {
        this.childNodes.push(c);
        if (c.nodeType === 1) {
          const prevEl = this.children.length > 0 ? this.children[this.children.length - 1] : null;
          if (prevEl) {
            prevEl.nextElementSibling = c;
            c.previousElementSibling = prevEl;
          }
          this.children.push(c);
        }
        c.parentElement = this;
        this.updateText();
      }
      updateText() {
        if (this.nodeType === 1) {
          this.textContent = this.childNodes.map(c => c.textContent || '').join('');
        }
      }
      matches(sel) {
        if (this.nodeType !== 1) return false;
        const selectors = sel.split(',').map(s => s.trim());
        return selectors.some(s => {
          if (!s) return false;
          if (s.startsWith('.')) {
            return this.classList.contains(s.slice(1));
          }
          if (s.includes('.') && !s.includes('[')) {
            const [tag, cls] = s.split('.');
            return (!tag || this.tagName === tag.toUpperCase()) && this.classList.contains(cls);
          }
          const attrMatch = s.match(/^(?:([a-zA-Z0-9-]+))?\[([a-zA-Z0-9-_:]+)(?:([*~|^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/i);
          if (attrMatch) {
            const [, tag, attr, op, v1, v2, v3] = attrMatch;
            if (tag && this.tagName !== tag.toUpperCase()) return false;
            if (!this.hasAttribute(attr)) return false;
            const targetVal = v1 !== undefined ? v1 : (v2 !== undefined ? v2 : (v3 || ''));
            if (!op) return true;
            const elVal = this.getAttribute(attr) || '';
            if (op === '=') return elVal.toLowerCase() === targetVal.toLowerCase();
            if (op === '*=') return elVal.toLowerCase().includes(targetVal.toLowerCase());
            if (op === '^=') return elVal.toLowerCase().startsWith(targetVal.toLowerCase());
            if (op === '$=') return elVal.toLowerCase().endsWith(targetVal.toLowerCase());
            return true;
          }
          return this.tagName === s.toUpperCase();
        });
      }
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      }
      querySelectorAll(sel) {
        const out = [];
        const walk = (el) => {
          for (const c of el.childNodes) {
            if (c.matches && c.matches(sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      }
    }

    const root = new MockNode('div');
    const stack = [root];
    const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      if (match[4]) {
        // Text node
        const txt = match[4];
        const textNode = new MockNode('#text', txt);
        stack[stack.length - 1].appendChild(textNode);
      } else if (match[2]) {
        const isClosing = !!match[1];
        const tagName = match[2].toLowerCase();
        const attrStr = match[3];

        if (isClosing) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName.toLowerCase() === tagName) {
              stack.splice(i);
              break;
            }
          }
        } else {
          const el = new MockNode(tagName);
          if (attrStr) {
            const attrRegex = /([a-zA-Z0-9-_:]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
            let mAttr;
            while ((mAttr = attrRegex.exec(attrStr)) !== null) {
              const name = mAttr[1];
              const val = mAttr[2] !== undefined ? mAttr[2] : (mAttr[3] !== undefined ? mAttr[3] : (mAttr[4] || ''));
              el.setAttribute(name, val);
            }
          }
          if (el.tagName === 'INPUT' && el.getAttribute('type') === 'checkbox') {
            el.checked = el.hasAttribute('checked') && el.getAttribute('checked') !== 'false';
          }
          stack[stack.length - 1].appendChild(el);

          const isSelfClosing = ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tagName) || (attrStr && attrStr.trim().endsWith('/'));
          if (!isSelfClosing) {
            stack.push(el);
          }
        }
      }
    }

    return root;
  }

  /**
   * Helper to parse HTML string into a DOM element or document
   */
  function parseHTML(html) {
    if (typeof window !== 'undefined' && window.DOMParser) {
      const parser = new window.DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      return doc.body;
    } else if (typeof document !== 'undefined') {
      const container = document.createElement('div');
      container.innerHTML = html;
      return container;
    } else {
      // 100% self-contained parser for pure Node.js environments
      return createLightweightDOM(html);
    }
  }

  /**
   * Sanitize a string for safe filesystem filename
   */
  function sanitizeFilename(title, ext = '.md') {
    if (!title || typeof title !== 'string') {
      title = 'AI_Conversation';
    }
    // Trim whitespace first
    let sanitized = title.trim();

    // Remove invalid filesystem chars: \ / : * ? " < > |
    sanitized = sanitized
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^[._]+/, '')
      .replace(/[._]+$/, '');

    if (!sanitized) sanitized = 'AI_Conversation';
    if (sanitized.length > 80) sanitized = sanitized.slice(0, 80);

    return sanitized + (ext.startsWith('.') ? ext : `.${ext}`);
  }

  /**
   * Determine image extension from data URL mime type
   */
  function getImageExtension(dataUrl) {
    if (!dataUrl) return 'png';
    const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);/);
    if (!match) return 'png';
    const sub = match[1].toLowerCase();
    if (sub.includes('jpeg') || sub.includes('jpg')) return 'jpg';
    if (sub.includes('svg')) return 'svg';
    if (sub.includes('gif')) return 'gif';
    if (sub.includes('webp')) return 'webp';
    return 'png';
  }

  /**
   * Extract LaTeX math formula from KaTeX or MathJax element
   */
  function extractMathFormula(el) {
    // KaTeX annotation
    const annotation = el.querySelector('annotation[encoding="application/x-tex"], annotation[encoding*="tex"]');
    if (annotation && annotation.textContent.trim()) {
      return annotation.textContent.trim();
    }
    // MathJax script tag
    const mathJaxScript = el.querySelector('script[type*="math/tex"]');
    if (mathJaxScript && mathJaxScript.textContent.trim()) {
      return mathJaxScript.textContent.trim();
    }
    // data-math or data-tex attribute
    const dataMath = el.getAttribute('data-math') || el.getAttribute('data-tex') || el.getAttribute('alt');
    if (dataMath && dataMath.trim()) {
      return dataMath.trim();
    }
    return '';
  }

  /**
   * Check if an element represents display/block math vs inline math
   */
  function isDisplayMath(el) {
    if (el.classList.contains('katex-display') || el.classList.contains('MathJax_Display')) {
      return true;
    }
    if (el.tagName.toLowerCase() === 'div' && el.querySelector('.katex-display')) {
      return true;
    }
    if (el.getAttribute('display') === 'block') {
      return true;
    }
    return false;
  }

  /**
   * Extract code block language from code/pre elements or surrounding pills
   */
  function extractCodeLanguage(preEl) {
    // 1. Check code child for class="language-xyz" or class="lang-xyz"
    const codeEl = preEl.querySelector('code');
    if (codeEl) {
      for (const cls of codeEl.classList) {
        const m = cls.match(/^(?:language|lang)-([a-zA-Z0-9+#.-]+)$/i);
        if (m) return m[1].toLowerCase();
      }
      const dataLang = codeEl.getAttribute('data-language') || codeEl.getAttribute('data-lang');
      if (dataLang) return dataLang.trim().toLowerCase();
    }

    // 2. Check pre element itself for language class or data-language
    for (const cls of preEl.classList) {
      const m = cls.match(/^(?:language|lang)-([a-zA-Z0-9+#.-]+)$/i);
      if (m) return m[1].toLowerCase();
    }
    const preDataLang = preEl.getAttribute('data-language') || preEl.getAttribute('data-lang');
    if (preDataLang) return preDataLang.trim().toLowerCase();

    // 3. Check for previous sibling language pill (.code-language-pill)
    let sibling = preEl.previousElementSibling;
    for (let i = 0; i < 2 && sibling; i++) {
      if (sibling.classList.contains('code-language-pill') || sibling.classList.contains('code-language-pill-wrapper')) {
        const text = sibling.textContent.trim().toLowerCase();
        if (text && /^[a-z0-9+#.-]{1,15}$/i.test(text)) return text;
      }
      sibling = sibling.previousElementSibling;
    }

    // 4. Check parent's previous sibling
    const parent = preEl.parentElement;
    if (parent && parent.previousElementSibling) {
      const pSib = parent.previousElementSibling;
      if (pSib.classList.contains('code-language-pill') || pSib.classList.contains('code-language-pill-wrapper')) {
        const text = pSib.textContent.trim().toLowerCase();
        if (text && /^[a-z0-9+#.-]{1,15}$/i.test(text)) return text;
      }
    }

    return '';
  }

  /**
   * Helper to extract text while preserving line breaks from br tags
   */
  function extractPreservedText(node) {
    let text = '';
    for (const c of (node.childNodes || [])) {
      if (c.nodeType === 3 /* TEXT_NODE */) {
        text += c.nodeValue || '';
      } else if (c.nodeType === 1) {
        const tag = c.tagName ? c.tagName.toLowerCase() : '';
        if (tag === 'br') {
          text += '\n';
        } else {
          text += extractPreservedText(c);
        }
      }
    }
    return text;
  }

  /**
   * Main recursive node converter
   */
  function convertNode(node, options, state) {
    if (!node) return '';

    // TEXT NODE
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      let text = node.nodeValue || '';
      // Inside pre/code, keep exact text
      if (state.inPre) return text;
      // Normal text: collapse multiple spaces/newlines
      return text.replace(/[\r\n\t]+/g, ' ');
    }

    // COMMENT OR NON-ELEMENT NODE
    if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) {
      return '';
    }

    const tagName = node.tagName.toLowerCase();

    // Ignore non-content elements
    if (['script', 'style', 'noscript', 'template', 'svg'].includes(tagName)) {
      // SVGs inside sources or icons are ignored
      return '';
    }

    // Special Element: Code language pill (language is attached to code block fence)
    if (node.classList.contains('code-language-pill') || node.classList.contains('code-language-pill-wrapper')) {
      return '';
    }

    // Special Element: Atlassian Sources Pill
    if (node.classList.contains('atlassian-sources-pill')) {
      const text = node.textContent.trim();
      return text ? `\n\n📎 **${text}**\n\n` : '';
    }

    // Special Element: Rovo Suggested Prompt
    if (node.classList.contains('rovo-suggested-prompt')) {
      const text = node.textContent.replace(/^[↳⤷\s]+/, '').trim();
      return text ? `\n\n> ↳ *${text}*\n\n` : '';
    }

    // Special Element: Atlassian Smart Chip / Jira Issue
    if (node.classList.contains('atlassian-smart-chip') || (node.matches && node.matches('[data-testid*="inline-card" i], [class*="InlineCard" i], [data-smart-card]'))) {
      const href = node.getAttribute('href') || '#';
      const icon = node.querySelector('.smart-chip-icon')?.textContent.trim() || '';
      let title = node.querySelector('.smart-chip-title')?.textContent.trim() || node.textContent.trim();
      const lozenge = node.querySelector('.smart-chip-lozenge')?.textContent.trim() || '';
      
      // Clean preview suffix
      title = title.replace(/\s*Preview$/i, '').trim();

      let label = title;
      if (icon) label = `${icon} ${label}`;
      if (lozenge) label = `${label} (${lozenge})`;
      
      return `[${label}](${href})`;
    }

    // Special Element: Media Card (.ai-exporter-media-card)
    if (node.classList.contains('ai-exporter-media-card')) {
      const img = node.querySelector('img');
      const caption = node.querySelector('.ai-exporter-media-caption')?.textContent.trim() || (img?.alt || '');
      let md = '';
      if (img) {
        md = convertImageNode(img, caption, options);
      }
      if (caption && caption !== 'Image attachment') {
        md += `\n\n*${caption}*`;
      }
      return `\n\n${md}\n\n`;
    }

    // Special Element: KaTeX / MathJax Math Formula
    if (node.classList.contains('katex') || node.classList.contains('MathJax') || node.hasAttribute('data-math')) {
      const formula = extractMathFormula(node);
      if (formula) {
        if (isDisplayMath(node)) {
          return `\n\n$$\n${formula}\n$$\n\n`;
        } else {
          return `$${formula}$`;
        }
      }
    }

    // HEADINGS
    if (/^h[1-6]$/.test(tagName)) {
      const level = parseInt(tagName[1], 10);
      const prefix = '#'.repeat(level);
      const inner = convertChildren(node, options, state).trim();
      return inner ? `\n\n${prefix} ${inner}\n\n` : '';
    }

    // ASCII / Box-drawing Diagram inside paragraph or generic block
    if ((tagName === 'p' || tagName === 'div') && /[─│┌┐└┘├┤┬┴►▼▲◄]/.test(node.textContent) && (node.textContent.includes('\n') || node.querySelector('br'))) {
      const text = extractPreservedText(node).replace(/\r\n/g, '\n').trimEnd();
      let fence = '```';
      while (text.includes(fence)) fence += '`';
      return `\n\n${fence}text\n${text}\n${fence}\n\n`;
    }

    // Special / Preformatted Containers (div with code-block or data-node-type="codeBlock")
    if ((tagName === 'div' || tagName === 'section') && (
      node.getAttribute('data-node-type') === 'codeBlock' || 
      node.classList.contains('ak-renderer-code-block') || 
      node.classList.contains('code-block')
    )) {
      const preEl = node.querySelector('pre');
      if (preEl) {
        return convertNode(preEl, options, state);
      }
      const codeText = node.textContent.replace(/\r\n/g, '\n');
      let lang = node.getAttribute('data-language') || (/[─│┌┐└┘├┤┬┴►▼▲◄]/.test(codeText) ? 'text' : '');
      let fence = '```';
      while (codeText.includes(fence)) fence += '`';
      return `\n\n${fence}${lang}\n${codeText.trimEnd()}\n${fence}\n\n`;
    }

    // PARAGRAPHS
    if (tagName === 'p') {
      const inner = convertChildren(node, options, state).trim();
      if (!inner) return '';
      if (state.inList) {
        return `${inner}\n`;
      }
      return `\n\n${inner}\n\n`;
    }

    // BLOCKQUOTES
    if (tagName === 'blockquote') {
      const inner = convertChildren(node, options, state).trim();
      if (!inner) return '';
      const quoted = inner
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
      return `\n\n${quoted}\n\n`;
    }

    // PREFORMATTED CODE BLOCKS
    if (tagName === 'pre') {
      let lang = extractCodeLanguage(node);
      const codeEl = node.querySelector('code') || node;
      const codeText = codeEl.textContent.replace(/\r\n/g, '\n');

      // Label as text if it has box-drawing characters
      if (!lang && /[─│┌┐└┘├┤┬┴►▼▲◄]/.test(codeText)) {
        lang = 'text';
      }

      // Defensive fence check in case code contains triple backticks
      let fence = '```';
      while (codeText.includes(fence)) {
        fence += '`';
      }

      return `\n\n${fence}${lang}\n${codeText.trimEnd()}\n${fence}\n\n`;
    }

    // INLINE OR BLOCK CODE
    if (tagName === 'code') {
      if (state.inPre) {
        return node.textContent;
      }
      const codeText = node.textContent;
      if (!codeText) return '';

      // If code contains newlines or box-drawing characters, format as a fenced block!
      const isMultiLine = codeText.includes('\n');
      const hasBoxDrawing = /[─│┌┐└┘├┤┬┴►▼▲◄]/.test(codeText);

      if (isMultiLine || hasBoxDrawing) {
        let fence = '```';
        while (codeText.includes(fence)) {
          fence += '`';
        }
        return `\n\n${fence}text\n${codeText.replace(/\r\n/g, '\n').trimEnd()}\n${fence}\n\n`;
      }

      // If code contains backticks, use double backticks
      if (codeText.includes('`')) {
        return `\`\` ${codeText} \`\``;
      }
      return `\`${codeText}\``;
    }

    // STRONG / BOLD
    if (tagName === 'strong' || tagName === 'b') {
      const inner = convertChildren(node, options, state);
      if (!inner.trim()) return inner;
      // Preserve leading and trailing spaces outside the asterisks
      const leadingSpace = inner.match(/^\s*/)[0];
      const trailingSpace = inner.match(/\s*$/)[0];
      return `${leadingSpace}**${inner.trim()}**${trailingSpace}`;
    }

    // EMPHASIS / ITALIC
    if (tagName === 'em' || tagName === 'i') {
      const inner = convertChildren(node, options, state);
      if (!inner.trim()) return inner;
      const leadingSpace = inner.match(/^\s*/)[0];
      const trailingSpace = inner.match(/\s*$/)[0];
      return `${leadingSpace}*${inner.trim()}*${trailingSpace}`;
    }

    // STRIKETHROUGH
    if (tagName === 'del' || tagName === 's' || tagName === 'strike') {
      const inner = convertChildren(node, options, state);
      if (!inner.trim()) return inner;
      const leadingSpace = inner.match(/^\s*/)[0];
      const trailingSpace = inner.match(/\s*$/)[0];
      return `${leadingSpace}~~${inner.trim()}~~${trailingSpace}`;
    }

    // HORIZONTAL RULE
    if (tagName === 'hr') {
      return '\n\n---\n\n';
    }

    // LINE BREAK
    if (tagName === 'br') {
      return '  \n';
    }

    // LINKS
    if (tagName === 'a') {
      const href = node.getAttribute('href') || '';
      let text = convertChildren(node, options, state).trim();
      text = text.replace(/\s*Preview$/i, '').trim();
      if (!href) return text;
      if (!text) return `[${href}](${href})`;
      return `[${text}](${href})`;
    }

    // IMAGES
    if (tagName === 'img') {
      const alt = node.getAttribute('alt') || 'Image';
      return convertImageNode(node, alt, options);
    }

    // LISTS (ul, ol)
    if (tagName === 'ul' || tagName === 'ol') {
      const isOrdered = tagName === 'ol';
      const startAttr = parseInt(node.getAttribute('start'), 10);
      let listIndex = !isNaN(startAttr) ? startAttr : 1;
      const listDepth = state.listDepth || 0;
      const indent = '  '.repeat(listDepth);

      let result = '';
      const childNodes = Array.from(node.children);

      for (const child of childNodes) {
        if (child.tagName && child.tagName.toLowerCase() === 'li') {
          let itemPrefix = isOrdered ? `${listIndex}. ` : '- ';
          listIndex++;

          // Check for task list checkboxes
          const chk = child.querySelector('input[type="checkbox"]');
          if (chk) {
            itemPrefix = chk.checked ? '- [x] ' : '- [ ] ';
          }

          const nextState = Object.assign({}, state, { listDepth: listDepth + 1, inList: true });
          
          let directContent = '';
          let subListContent = '';

          for (const c of child.childNodes) {
            if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
              subListContent += convertNode(c, options, nextState);
            } else {
              directContent += convertNode(c, options, nextState);
            }
          }

          directContent = directContent.trim();
          subListContent = subListContent.trimEnd();

          if (directContent.includes('\n')) {
            const lines = directContent.split('\n');
            const contIndent = ' '.repeat(itemPrefix.length);
            directContent = lines.map((l, idx) => (idx === 0 || !l.trim() ? l : `${indent}${contIndent}${l}`)).join('\n');
          }

          let itemOutput = `${indent}${itemPrefix}${directContent}`;
          if (subListContent) {
            itemOutput += `\n${subListContent}`;
          }
          result += `${itemOutput}\n`;
        }
      }
      return listDepth === 0 ? `\n${result}\n` : result;
    }

    // TABLES
    if (tagName === 'table') {
      return convertTableNode(node, options, state);
    }

    // GENERIC CONTAINERS (div, span, section, article, etc.)
    return convertChildren(node, options, state);
  }

  /**
   * Helper to convert an image node, supporting sidecar image extraction
   */
  function convertImageNode(imgNode, altText, options) {
    let src = imgNode.getAttribute('src') || '';
    if (!src) return '';

    altText = altText || imgNode.getAttribute('alt') || 'Image';
    // Clean newlines from alt text
    altText = altText.replace(/[\r\n]+/g, ' ').trim();

    // Check if image extraction is enabled and image is base64 data URL
    if (options && options.extractImages && Array.isArray(options.images) && src.startsWith('data:image/')) {
      const ext = getImageExtension(src);
      const imgIndex = options.images.length + 1;
      const padNum = String(imgIndex).padStart(3, '0');
      const filename = `image_${padNum}.${ext}`;

      options.images.push({
        filename,
        dataUrl: src,
        alt: altText
      });

      // Reference via relative sidecar path
      const imgPath = options.imageFolder ? `${options.imageFolder}/${filename}` : `./images/${filename}`;
      return `![${altText}](${imgPath})`;
    }

    return `![${altText}](${src})`;
  }

  /**
   * Convert an HTML <table> node to a GFM Markdown pipe table
   */
  function convertTableNode(tableNode, options, state) {
    const rows = Array.from(tableNode.querySelectorAll('tr'));
    if (rows.length === 0) return '';

    const matrix = [];
    const alignments = [];

    // Extract all rows and cells
    for (let r = 0; r < rows.length; r++) {
      const tr = rows[r];
      const cells = Array.from(tr.querySelectorAll('th, td'));
      const rowData = [];

      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        // Convert cell contents, replace newlines with <br>, escape pipes
        let cellText = convertChildren(cell, options, state)
          .replace(/[\r\n]+/g, ' ')
          .replace(/\|/g, '\\|')
          .trim();

        // Ensure unbalanced bold asterisks inside table cells are closed
        const starCount = (cellText.match(/\*\*/g) || []).length;
        if (starCount % 2 === 1) {
          cellText += '**';
        }

        rowData.push(cellText || ' ');

        // Determine column alignment from first row or header row
        if (r === 0 || alignments.length <= c) {
          const alignAttr = cell.getAttribute('align') || cell.style.textAlign || '';
          if (alignAttr.includes('center')) {
            alignments[c] = ':---:';
          } else if (alignAttr.includes('right')) {
            alignments[c] = '---:';
          } else {
            alignments[c] = ':---';
          }
        }
      }
      if (rowData.length > 0) {
        matrix.push(rowData);
      }
    }

    if (matrix.length === 0) return '';

    // Normalize column counts
    let maxCols = 0;
    matrix.forEach(row => { if (row.length > maxCols) maxCols = row.length; });
    matrix.forEach(row => {
      while (row.length < maxCols) row.push(' ');
    });
    while (alignments.length < maxCols) {
      alignments.push(':---');
    }

    // Check if the first row is a real header (contains <th> or in <thead>)
    const firstRowHasTh = rows[0] && rows[0].querySelector('th') !== null;
    let headerRow = matrix[0];
    let bodyRows = matrix.slice(1);

    if (!firstRowHasTh && matrix.length === 1) {
      // Single row table without <th> - synthesize header
      headerRow = matrix[0].map(() => ' ');
      bodyRows = [matrix[0]];
    }

    // Build GFM table string
    let out = '\n\n';
    out += `| ${headerRow.join(' | ')} |\n`;
    out += `| ${alignments.slice(0, maxCols).join(' | ')} |\n`;

    for (const bRow of bodyRows) {
      out += `| ${bRow.join(' | ')} |\n`;
    }
    out += '\n';

    return out;
  }

  /**
   * Helper to convert all children of a node
   */
  function convertChildren(node, options, state) {
    let result = '';
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      result += convertNode(children[i], options, state);
    }
    return result;
  }

  /**
   * Public API: Convert HTML string or DOM node to Markdown
   */
  function htmlToMarkdown(htmlOrNode, options = {}) {
    if (!htmlOrNode) return '';
    let rootEl;
    if (typeof htmlOrNode === 'object' && htmlOrNode.nodeType) {
      rootEl = htmlOrNode;
    } else if (typeof htmlOrNode === 'string') {
      rootEl = parseHTML(htmlOrNode);
    } else {
      return '';
    }
    const state = { inPre: false, listDepth: 0 };
    const md = convertChildren(rootEl, options, state);
    
    // Normalize excess blank lines (max 2 consecutive newlines)
    return md
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Post-process converted Markdown to fix formatting irregularities,
   * unclosed bold tags, LaTeX tokens, preview text, and orphan dividers.
   */
  function postProcessMarkdown(md) {
    if (!md) return '';

    let out = md;

    // 1. Sanitize unrendered LaTeX math tokens to clean Unicode symbols
    out = out
      .replace(/\$\s*\\rightarrow\s*\$/gi, '→')
      .replace(/\\rightarrow\b/gi, '→')
      .replace(/\$\s*\\leftarrow\s*\$/gi, '←')
      .replace(/\\leftarrow\b/gi, '←')
      .replace(/\$\s*\\Rightarrow\s*\$/gi, '⇒')
      .replace(/\\Rightarrow\b/gi, '⇒')
      .replace(/\$\s*\\times\s*\$/gi, '×')
      .replace(/\\times\b/gi, '×')
      .replace(/\$\s*\\le(q)?\s*\$/gi, '≤')
      .replace(/\\le(q)?\b/gi, '≤')
      .replace(/\$\s*\\ge(q)?\s*\$/gi, '≥')
      .replace(/\\ge(q)?\b/gi, '≥')
      .replace(/\\mathbf\{([^}]+)\}/g, '$1')
      .replace(/\\text\{([^}]+)\}/g, '$1')
      .replace(/\$\s*(\d+\s*×\s*£[0-9,.]+)\s*=\s*(£[0-9,.]+)\s*\$/g, '($1 = $2)')
      .replace(/\$\s*Total\s*=\s*(£[0-9,.]+)\s*\$/g, '(Total = $1)')
      .replace(/\$\s*([A-Za-z0-9\s\-–+=/£€$]+)\s*\$/g, '$1');

    // 2. Fix broken split bold tags around parentheses / code / links:
    // e.g., "**Retire Credit Files (**`CF`**)**" -> "**Retire Credit Files** (`CF`)"
    // e.g., "**ATCOM Flight Booking (**`ATCOMRes`):**" -> "**ATCOM Flight Booking** (`ATCOMRes`):"
    // e.g., "**Automated Handback API (**[Link](url)**):**" -> "**Automated Handback API** ([Link](url)):"
    out = out
      .replace(/\*\*([^*\n]+?)\s*\(\*\*\s*(`[^`]+`|\[[^\]]+\]\([^)]+\))\s*\*\*\)\s*(:?)\*\*/g, (m, g1, g2, col) => col ? `**${g1}** (${g2}):` : `**${g1}** (${g2})`)
      .replace(/\*\*([^*\n]+?)\s*\(\*\*\s*(`[^`]+`|\[[^\]]+\]\([^)]+\))\s*\):?\*\*/g, (m, g1, g2) => m.includes(':') ? `**${g1}** (${g2}):` : `**${g1}** (${g2})`)
      .replace(/\*\*([^*\n]+?)\s*\(\*\*\s*(`[^`]+`|\[[^\]]+\]\([^)]+\))\s*\)/g, '**$1** ($2)')
      .replace(/\*\*[ \t\u00a0]*\*\*/g, '');

    // 2b. Repair any unclosed bold markers inside table cells (| **text | -> | **text** |)
    out = out.replace(/(\| *)\*\*([^*|\n]+?)( *\|)/g, '$1**$2**$3');

    // 3. Clean trailing "Preview" from Markdown links (e.g. "[TitlePreview](url)" -> "[Title](url)")
    out = out
      .replace(/\[([^\]\n]+?)\s*Preview\]\(([^)]+)\)/gi, '[$1]($2)')
      .replace(/\[([^\]\n]+?)\s*Preview\b([^\]\n]*?)\]\(([^)]+)\)/gi, '[$1$2]($3)');

    // 4. Remove excessive / duplicate horizontal rules (especially right before or after headings)
    // 5. Prevent unwanted indented code blocks from forming on sub-list items:
    // (a) Remove blank lines between parent list items and their immediate nested sub-lists
    out = out.replace(/(\n[ \t]*(?:[-*+]|\d+\.)[^\n]+)\n+[ \t]{2,}([-*+]|\d+\.)/g, '$1\n  $2');
    // (b) Ensure sub-list items never have 4+ leading spaces after a blank line
    out = out.replace(/\n\n[ \t]{4,}([-*+]|\d+\.)/g, '\n\n  $1');

    // 6. Strip blank lines containing only whitespace (spaces, tabs, non-breaking spaces)
    // so inter-element HTML indentation/newlines (e.g. Grok Streamdown) don't become empty paragraphs
    out = out.replace(/^[ \t\u00a0]+$/gm, '');

    // 7. Clean up leading/trailing dashes and multiple newlines
    out = out
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return out;
  }

  /**
   * Public API: Convert structured chat conversation to Markdown document
   * 
   * @param {Object} chatData - { title, platform, url, messages: [{ role, html }] }
   * @param {Object} options - { extractImages: true, imageFolder: './images' }
   * @returns {Object} - { markdown: string, images: Array<{ filename, dataUrl, alt }>, filename: string }
   */
  function convertChatToMarkdown(chatData, options = {}) {
    if (!chatData) {
      throw new Error('chatData is required');
    }

    const opts = Object.assign({
      extractImages: true,
      imageFolder: './images'
    }, options);

    // Track collected images during conversion
    const collectedImages = [];
    opts.images = collectedImages;

    const title = chatData.title || `${chatData.platform || 'AI'} Conversation`;
    const platform = chatData.platform || 'AI Assistant';
    const exportDate = new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let doc = '';

    // Document Header - matches the clean PDF header
    doc += `# ${title}\n\n`;
    doc += `**Source:** ${platform} &nbsp;|&nbsp; **Exported on:** ${exportDate}\n\n`;
    doc += '---\n\n';

    // Process Conversation Turns
    const messages = chatData.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isUser = msg.role === 'user';
      
      let turnMd = htmlToMarkdown(msg.html, opts);
      if (!turnMd || !turnMd.trim()) continue;

      if (isUser) {
        // Divider before next user turn if not first turn
        if (i > 0) {
          doc += '\n\n---\n\n';
        }

        // Format User Prompt as a prominent, bolded themed card
        const cleanPrompt = turnMd.trim();
        const rawLines = cleanPrompt.split('\n').map(l => l.trim());
        while (rawLines.length > 0 && !rawLines[0]) rawLines.shift();
        while (rawLines.length > 0 && !rawLines[rawLines.length - 1]) rawLines.pop();

        const isSingleLine = rawLines.length === 1 && cleanPrompt.length < 250 && !cleanPrompt.startsWith('#');

        if (isSingleLine) {
          const text = rawLines[0].replace(/^\*\*|\*\*$/g, '');
          doc += `> ### **${text}**\n\n`;
        } else {
          let cardLines = '';
          let isFirstNonEmpty = true;
          for (let l = 0; l < rawLines.length; l++) {
            const trimmed = rawLines[l];
            if (!trimmed) {
              cardLines += '>\n';
            } else if (isFirstNonEmpty && !trimmed.startsWith('#') && !trimmed.startsWith('```')) {
              const text = trimmed.replace(/^\*\*|\*\*$/g, '');
              cardLines += `> ### **${text}**\n`;
              isFirstNonEmpty = false;
            } else if (trimmed.startsWith('#') || trimmed.startsWith('```') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
              cardLines += `> ${trimmed}\n`;
              isFirstNonEmpty = false;
            } else {
              const text = trimmed.replace(/^\*\*|\*\*$/g, '');
              cardLines += `> **${text}**\n`;
              isFirstNonEmpty = false;
            }
          }
          doc += `${cardLines}\n\n`;
        }
      } else {
        // Assistant response follows directly (matching PDF layout without robotic role headers)
        doc += `${turnMd}\n\n`;
      }
    }

    // Run post-processing on entire document
    doc = postProcessMarkdown(doc) + '\n';

    const safeFilename = sanitizeFilename(title, '.md');

    return {
      markdown: doc,
      images: collectedImages,
      filename: safeFilename
    };
  }

  return {
    htmlToMarkdown,
    convertChatToMarkdown,
    sanitizeFilename,
    postProcessMarkdown
  };
});
