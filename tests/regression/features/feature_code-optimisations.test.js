const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');
const { htmlToMarkdown, convertChatToMarkdown } = require('../../../md-converter');

registerRegressionTest({
  id: 'REG-FEATURE-CODE-OPTIMISATIONS',
  type: 'feature',
  description: 'Data-safety, DOM traversal performance, DRY cleanup, and platform registry optimizations',
  suiteFn: () => {}
});

describe('[FEATURE] Code Optimisations Regression Suite', () => {
  const contentJsCode = fs.readFileSync(path.join(__dirname, '../../../content.js'), 'utf8');
  const printJsCode = fs.readFileSync(path.join(__dirname, '../../../print.js'), 'utf8');
  const buildJsCode = fs.readFileSync(path.join(__dirname, '../../../scripts/build.js'), 'utf8');

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  // 1. Data-Safety & Bug Fixes: React memory escaping & generics preservation
  test('convertChatToMarkdown preserves angle brackets and code generics like List<String> with data-raw-markdown or rawMarkdown', () => {

    const rawPrompt = 'How do I use List<String> and Map<String, Object> in Java? Also verify x < y && y > z.';
    
    // Case A: Using rawMarkdown property directly
    const messagesA = [
      { role: 'user', rawMarkdown: rawPrompt, html: `<div class="whitespace-pre-wrap" data-raw-markdown="true">${rawPrompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` },
      { role: 'assistant', rawMarkdown: 'Use `java.util.List<String> list = new ArrayList<>();`', html: '<div class="markdown"><p>Use <code>java.util.List&lt;String&gt; list = new ArrayList&lt;&gt;();</code></p></div>' }
    ];
    const resA = convertChatToMarkdown({ platform: 'ChatGPT', title: 'Generics Test', messages: messagesA });
    expect(resA.markdown).toContain('List<String>');
    expect(resA.markdown).toContain('Map<String, Object>');
    expect(resA.markdown).toContain('x < y && y > z');

    // Case B: Using html with data-raw-markdown="true" and escaped text
    const escapedHtml = rawPrompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const messagesB = [
      { role: 'user', html: `<div class="whitespace-pre-wrap" data-raw-markdown="true">${escapedHtml}</div>` },
      { role: 'assistant', html: '<div class="markdown"><p>Answer</p></div>' }
    ];
    const resB = convertChatToMarkdown({ platform: 'ChatGPT', title: 'Generics Test', messages: messagesB });
    expect(resB.markdown).toContain('List<String>');
    expect(resB.markdown).toContain('Map<String, Object>');
    expect(resB.markdown).toContain('x < y && y > z');
  });

  // 2. Performance: O(N * D) getUniqueElements
  test('getUniqueElements filters nested container elements and single-child wrappers in O(N * D)', () => {
    eval(contentJsCode + `
      window.getUniqueElements = getUniqueElements;
    `);

    // Container with multiple candidate children: container should be discarded in favor of children
    const container = document.createElement('div');
    container.id = 'container';
    const child1 = document.createElement('div');
    child1.id = 'child1';
    const child2 = document.createElement('div');
    child2.id = 'child2';
    container.appendChild(child1);
    container.appendChild(child2);
    document.body.appendChild(container);

    const candidates = [container, child1, child2];
    const unique = window.getUniqueElements(candidates);
    expect(unique).not.toContain(container);
    expect(unique).toContain(child1);
    expect(unique).toContain(child2);

    // Redundant 1:1 wrapper: child should be discarded in favor of ancestor
    const singleWrapper = document.createElement('div');
    singleWrapper.id = 'singleWrapper';
    const singleChild = document.createElement('div');
    singleChild.id = 'singleChild';
    singleWrapper.appendChild(singleChild);
    document.body.appendChild(singleWrapper);

    const singlePair = [singleWrapper, singleChild];
    const uniqueSingle = window.getUniqueElements(singlePair);
    expect(uniqueSingle).toContain(singleWrapper);
    expect(uniqueSingle).not.toContain(singleChild);
  });

  // 3. Performance: saveScrollPositions does not execute document.querySelectorAll("*")
  test('saveScrollPositions targets only designated scroll containers without full DOM scan', () => {
    eval(contentJsCode + `
      window.saveScrollPositions = saveScrollPositions;
    `);

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'chat-scroll-container';
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 250, writable: true });
    document.body.appendChild(scrollContainer);

    const positions = window.saveScrollPositions();
    expect(positions.has(scrollContainer)).toBe(true);
    expect(positions.get(scrollContainer).y).toBe(250);
  });

  // 4. Performance & DRY: cleanNoise consolidates queries and widget cleaner searches bottom-up
  test('cleanNoise removes composer, noise elements, and widget headers without throwing', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
    `);

    const root = document.createElement('div');
    root.innerHTML = `
      <div class="composer">Active Composer Input</div>
      <div class="sr-only">Screen reader noise</div>
      <div class="widget-box">
        <div class="widget-header">Connecting to visualize...</div>
        <img src="data:image/png;base64,mock" width="300" height="200" alt="Widget graph" />
      </div>
      <p>Genuine user conversational text that must be preserved.</p>
    `;

    window.cleanNoise(root);
    expect(root.querySelector('.composer')).toBeNull();
    expect(root.querySelector('.sr-only')).toBeNull();
    expect(root.querySelector('.widget-header')).toBeNull();
    expect(root.querySelector('img')).not.toBeNull();
    expect(root.textContent).toContain('Genuine user conversational text that must be preserved.');
  });

  // 5. Strategy / Registry Pattern in content.js
  test('PLATFORMS registry centralizes platform detection and extraction strategies', () => {
    eval(contentJsCode + `
      window.PLATFORMS = PLATFORMS;
      window.detectPlatform = detectPlatform;
    `);

    expect(window.PLATFORMS.ChatGPT).toBeDefined();
    expect(window.PLATFORMS.Claude).toBeDefined();
    expect(window.PLATFORMS.Gemini).toBeDefined();
    expect(window.PLATFORMS.Perplexity).toBeDefined();
    expect(window.PLATFORMS.Grok).toBeDefined();
    expect(window.PLATFORMS.Rovo).toBeDefined();

    expect(window.detectPlatform('https://chatgpt.com/c/123')).toBe('ChatGPT');
    expect(window.detectPlatform('https://claude.ai/chat/abc')).toBe('Claude');
    expect(window.detectPlatform('https://gemini.google.com/app/xyz')).toBe('Gemini');
    expect(window.detectPlatform('https://www.perplexity.ai/search/test')).toBe('Perplexity');
    expect(window.detectPlatform('https://grok.com/chat/test')).toBe('Grok');
    expect(window.detectPlatform('https://company.atlassian.net/jira/rovo')).toBe('Rovo');
  });

  // 6. Deduplication in print.js: normalizeSmartLinksAndLists removed
  test('print.js does not contain duplicate normalizeSmartLinksAndLists function', () => {
    expect(printJsCode).not.toContain('function normalizeSmartLinksAndLists');
  });

  // 7. scripts/build.js does not overwrite historical version folders
  test('scripts/build.js does not synchronize or overwrite existing dist/ai-chat-pdf-exporter-v* directories', () => {
    expect(buildJsCode).not.toContain('Synchronized latest build files to existing loaded directory');
  });
});
