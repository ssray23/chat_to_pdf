const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../helpers/testRegistry');

registerRegressionTest({
  id: 'REG-CONTENT-001',
  type: 'feature',
  description: 'Content script DOM scraping, overlay hiding, scroll preservation & image serialization',
  suiteFn: () => {}
});

describe('Content Script Scraper & DOM Manipulation Regression Suite', () => {
  let contentJsCode;

  beforeAll(() => {
    contentJsCode = fs.readFileSync(path.join(__dirname, '../../content.js'), 'utf8');
  });

  beforeEach(() => {
    // Expose internal functions to window for testing
    eval(contentJsCode + `
      window.hideOverlays = hideOverlays;
      window.restoreOverlays = restoreOverlays;
      window.saveScrollPositions = saveScrollPositions;
      window.restoreScrollPositions = restoreScrollPositions;
    `);
  });

  test('hideOverlays and restoreOverlays must correctly toggle sticky and fixed element visibility', () => {
    document.body.innerHTML = `
      <header id="h1" style="position: fixed; visibility: visible;">Header</header>
      <div id="d1" style="position: sticky; visibility: visible;">Sticky Bar</div>
      <div id="d2" style="position: static; visibility: visible;">Normal Content</div>
    `;

    const hidden = window.hideOverlays();
    expect(hidden.length).toBe(2);
    expect(document.getElementById('h1').style.visibility).toBe('hidden');
    expect(document.getElementById('d1').style.visibility).toBe('hidden');
    expect(document.getElementById('d2').style.visibility).toBe('visible');

    window.restoreOverlays(hidden);
    expect(document.getElementById('h1').style.visibility).toBe('visible');
    expect(document.getElementById('d1').style.visibility).toBe('visible');
  });

  test('saveScrollPositions and restoreScrollPositions must capture and restore window and element scroll offsets', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', { value: 120, writable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 40, writable: true });
    document.body.appendChild(el);

    const positions = window.saveScrollPositions();
    expect(positions.has(el)).toBe(true);

    el.scrollTop = 0;
    el.scrollLeft = 0;

    window.restoreScrollPositions(positions);
    expect(el.scrollTop).toBe(120);
    expect(el.scrollLeft).toBe(40);
  });

  test('chrome.runtime.onMessage listener must be registered for export_chat action', () => {
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
  });

  test('cleanNoise removes Claude "Thought for Xs" / thinking blocks without corrupting response text', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <div data-testid="thinking-block" class="thinking-collapsible">
        <summary>Thought for 7s</summary>
        <p>Thinking about orchestrator architecture...</p>
      </div>
      <button class="thought-summary">Thought for 7s</button>
      <div class="response-content">
        <p>Yes, this is far more useful. It directly answers your question.</p>
        <p>Layer 0: what this diagram actually shows...</p>
      </div>
    `;

    window.cleanNoise(container);

    // Thinking noise must be stripped
    expect(container.textContent).not.toContain('Thought for 7s');
    expect(container.textContent).not.toContain('Thinking about orchestrator');

    // Genuine conversational content MUST be preserved and NOT turned into a link
    expect(container.textContent).toContain('Yes, this is far more useful');
    expect(container.textContent).toContain('Layer 0: what this diagram actually shows');
    expect(container.querySelector('.rovo-suggested-prompt')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  test('cleanNoise preserves visualization diagram in tool container and strips "Connecting to visualize..." header', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="tool-use-container">
        <summary class="tool-header">V Connecting to visualize...</summary>
        <div class="widget-view">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Diagram" style="width: 100%; height: auto;" />
        </div>
      </div>
    `;

    window.cleanNoise(container);

    // "Connecting to visualize" header text must be removed
    expect(container.textContent).not.toContain('Connecting to visualize');
    expect(container.textContent.trim()).not.toBe('V');

    // The visual diagram image must be intact
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toContain('data:image/png;base64');
  });

  test('cleanNoise preserves SVG diagrams inside tool-use blocks and removes non-visual tool calls', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="tool-use non-visual-tool" data-testid="tool-search">
        <summary>search_web({"query":"test"})</summary>
        <div class="raw-output">Found 10 results</div>
      </div>
      <div class="tool-use visual-tool" data-testid="tool-visualize">
        <summary>visualize show_widget</summary>
        <div class="chart-container">
          <svg width="400" height="200"><circle cx="50" cy="50" r="40" /></svg>
        </div>
      </div>
    `;

    window.cleanNoise(container);

    // Non-visual tool call must be completely removed
    expect(container.textContent).not.toContain('search_web');
    expect(container.textContent).not.toContain('Found 10 results');

    // Visual tool must preserve the SVG and strip the tool header text
    expect(container.textContent).not.toContain('visualize show_widget');
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.querySelector('circle')).not.toBeNull();
  });

  test('deepCloneWithShadowsAndSvgs converts captured iframe to full-width image replacement', () => {
    eval(contentJsCode + `
      window.deepCloneWithShadowsAndSvgs = deepCloneWithShadowsAndSvgs;
      window.capturedIframes = capturedIframes;
    `);

    const iframe = document.createElement('iframe');
    iframe.src = 'https://artifacts.claude.ai/widget123';
    document.body.appendChild(iframe);

    // Mock captured screenshot in WeakMap
    const testDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    window.capturedIframes.set(iframe, testDataUrl);

    const cloned = window.deepCloneWithShadowsAndSvgs(iframe);
    expect(cloned.tagName.toLowerCase()).toBe('img');
    expect(cloned.src).toBe(testDataUrl);
    expect(cloned.style.width).toBe('100%');
    expect(cloned.style.height).toBe('auto');

    iframe.remove();
  });

  test('classifyTurnRole accurately distinguishes user prompts and assistant responses using multi-signal scoring', () => {
    eval(contentJsCode + `
      window.classifyTurnRole = classifyTurnRole;
    `);

    // 1. Explicit semantic role
    const elUser = document.createElement('div');
    elUser.setAttribute('data-message-author-role', 'user');
    expect(window.classifyTurnRole(elUser, 0, 2)).toBe('user');

    const elAssistant = document.createElement('div');
    elAssistant.setAttribute('data-message-author-role', 'assistant');
    expect(window.classifyTurnRole(elAssistant, 1, 2)).toBe('assistant');

    // 2. Rich markdown fingerprint (code block, table, math)
    const elMarkdown = document.createElement('div');
    elMarkdown.innerHTML = '<h3>Solution</h3><table><tr><th>Col</th></tr></table><pre><code>console.log(1);</code></pre>';
    expect(window.classifyTurnRole(elMarkdown, 0, 1)).toBe('assistant');

    // 3. User query with alignment class
    const elQuery = document.createElement('div');
    elQuery.className = 'flex justify-end self-end query-bubble';
    elQuery.textContent = 'How do I set a sleep timer on Apple TV?';
    expect(window.classifyTurnRole(elQuery, 0, 2)).toBe('user');
  });

  test('getChatMessages extracts conversation from ChatGPT public /share/... pages without article tags', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    // Mock share page DOM structure (no <article> tags, using [data-message-id] or .markdown containers)
    document.body.innerHTML = `
      <div id="__next">
        <main>
          <div data-message-id="msg-1" class="user-turn">
            <div class="whitespace-pre-wrap">How do I set sleep timer on Apple TV?</div>
          </div>
          <div data-message-id="msg-2" class="assistant-turn">
            <div class="markdown">
              <p>To set a sleep timer on Apple TV:</p>
              <ol>
                <li>Press and hold the TV/Control Center button on your Siri Remote.</li>
                <li>Select the Sleep Timer icon and choose 15, 30, or 60 minutes.</li>
              </ol>
            </div>
          </div>
        </main>
      </div>
    `;

    // Set mock share page URL
    delete window.location;
    window.location = new URL('https://chatgpt.com/share/6a8c2cd0-ad7c-83ed-8c35-50633760e67b');

    const messages = await window.getChatMessages('ChatGPT');
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].html).toContain('How do I set sleep timer on Apple TV?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].html).toContain('Press and hold the TV/Control Center button');
  });

  test('getChatMessages extracts from embedded SSR JSON payload on ChatGPT share pages when DOM is deferred', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    const sharePayload = {
      title: "Apple TV Sleep After",
      mapping: {
        "node-1": {
          message: {
            author: { role: "user" },
            content: { parts: ["Can I set Apple TV to sleep after 30 mins?"] }
          }
        },
        "node-2": {
          message: {
            author: { role: "assistant" },
            content: { parts: ["Yes, use the Control Center sleep timer shortcut."] }
          }
        }
      }
    };

    document.body.innerHTML = `
      <script id="client-bootstrap" type="application/json">
        ${JSON.stringify(sharePayload)}
      </script>
      <div id="loading-spinner">Loading conversation...</div>
    `;

    delete window.location;
    window.location = new URL('https://chatgpt.com/share/6a8c2cd0-ad7c-83ed-8c35-50633760e67b');

    const messages = await window.getChatMessages('ChatGPT');
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].html).toContain('Can I set Apple TV to sleep after 30 mins?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].html).toContain('Control Center sleep timer shortcut');
  });

  test('getChatMessages extracts Perplexity query, answer, source cards, and tables', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    document.body.innerHTML = `
      <div class="thread-container">
        <div class="query-block" data-testid="user-query">
          <h1 class="text-textMain">Compare React vs Vue 2026 performance</h1>
        </div>
        <div class="answer-block prose" data-testid="thread-answer">
          <p>Here is a detailed comparison:</p>
          <table>
            <thead><tr><th>Framework</th><th>Bundle Size</th></tr></thead>
            <tbody><tr><td>React</td><td>42kb</td></tr><tr><td>Vue</td><td>33kb</td></tr></tbody>
          </table>
          <div class="source-card">
            <span class="source-title">Framework Benchmarks 2026</span>
          </div>
        </div>
      </div>
    `;

    delete window.location;
    window.location = new URL('https://www.perplexity.ai/search/react-vs-vue');

    const messages = await window.getChatMessages('Perplexity');
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].html).toContain('Compare React vs Vue 2026 performance');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].html).toContain('Framework Benchmarks 2026');
    expect(messages[1].html).toContain('Bundle Size');
  });

  test('extractAdaptiveTurns self-adapts and extracts turns from obfuscated DOM structures', () => {
    eval(contentJsCode + `
      window.extractAdaptiveTurns = extractAdaptiveTurns;
    `);

    const root = document.createElement('div');
    root.innerHTML = `
      <div class="x-obfuscated-container">
        <div class="c_8921a user-message">
          <p>Explain quantum annealing in simple terms</p>
        </div>
        <div class="c_8921b assistant-message prose">
          <p>Quantum annealing is an optimization method that uses quantum fluctuations...</p>
          <pre><code>q = QuantumOptimizer()</code></pre>
        </div>
      </div>
    `;

    const turns = window.extractAdaptiveTurns(root);
    expect(turns.length).toBe(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].contentEl.textContent).toContain('Explain quantum annealing');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].contentEl.textContent).toContain('Quantum annealing is an optimization method');
  });

  test('formatLanguagePills only matches genuine language identifiers and ignores conversational headings', () => {
    eval(contentJsCode + `
      window.formatLanguagePills = formatLanguagePills;
      window.cleanNoise = cleanNoise;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <div>SO THERE IS A MISMATCH:</div>
      <pre><code>Mac (audio) -> Apple TV (idle timer) -> Sleep</code></pre>
      <div class="code-header"><span>python</span></div>
      <pre><code>def test(): pass</code></pre>
    `;

    window.cleanNoise(container);

    // "SO THERE IS A MISMATCH:" must NOT be turned into a code-language-pill
    const mismatchEl = Array.from(container.querySelectorAll('*')).find(el => el.textContent.includes('SO THERE IS A MISMATCH:'));
    expect(mismatchEl.classList.contains('code-language-pill')).toBe(false);

    // "python" MUST be turned into a code-language-pill
    const pythonPill = container.querySelector('.code-language-pill');
    expect(pythonPill).not.toBeNull();
    expect(pythonPill.textContent.trim()).toBe('python');

    // Code blocks must preserve their full text
    expect(container.textContent).toContain('Mac (audio) -> Apple TV (idle timer) -> Sleep');
    expect(container.textContent).toContain('def test(): pass');
  });
  test('cleanNoise preserves code blocks with tailwind composer variables but removes genuine composer containers', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="composer-container">
        <textarea>Write your prompt here...</textarea>
      </div>
      <div class="code-block-wrapper dark:[--code-block-surface:var(--composer-surface-primary)]">
        <pre><code>console.log("Hello");</code></pre>
      </div>
      <div class="PromptContainer">
        <button aria-label="Add sources">Add</button>
      </div>
    `;

    window.cleanNoise(container);

    // Genuine composer containers and prompt inputs should be removed
    expect(container.textContent).not.toContain('Write your prompt here...');
    expect(container.querySelector('.composer-container')).toBeNull();
    expect(container.querySelector('.PromptContainer')).toBeNull();

    // Code blocks with tailwind css variables matching "composer" MUST be preserved
    expect(container.textContent).toContain('console.log("Hello");');
    expect(container.querySelector('pre')).not.toBeNull();
  });
});
