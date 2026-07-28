const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');

/**
 * Dynamic Regression Test for FEATURE: single-code-block-container
 * ID: REG-FEATURE-GEMINI-CODEBLOCK
 */

registerRegressionTest({
  id: 'REG-FEATURE-GEMINI-CODEBLOCK',
  type: 'feature',
  description: 'Gemini chat single code block container rendering',
  suiteFn: () => {}
});

describe('[FEATURE] Gemini Single Code Block Container Regression Test', () => {
  const printCss = fs.readFileSync(path.join(__dirname, '../../../print.css'), 'utf8');

  test('print.css must contain CSS rules enforcing single code block container and resetting nested child element borders', () => {
    expect(printCss).toContain('#write pre,');
    expect(printCss).toContain('#write code-block');
    expect(printCss).toContain('#write [class*="code-block" i]');
    expect(printCss).toContain('border: none !important;');
    expect(printCss).toContain('background-color: transparent !important;');
  });

  test('verifies structure of nested Gemini code block elements rendered in DOM', () => {
    document.body.innerHTML = `
      <div id="write">
        <code-block class="code-block-container">
          <div class="code-block-header">
            <span class="code-language-pill">BASH</span>
          </div>
          <div class="code-block-wrapper">
            <pre class="code-block-adapter">
              <code>#!/bin/bash\nset -e</code>
            </pre>
          </div>
        </code-block>
      </div>
    `;

    const codeBlockEl = document.querySelector('code-block');
    const headerEl = document.querySelector('.code-block-header');
    const pillEl = document.querySelector('.code-language-pill');
    const preEl = document.querySelector('pre');

    expect(codeBlockEl).not.toBeNull();
    expect(headerEl).not.toBeNull();
    expect(pillEl.textContent.trim()).toBe('BASH');
    expect(preEl.textContent).toContain('#!/bin/bash');
  });
});
