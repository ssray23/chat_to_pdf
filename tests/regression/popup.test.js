const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../helpers/testRegistry');

registerRegressionTest({
  id: 'REG-POPUP-001',
  type: 'feature',
  description: 'Extension popup platform detection & chat export triggers',
  suiteFn: () => {}
});

describe('Popup Platform Auto-Detection & Messaging Regression Suite', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '../../popup/popup.html'), 'utf8');
  const popupJsCode = fs.readFileSync(path.join(__dirname, '../../popup/popup.js'), 'utf8');

  async function runPopupScriptWithMockTab(tabUrl) {
    document.body.innerHTML = popupHtml;
    chrome.tabs.query.mockResolvedValueOnce([{ id: 100, title: 'Chat Tab', url: tabUrl }]);

    // Execute script logic in fresh DOM context
    eval(`
      (async () => {
        ${popupJsCode.replace("document.addEventListener('DOMContentLoaded', async () => {", "").replace(/\}\);\s*$/, "")}
      })();
    `);

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  test('popup UI components must render correctly', () => {
    document.body.innerHTML = popupHtml;
    expect(document.getElementById('status-card')).not.toBeNull();
    expect(document.getElementById('btn-export')).not.toBeNull();
    expect(document.getElementById('status-title')).not.toBeNull();
  });

  test('auto-detects Claude platform from active tab URL', async () => {
    await runPopupScriptWithMockTab('https://claude.ai/chat/abc');
    expect(document.getElementById('status-title').textContent).toContain('Claude Chat Detected');
    expect(document.getElementById('btn-export').disabled).toBe(false);
  });

  test('auto-detects ChatGPT platform from active tab URL', async () => {
    await runPopupScriptWithMockTab('https://chatgpt.com/c/123');
    expect(document.getElementById('status-title').textContent).toContain('ChatGPT Chat Detected');
    expect(document.getElementById('btn-export').disabled).toBe(false);
  });

  test('auto-detects Gemini platform from active tab URL', async () => {
    await runPopupScriptWithMockTab('https://gemini.google.com/app/xyz');
    expect(document.getElementById('status-title').textContent).toContain('Gemini Chat Detected');
    expect(document.getElementById('btn-export').disabled).toBe(false);
  });

  test('auto-detects Rovo platform from active tab URL', async () => {
    await runPopupScriptWithMockTab('https://mycompany.atlassian.net/jira/rovo');
    expect(document.getElementById('status-title').textContent).toContain('Rovo Chat Detected');
    expect(document.getElementById('btn-export').disabled).toBe(false);
  });

  test('auto-detects Grok platform from active tab URL', async () => {
    await runPopupScriptWithMockTab('https://grok.com/chat/xyz');
    expect(document.getElementById('status-title').textContent).toContain('Grok Chat Detected');
    expect(document.getElementById('btn-export').disabled).toBe(false);
  });

  test('shows error when tab is unsupported URL', async () => {
    await runPopupScriptWithMockTab('https://example.com');
    expect(document.getElementById('status-title').textContent).toBe('Not Supported');
    expect(document.getElementById('btn-export').disabled).toBe(true);
  });
});
