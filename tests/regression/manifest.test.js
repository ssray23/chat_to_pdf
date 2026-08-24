const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../helpers/testRegistry');

registerRegressionTest({
  id: 'REG-MANIFEST-001',
  type: 'feature',
  description: 'Manifest V3 configuration & permission validation',
  suiteFn: () => {
    // Registered test suite logic executed below
  }
});

describe('Manifest V3 Schema & Permissions Regression Suite', () => {
  let manifest;
  const manifestPath = path.join(__dirname, '../../manifest.json');

  beforeAll(() => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  });

  test('manifest.json must exist and be valid Manifest V3', () => {
    expect(manifest).toBeDefined();
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('AI Chat PDF Exporter');
    expect(manifest.version).toBe('1.2.0');
  });

  test('must specify required permissions (storage, activeTab, scripting)', () => {
    const requiredPermissions = ['storage', 'activeTab', 'scripting'];
    requiredPermissions.forEach(perm => {
      expect(manifest.permissions).toContain(perm);
    });
  });

  test('must include host permissions for Claude, ChatGPT, Gemini, Perplexity, Grok, and Rovo', () => {
    const expectedHosts = [
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
      'https://grok.com/*',
      'https://*.perplexity.ai/*',
      'https://*.atlassian.net/*'
    ];
    expectedHosts.forEach(host => {
      expect(manifest.host_permissions).toContain(host);
    });
  });

  test('content scripts must target matching domains and include content.js', () => {
    expect(manifest.content_scripts).toBeDefined();
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
    const primaryScript = manifest.content_scripts[0];
    expect(primaryScript.js).toContain('content.js');
    expect(primaryScript.run_at).toBe('document_idle');
  });

  test('popup popup/popup.html must exist', () => {
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    const popupHtmlPath = path.join(__dirname, '../../', manifest.action.default_popup);
    expect(fs.existsSync(popupHtmlPath)).toBe(true);
  });

  test('referenced icon files must exist on disk', () => {
    Object.values(manifest.icons).forEach(iconPath => {
      const fullPath = path.join(__dirname, '../../', iconPath);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });
});
