const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../helpers/testRegistry');

registerRegressionTest({
  id: 'REG-PRINT-001',
  type: 'feature',
  description: 'Print tab HTML rendering, prompt headings & storage cleanup',
  suiteFn: () => {}
});

describe('Print Page Document Rendering Regression Suite', () => {
  const printHtml = fs.readFileSync(path.join(__dirname, '../../print.html'), 'utf8');
  const printJsCode = fs.readFileSync(path.join(__dirname, '../../print.js'), 'utf8');

  beforeEach(() => {
    document.body.innerHTML = printHtml;
    window.print = jest.fn();
  });

  test('renders prompt headings and response bodies cleanly from chrome.storage.local', async () => {
    const mockChatData = {
      platform: 'Claude',
      title: 'Quantum Physics Explainer',
      messages: [
        { role: 'user', html: '<p>What is quantum entanglement?</p>' },
        { role: 'assistant', html: '<p>Quantum entanglement occurs when...</p>' }
      ]
    };

    chrome.storage.local.get.mockResolvedValueOnce({ chatData: mockChatData });

    eval(printJsCode);
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(document.getElementById('chat-title').textContent).toBe('Quantum Physics Explainer');
    expect(document.getElementById('chat-platform').textContent).toBe('Claude');

    const threadContainer = document.getElementById('chat-thread');
    const headings = threadContainer.getElementsByClassName('user-prompt-heading');
    const responses = threadContainer.getElementsByClassName('assistant-response-body');

    expect(headings.length).toBe(1);
    expect(responses.length).toBe(1);
    expect(headings[0].innerHTML).toContain('quantum entanglement');
    expect(responses[0].innerHTML).toContain('Quantum entanglement occurs');

    expect(chrome.storage.local.remove).toHaveBeenCalledWith('chatData');
  });

  test('handles missing chat data gracefully', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({});

    eval(printJsCode);
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(document.getElementById('chat-title').textContent).toContain('Error: No chat data found.');
  });
});
