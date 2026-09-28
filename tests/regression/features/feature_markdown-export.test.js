const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');
const { htmlToMarkdown, convertChatToMarkdown, sanitizeFilename } = require('../../../md-converter');

registerRegressionTest({
  id: 'REG-FEATURE-MARKDOWN-EXPORT',
  type: 'feature',
  description: 'AI Chat Markdown (.md) Export and HTML-to-GFM Conversion Engine',
  suiteFn: () => {}
});

describe('[FEATURE] Markdown (.md) Export Regression Suite', () => {

  describe('Basic Typography and Formatting', () => {
    test('converts headings h1 through h6 to markdown prefixes', () => {
      expect(htmlToMarkdown('<h1>Title 1</h1>')).toBe('# Title 1');
      expect(htmlToMarkdown('<h2>Section 2</h2>')).toBe('## Section 2');
      expect(htmlToMarkdown('<h3>Sub 3</h3>')).toBe('### Sub 3');
      expect(htmlToMarkdown('<h4>Sub 4</h4>')).toBe('#### Sub 4');
      expect(htmlToMarkdown('<h5>Sub 5</h5>')).toBe('##### Sub 5');
      expect(htmlToMarkdown('<h6>Sub 6</h6>')).toBe('###### Sub 6');
    });

    test('converts paragraphs, bold, italic, and strikethrough', () => {
      const html = '<p>This is <strong>bold</strong>, <em>italic</em>, and <del>strikethrough</del>.</p>';
      const md = htmlToMarkdown(html);
      expect(md).toBe('This is **bold**, *italic*, and ~~strikethrough~~.');
    });

    test('converts inline code with backticks and preserves internal backticks', () => {
      expect(htmlToMarkdown('<p>Use <code>const x = 1</code> here.</p>')).toBe('Use `const x = 1` here.');
      expect(htmlToMarkdown('<p><code>`backtick`</code></p>')).toBe('`` `backtick` ``');
    });

    test('converts blockquotes and multi-line blockquotes', () => {
      const html = '<blockquote><p>Line 1</p><p>Line 2</p></blockquote>';
      const md = htmlToMarkdown(html);
      expect(md).toContain('> Line 1');
      expect(md).toContain('> Line 2');
    });

    test('converts horizontal rules', () => {
      expect(htmlToMarkdown('<p>Above</p><hr><p>Below</p>')).toContain('---');
    });
  });

  describe('Code Block Preservation', () => {
    test('extracts language from code class attribute', () => {
      const html = '<pre><code class="language-python">def hello():\n    return "world"</code></pre>';
      const md = htmlToMarkdown(html);
      expect(md).toBe('```python\ndef hello():\n    return "world"\n```');
    });

    test('extracts language from sibling .code-language-pill', () => {
      const html = `
        <div class="code-language-pill">TypeScript</div>
        <pre><code>const a: number = 42;</code></pre>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('```typescript\nconst a: number = 42;\n```');
    });

    test('preserves code blocks containing triple backticks via expanded fence', () => {
      const html = '<pre><code>```markdown\n# Nested\n```</code></pre>';
      const md = htmlToMarkdown(html);
      expect(md).toMatch(/^````/);
      expect(md).toMatch(/````$/);
    });
  });

  describe('Lists and Task Items', () => {
    test('converts unordered lists to dash bullet items', () => {
      const html = '<ul><li>First item</li><li>Second item</li></ul>';
      const md = htmlToMarkdown(html);
      expect(md).toBe('- First item\n- Second item');
    });

    test('converts ordered lists with numbers', () => {
      const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
      const md = htmlToMarkdown(html);
      expect(md).toBe('1. First\n2. Second\n3. Third');
    });

    test('handles nested lists with proper indentation', () => {
      const html = `
        <ul>
          <li>Parent item
            <ul>
              <li>Nested child 1</li>
              <li>Nested child 2</li>
            </ul>
          </li>
        </ul>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('- Parent item');
      expect(md).toContain('  - Nested child 1');
      expect(md).toContain('  - Nested child 2');
    });

    test('converts checkbox items to GFM task list format', () => {
      const html = `
        <ul>
          <li><input type="checkbox" checked> Done task</li>
          <li><input type="checkbox"> Pending task</li>
        </ul>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('- [x] Done task');
      expect(md).toContain('- [ ] Pending task');
    });
  });

  describe('Tables to GFM Conversion', () => {
    test('converts standard HTML table with headers into pipe table', () => {
      const html = `
        <table>
          <thead>
            <tr><th>Feature</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr><td>Markdown Export</td><td>Completed</td></tr>
            <tr><td>PDF Export</td><td>Disabled</td></tr>
          </tbody>
        </table>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('| Feature | Status |');
      expect(md).toContain('| :--- | :--- |');
      expect(md).toContain('| Markdown Export | Completed |');
      expect(md).toContain('| PDF Export | Disabled |');
    });

    test('escapes internal pipes inside table cells', () => {
      const html = `
        <table>
          <tr><th>Expression</th></tr>
          <tr><td>a | b</td></tr>
        </table>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('a \\| b');
    });
  });

  describe('Math and Formulas (KaTeX / MathJax)', () => {
    test('extracts inline math from KaTeX annotation', () => {
      const html = `
        <span class="katex">
          <annotation encoding="application/x-tex">E = mc^2</annotation>
        </span>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toBe('$E = mc^2$');
    });

    test('extracts display math block from katex-display', () => {
      const html = `
        <div class="katex katex-display">
          <annotation encoding="application/x-tex">\\int_0^\\infty e^{-x} dx = 1</annotation>
        </div>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('$$\n\\int_0^\\infty e^{-x} dx = 1\n$$');
    });
  });

  describe('Special Elements and Platform Chips', () => {
    test('converts Atlassian smart chip to linked title with lozenge status', () => {
      const html = `
        <a class="atlassian-smart-chip" href="https://jira.example.com/DO-101">
          <span class="smart-chip-icon">☑</span>
          <span class="smart-chip-title">DO-101: Fix Export Alignment</span>
          <span class="smart-chip-lozenge status-done">Done</span>
        </a>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toBe('[☑ DO-101: Fix Export Alignment (Done)](https://jira.example.com/DO-101)');
    });

    test('converts Atlassian sources pill to bold pill format', () => {
      const html = '<div class="atlassian-sources-pill">12 Sources</div>';
      const md = htmlToMarkdown(html);
      expect(md).toBe('📎 **12 Sources**');
    });

    test('converts Rovo suggested prompt to blockquote format', () => {
      const html = '<div class="rovo-suggested-prompt">↳ How do I deploy this?</div>';
      const md = htmlToMarkdown(html);
      expect(md).toBe('> ↳ *How do I deploy this?*');
    });
  });

  describe('Full Conversation Export and Metadata Generation', () => {
    test('assembles complete document with title, platform, date, and user/assistant turns', () => {
      const chatData = {
        platform: 'Claude',
        title: 'Architectural Discussion',
        url: 'https://claude.ai/chat/12345',
        messages: [
          { role: 'user', html: '<p>Can we export as markdown?</p>' },
          { role: 'assistant', html: '<p>Yes, absolutely! Here is why:</p><ul><li>No margin clipping</li><li>Reflowable text</li></ul>' }
        ]
      };

      const result = convertChatToMarkdown(chatData);

      expect(result.filename).toBe('Architectural_Discussion.md');
      expect(result.markdown).toContain('# Architectural Discussion');
      expect(result.markdown).toContain('> **Platform:** Claude');
      expect(result.markdown).toContain('> **Source:** [https://claude.ai/chat/12345](https://claude.ai/chat/12345)');
      expect(result.markdown).toContain('## 🧑 User');
      expect(result.markdown).toContain('Can we export as markdown?');
      expect(result.markdown).toContain('## 🤖 Assistant');
      expect(result.markdown).toContain('- No margin clipping');
      expect(result.markdown).toContain('- Reflowable text');
    });

    test('sanitizes filename removing illegal filesystem characters', () => {
      expect(sanitizeFilename('Why / How: Can "AI" <Help>?')).toBe('Why___How__Can__AI___Help.md');
      expect(sanitizeFilename('   Clean Title   ')).toBe('Clean_Title.md');
      expect(sanitizeFilename('', '.md')).toBe('AI_Conversation.md');
    });
  });

});
