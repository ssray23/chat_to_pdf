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
});
