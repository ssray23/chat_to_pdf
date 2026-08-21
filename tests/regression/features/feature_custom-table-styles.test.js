const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');

/**
 * Dynamic Regression Test for FEATURE: custom-table-styles
 * ID: REG-FEATURE-615846
 */

registerRegressionTest({
  id: 'REG-FEATURE-615846',
  type: 'feature',
  description: 'Light gray header fill, compact padding, 0.85rem table font size, and corrected zebra striping',
  suiteFn: () => {}
});

describe('[FEATURE] custom-table-styles Regression Test', () => {
  const cleanCompactCss = fs.readFileSync(path.join(__dirname, '../../../clean-compact.css'), 'utf8');
  const printCss = fs.readFileSync(path.join(__dirname, '../../../print.css'), 'utf8');
  const printJsCode = fs.readFileSync(path.join(__dirname, '../../../print.js'), 'utf8');
  const printHtml = fs.readFileSync(path.join(__dirname, '../../../print.html'), 'utf8');

  test('clean-compact.css defines light gray header, compact padding, 0.85rem table font size, and tbody zebra striping', () => {
    expect(cleanCompactCss).toMatch(/#write\s+th\s*\{[^}]*background:\s*var\(--bg-tertiary\);/);
    expect(cleanCompactCss).toMatch(/padding:\s*0\.35rem\s+0\.65rem;/);
    expect(cleanCompactCss).toMatch(/font-size:\s*0\.85rem;/);
    expect(cleanCompactCss).toMatch(/#write\s+th\s+p,\s*#write\s+td\s+p/);
    expect(cleanCompactCss).toMatch(/#write\s+tbody\s+tr:nth-child\(even\)/);
    expect(cleanCompactCss).toMatch(/#write\s+tbody\s+tr:nth-child\(odd\)/);
  });

  test('print.css defines light gray header, compact padding, 0.85rem table font size, and tbody zebra striping in main and print media', () => {
    expect(printCss).toMatch(/#write\s+th\s*\{[^}]*background-color:\s*#f5f5f5\s*!important;/);
    expect(printCss).toMatch(/padding:\s*0\.35rem\s+0\.65rem\s*!important;/);
    expect(printCss).toMatch(/font-size:\s*0\.85rem\s*!important;/);
    expect(printCss).toMatch(/#write\s+th\s+p,\s*#write\s+td\s+p/);
    expect(printCss).toMatch(/#write\s+tbody\s+tr:nth-child\(even\)/);
    expect(printCss).toMatch(/#write\s+tbody\s+tr:nth-child\(odd\)/);
  });

  test('print.js normalizes flat tables into thead and tbody so zebra striping starts cleanly at data row 1', async () => {
    document.body.innerHTML = printHtml;
    window.print = jest.fn();

    const flatTableHtml = `
      <table>
        <tr><th>Scenario</th><th>Current mitigation</th></tr>
        <tr><td>Row 1</td><td>Action 1</td></tr>
        <tr><td>Row 2</td><td>Action 2</td></tr>
        <tr><td>Row 3</td><td>Action 3</td></tr>
      </table>
    `;

    const mockChatData = {
      platform: 'ChatGPT',
      title: 'Table Test',
      messages: [
        { role: 'assistant', html: flatTableHtml }
      ]
    };

    chrome.storage.local.get.mockResolvedValueOnce({ chatData: mockChatData });

    eval(printJsCode);
    document.dispatchEvent(new Event('DOMContentLoaded'));

    await new Promise(resolve => setTimeout(resolve, 50));

    const threadContainer = document.getElementById('chat-thread');
    const table = threadContainer.querySelector('table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    expect(thead).not.toBeNull();
    expect(thead.querySelectorAll('tr').length).toBe(1);
    expect(thead.querySelectorAll('th').length).toBe(2);

    expect(tbody).not.toBeNull();
    expect(tbody.querySelectorAll('tr').length).toBe(3);
    expect(tbody.querySelectorAll('tr')[0].querySelectorAll('td')[0].textContent).toBe('Row 1');
  });
});
