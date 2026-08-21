const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');

registerRegressionTest({
  id: 'REG-FEATURE-ROVO-IMAGE',
  type: 'feature',
  description: 'Rovo chat scraping, media attachment card extraction, background-image handling, and button preservation',
  suiteFn: () => {}
});

describe('[FEATURE] Rovo Pasted Image & Media Card Export Regression Test', () => {
  const contentJsCode = fs.readFileSync(path.join(__dirname, '../../../content.js'), 'utf8');
  const printCss = fs.readFileSync(path.join(__dirname, '../../../print.css'), 'utf8');

  beforeEach(() => {
    // Expose internal functions to global scope for testing
    eval(contentJsCode + `
      window.processImages = processImages;
      window.cleanNoise = cleanNoise;
      window.getChatMessages = getChatMessages;
      window.fetchUrlAsBase64 = fetchUrlAsBase64;
    `);
  });

  test('print.css defines media card and attachment image styles', () => {
    expect(printCss).toMatch(/\.ai-exporter-media-card\s*\{/);
    expect(printCss).toMatch(/\.ai-exporter-attachment-img/);
    expect(printCss).toMatch(/#write\s+\.user-prompt-heading\s+img/);
    expect(printCss).toMatch(/\.ai-exporter-media-caption/);
  });

  test('cleanNoise must preserve buttons and role="button" elements that contain media or image attachments', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="action-btn" class="copy-btn">Copy</button>
      <div role="button" id="card-btn" class="media-card-view" data-testid="media-card-view">
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="image1.png" />
        <span class="file-name">image1.png</span>
      </div>
      <button id="media-btn" class="thumbnail-wrapper">
        <img src="data:image/png;base64,iVBORw0KGgo=" />
      </button>
    `;

    window.cleanNoise(container);

    // Normal action button should be removed
    expect(container.querySelector('#action-btn')).toBeNull();

    // Media card role="button" should be preserved and have role removed
    const card = container.querySelector('#card-btn');
    expect(card).not.toBeNull();
    expect(card.getAttribute('role')).toBeNull();
    expect(card.querySelector('img')).not.toBeNull();

    // Button holding an image should be converted to a div and preserved
    const mediaContainer = container.querySelector('#media-btn');
    expect(mediaContainer).not.toBeNull();
    expect(mediaContainer.tagName.toLowerCase()).toBe('div');
    expect(mediaContainer.querySelector('img')).not.toBeNull();
  });

  test('processImages transforms Atlaskit media cards into clean .ai-exporter-media-card with img and caption', async () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="user-prompt">
        <p>explain this and find related context for this from Holidays space</p>
        <div data-testid="media-file-card-view" class="media-card-view">
          <div class="thumbnail">
            <img src="data:image/png;base64,testimagedata123" alt="image1.png" />
          </div>
          <div class="info">
            <span data-testid="file-name">image1.png</span>
            <span class="badge">PNG</span>
          </div>
        </div>
      </div>
    `;

    await window.processImages(container);

    const mediaCard = container.querySelector('.ai-exporter-media-card');
    expect(mediaCard).not.toBeNull();

    const img = mediaCard.querySelector('img.ai-exporter-attachment-img');
    expect(img).not.toBeNull();
    expect(img.src).toContain('testimagedata123');

    const caption = mediaCard.querySelector('.ai-exporter-media-caption');
    expect(caption).not.toBeNull();
    expect(caption.textContent).toBe('image1.png');
  });

  test('getChatMessages extracts Rovo user prompt with media attachments and assistant response', async () => {
    // Mock Rovo DOM structure
    document.body.innerHTML = `
      <div data-testid="rovo-chat-message-list">
        <div data-testid="user-message" class="user-message-wrapper" style="background-color: rgb(12, 102, 228);">
          <p>explain this and find related context for this from Holidays space</p>
          <div data-testid="media-card-view">
            <img src="data:image/png;base64,userpastedimg" alt="image1.png" />
            <span class="title">image1.png</span>
          </div>
        </div>
        <div data-testid="rovo-message" class="rovo-response-wrapper">
          <div class="ak-renderer-document">
            <h3>Explanation</h3>
            <p>This is a screenshot from the Confluence page Server-Side Caching.</p>
          </div>
        </div>
      </div>
    `;

    const messages = await window.getChatMessages('Rovo');
    expect(messages.length).toBe(2);

    expect(messages[0].role).toBe('user');
    expect(messages[0].html).toContain('explain this');
    expect(messages[0].html).toContain('userpastedimg');

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].html).toContain('Explanation');
    expect(messages[1].html).toContain('Server-Side Caching');
  });

  test('normalizeSmartLinksAndLists transforms Jira & Confluence links into authentic smart chips and removes stray checkboxes', () => {
    eval(contentJsCode + `
      window.normalizeSmartLinksAndLists = normalizeSmartLinksAndLists;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <p>Related Jira tickets (Holidays - DevOps):</p>
      <p>☑</p>
      <ul>
        <li><a href="https://mycompany.atlassian.net/browse/DO-1515">DO-1515: Tune caching settings for Web FrontendDone</a> — Tune caching settings for Web Frontend <span class="lozenge">Done</span></li>
      </ul>
      <p>☑</p>
      <ul>
        <li><a href="https://mycompany.atlassian.net/browse/DO-1547">DO-1547: Add x-nextjs-cache response header to the Web access logsDone</a></li>
        <li><a href="https://mycompany.atlassian.net/wiki/123">🗎Server-Side Caching: To-Be (Contentful) Architecture</a> — the full source page</li>
      </ul>
      <p>14 Issues</p>
    `;

    window.normalizeSmartLinksAndLists(container);

    // Stray checkbox paragraphs must be removed
    const paragraphs = Array.from(container.querySelectorAll('p')).map(p => p.textContent.trim());
    expect(paragraphs).not.toContain('☑');

    // Smart chips must be created
    const chips = container.querySelectorAll('.atlassian-smart-chip');
    expect(chips.length).toBe(3);

    // Jira smart chip check
    const jiraChip = chips[0];
    expect(jiraChip.querySelector('.smart-chip-icon').textContent).toBe('☑');
    expect(jiraChip.querySelector('.smart-chip-title').textContent).toBe('DO-1515: Tune caching settings for Web Frontend');
    expect(jiraChip.querySelector('.smart-chip-lozenge').textContent).toBe('Done');

    // Confluence smart chip check
    const confChip = chips[2];
    expect(confChip.querySelector('.smart-chip-icon').textContent).toBe('🗎');
    expect(confChip.querySelector('.smart-chip-title').textContent).toBe('Server-Side Caching: To-Be (Contentful) Architecture');

    // Summary chip check
    const summaryChip = container.querySelector('.atlassian-issues-summary-chip');
    expect(summaryChip).not.toBeNull();
    expect(summaryChip.textContent).toContain('14 Issues');
  });

  test('cleanNoise and normalizeSmartLinksAndLists preserve Rovo follow-up prompts and sources pill', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
      window.normalizeSmartLinksAndLists = normalizeSmartLinksAndLists;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <p>If you want, I can:</p>
      <button class="followup-btn" data-testid="suggested-prompt-0">
        ↳ Read the full Confluence page for more detail on the circuit breaker design
      </button>
      <button class="followup-btn" data-testid="suggested-prompt-1">
        ↳ Search for any open Jira work related to implementing this caching architecture
      </button>
      <button class="sources-btn" data-testid="sources-button">
        <svg class="confluence-icon"><path d="M0 0h24v24H0z"/></svg>
        <svg class="jira-icon"><path d="M0 0h24v24H0z"/></svg>
        <span>10 Sources</span>
      </button>
      <button class="feedback-action">↳ Good response</button>
      <button class="debug-action">↳ Debug response</button>
      <button class="copy-btn">Copy</button>
      <button class="feedback-btn">+Add</button>
    `;

    window.cleanNoise(container);
    window.normalizeSmartLinksAndLists(container);

    // Action buttons (+Add, Copy, Good response, Debug response) must be removed
    expect(container.querySelector('.copy-btn')).toBeNull();
    expect(container.querySelector('.feedback-btn')).toBeNull();
    expect(container.querySelector('.feedback-action')).toBeNull();
    expect(container.querySelector('.debug-action')).toBeNull();
    expect(container.textContent).not.toContain('Good response');
    expect(container.textContent).not.toContain('Debug response');

    // Suggested prompts must be converted into .rovo-suggested-prompt
    const prompts = container.querySelectorAll('.rovo-suggested-prompt');
    expect(prompts.length).toBe(2);
    expect(prompts[0].textContent).toContain('Read the full Confluence page');
    expect(prompts[1].textContent).toContain('Search for any open Jira work');

    // Sources pill must be preserved as .atlassian-sources-pill with SVGs
    const sourcesPill = container.querySelector('.atlassian-sources-pill');
    expect(sourcesPill).not.toBeNull();
    expect(sourcesPill.textContent).toContain('10 Sources');
    expect(sourcesPill.querySelectorAll('svg').length).toBe(2);
  });

  test('normalizeSmartLinksAndLists merges split numbered lists separated by descriptive paragraphs', () => {
    eval(contentJsCode + `
      window.normalizeSmartLinksAndLists = normalizeSmartLinksAndLists;
    `);

    const container = document.createElement('div');
    container.innerHTML = `
      <ol>
        <li><p><strong>CMS content (text, structured data)</strong></p></li>
      </ol>
      <p>Pages, copy, layout configurations — anything authored in Contentful.</p>
      <ol start="2">
        <li><p><strong>Rendered web pages</strong></p></li>
      </ol>
      <p>The Next.js frontend pre-renders pages server-side.</p>
      <p><br></p>
      <p>&nbsp;</p>
    `;

    window.normalizeSmartLinksAndLists(container);

    // Empty/spacer paragraphs must be removed
    const allParagraphs = Array.from(container.querySelectorAll('p')).map(p => p.textContent.trim()).filter(Boolean);
    expect(allParagraphs).not.toContain('');

    // The two separate <ol> lists must be merged into 1 continuous list
    const lists = container.querySelectorAll('ol');
    expect(lists.length).toBe(1);

    const items = lists[0].querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('CMS content');
    expect(items[0].textContent).toContain('Pages, copy, layout configurations');
    expect(items[1].textContent).toContain('Rendered web pages');
  });

  test('getChatMessages accurately classifies blue bubble turns as user prompts and subsequent answers as assistant', async () => {
    document.body.innerHTML = `
      <div data-testid="rovo-message" class="rovo-assistant-turn">
        <p>In short: it's less about photos...</p>
        <button>↳ Look up any incidents</button>
      </div>
      <div data-testid="user-message" style="background-color: rgb(12, 102, 228); color: rgb(255, 255, 255);">
        <ol>
          <li><strong>CMS content (text, structured data)</strong></li>
        </ol>
        <p>Pages, copy, layout configurations...</p>
        <ol start="2">
          <li><strong>Rendered web pages</strong></li>
        </ol>
        <p>The Next.js frontend pre-renders pages server-side. //// explain this more...</p>
      </div>
      <div data-testid="rovo-message" class="rovo-assistant-turn">
        <p>Great question. Let me walk through it as a real user journey.</p>
        <h2>When you visit easyjet.com/holidays and search</h2>
        <h3>Step 1 — You land on the page</h3>
        <p>Your browser requests the Holidays homepage...</p>
      </div>
    `;

    const messages = await window.getChatMessages('Rovo');
    expect(messages.length).toBe(3);

    // First turn: Assistant
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].html).toContain("less about photos");

    // Second turn: User (the blue bubble prompt)
    expect(messages[1].role).toBe('user');
    expect(messages[1].html).toContain('CMS content');
    expect(messages[1].html).toContain('Rendered web pages');
    expect(messages[1].html).toContain('explain this more');

    // Third turn: Assistant
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].html).toContain('Great question');
    expect(messages[2].html).toContain('When you visit easyjet.com/holidays');
  });

  test('NON-REGRESSION: cleanNoise must never strip legitimate conversational body content or produce blank preview', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="assistant-response-body">
        <p>In short: it's less about photos and more about protecting the site from going down when Contentful is slow or rate-limited.</p>
        <p>If you want, I can:</p>
        <ul>
          <li><span>Find the full circuit breaker design details on the source Confluence page</span></li>
          <li><span>Look up any incidents or Jira bugs related to Contentful rate limit breaches</span></li>
        </ul>
        <pre><code class="language-js">console.log("cached response");</code></pre>
        <button class="action-btn">Copy</button>
        <button class="feedback-action">↳ Good response</button>
        <div class="composer-toolbar">
          <textarea placeholder="Describe what you want to know"></textarea>
          <button>+Add</button>
          <button>Auto</button>
        </div>
      </div>
    `;

    window.cleanNoise(container);

    // Essential text content MUST be preserved and NOT stripped
    expect(container.textContent).toContain("In short: it's less about photos");
    expect(container.textContent).toContain("circuit breaker design details");
    expect(container.textContent).toContain('console.log("cached response")');

    // Feedback actions and copy buttons must be gone
    expect(container.querySelector('.action-btn')).toBeNull();
    expect(container.querySelector('.feedback-action')).toBeNull();
    expect(container.textContent).not.toContain('Good response');
  });

  test('print.css defines .user-prompt-card with background exemption and left accent border', () => {
    expect(printCss).toMatch(/\.user-prompt-card/);
    expect(printCss).toMatch(/border-left:\s*4px\s+solid\s+#0c66e4/);
    expect(printCss).toMatch(/#write\s+\.user-prompt-card/);
  });
});
