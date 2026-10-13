const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');
const { htmlToMarkdown, convertChatToMarkdown, postProcessMarkdown } = require('../../../md-converter');

registerRegressionTest({
  id: 'REG-FEATURE-GEMINI-EXPORT',
  type: 'feature',
  description: 'Google Gemini shared chat & web app turn extraction, header cleanup, and role classification',
  suiteFn: () => {}
});

describe('[FEATURE] Gemini Shared & Live Chat Export Regression Suite', () => {
  const contentJsCode = fs.readFileSync(path.join(__dirname, '../../../content.js'), 'utf8');

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('getChatMessages extracts user prompt and assistant model response on Gemini shared pages (<message-content>)', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    // Simulate Gemini share page with <user-query> and <message-content>
    document.body.innerHTML = `
      <div class="chat-history">
        <user-query>
          <h5 class="query-title">when shuud I take it? after my 2 eggs when I breakt my fast</h5>
          <div class="query-text">
            <p>when shuud I take it? after my 2 eggs when I breakt my fast</p>
          </div>
        </user-query>
        <message-content class="model-response-text">
          <div class="markdown">
            <p>It is generally best to take green tea extract with or immediately after your meal (your two eggs) to prevent mild nausea.</p>
          </div>
        </message-content>
      </div>
    `;

    delete window.location;
    window.location = new URL('https://gemini.google.com/share/3e75c8385a2c');

    const messages = await window.getChatMessages('Gemini');
    expect(messages.length).toBe(2);

    // Verify user turn
    expect(messages[0].role).toBe('user');
    expect(messages[0].html).toContain('when shuud I take it? after my 2 eggs when I breakt my fast');
    // Ensure truncated h5 header was stripped from the user query
    expect(messages[0].html).not.toContain('<h5');

    // Verify assistant turn
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].html).toContain('It is generally best to take green tea extract');
  });

  test('extractGeminiShareMessages extracts pairwise turns in exact document order from <share-turn-viewer>', async () => {
    eval(contentJsCode + `
      window.extractGeminiShareMessages = extractGeminiShareMessages;
      window.getChatMessages = getChatMessages;
    `);

    document.body.innerHTML = `
      <share-turn-viewer>
        <div class="share-turn-viewer">
          <user-query>
            <div class="query-text"><p>Turn 1 Question</p></div>
          </user-query>
          <response-container>
            <message-content>
              <div class="markdown"><p>Turn 1 Model Answer</p></div>
            </message-content>
          </response-container>
        </div>
      </share-turn-viewer>
      <share-turn-viewer>
        <div class="share-turn-viewer">
          <user-query>
            <div class="query-text"><p>Turn 2 Question</p></div>
          </user-query>
          <response-container>
            <message-content>
              <div class="markdown"><p>Turn 2 Model Answer</p></div>
            </message-content>
          </response-container>
        </div>
      </share-turn-viewer>
    `;

    delete window.location;
    window.location = new URL('https://gemini.google.com/share/0eNSVxShHb0H');

    const turns = window.extractGeminiShareMessages();
    expect(turns.length).toBe(4);
    expect(turns[0].role).toBe('user');
    expect(turns[0].contentEl.textContent).toContain('Turn 1 Question');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].contentEl.textContent).toContain('Turn 1 Model Answer');
    expect(turns[2].role).toBe('user');
    expect(turns[2].contentEl.textContent).toContain('Turn 2 Question');
    expect(turns[3].role).toBe('assistant');
    expect(turns[3].contentEl.textContent).toContain('Turn 2 Model Answer');

    const messages = await window.getChatMessages('Gemini');
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
    expect(messages[3].role).toBe('assistant');
  });

  test('cleanNoise preserves Gemini message-content when .markdown has aria-live="polite"', () => {
    eval(contentJsCode + `
      window.cleanNoise = cleanNoise;
      window.normalizeGeminiTurn = normalizeGeminiTurn;
      window.deepCloneWithShadowsAndSvgs = deepCloneWithShadowsAndSvgs;
    `);

    const mc = document.createElement('message-content');
    mc.innerHTML = `
      <div class="markdown markdown-main-panel md-content" aria-live="polite">
        <p>8.5 / 10. Straight off the bat, this curry punches well above its weight for fat loss.</p>
      </div>
      <div class="message-actions">
        <button>Copy</button>
      </div>
    `;

    const clone = window.deepCloneWithShadowsAndSvgs(mc);
    window.normalizeGeminiTurn(clone, 'assistant');
    window.cleanNoise(clone);

    expect(clone.textContent).toContain('8.5 / 10. Straight off the bat, this curry punches well above its weight for fat loss.');
    expect(clone.querySelector('button')).toBeNull();
  });

  test('normalizeGeminiTurn strips duplicate truncated h5 preview title on user prompts ending in ellipsis', () => {
    eval(contentJsCode + `
      window.normalizeGeminiTurn = normalizeGeminiTurn;
    `);

    const turn = document.createElement('user-query');
    turn.innerHTML = `
      <h5>By mildly inhibiting aromatase and $5\\alpha$-reductase, it helps keep your own circulating testoster…</h5>
      <div class="query-text">
        <p>By mildly inhibiting aromatase and $5\\alpha$-reductase, it helps keep your own circulating testosterone from being prematurely converted or cleared, - but wehy does this happen - is it normal in a 47 year old asian male (assume I dont take any supplements)</p>
      </div>
    `;

    window.normalizeGeminiTurn(turn, 'user');

    // Truncated preview header should be cleanly removed
    expect(turn.querySelector('h5')).toBeNull();
    // Full user query text must remain intact
    expect(turn.textContent).toContain('By mildly inhibiting aromatase and $5\\alpha$-reductase, it helps keep your own circulating testosterone');
    expect(turn.textContent).toContain('assume I dont take any supplements');
  });

  test('postProcessMarkdown translates LaTeX math with Greek letters into clean Unicode symbols', () => {
    const rawMd = '> ### **By mildly inhibiting aromatase and $5\\alpha$-reductase, it helps keep...**';
    const processed = postProcessMarkdown(rawMd);

    expect(processed).toContain('5α-reductase');
    expect(processed).not.toContain('\\alpha');
    expect(processed).not.toContain('$5\\alpha$');
  });

  test('convertChatToMarkdown produces clean alternating user card and model response for Gemini without duplicate #####', () => {
    const chatData = {
      title: 'Weight Loss Chicken Curry Review',
      platform: 'Gemini',
      messages: [
        {
          role: 'user',
          html: '<div class="query-text"><p>when shuud I take it? after my 2 eggs when I breakt my fast</p></div>'
        },
        {
          role: 'assistant',
          html: '<p>Taking green tea extract with your 2 eggs in EVOO is optimal for fat-soluble absorption.</p>'
        }
      ]
    };

    const result = convertChatToMarkdown(chatData);
    expect(result.markdown).toContain('# Weight Loss Chicken Curry Review');
    expect(result.markdown).toContain('> ### **when shuud I take it? after my 2 eggs when I breakt my fast**');
    expect(result.markdown).not.toContain('##### when shuud I take it?');
    expect(result.markdown).toContain('Taking green tea extract with your 2 eggs in EVOO is optimal');
  });

  test('NON-REGRESSION: ChatGPT, Claude, and Rovo extraction remains completely unaffected', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    // 1. ChatGPT article extraction
    document.body.innerHTML = `
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="user">What is Docker?</div>
      </article>
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" class="markdown">Docker is a platform for containers.</div>
      </article>
    `;
    delete window.location;
    window.location = new URL('https://chatgpt.com/c/chat-123');
    const chatGptMessages = await window.getChatMessages('ChatGPT');
    expect(chatGptMessages.length).toBe(2);
    expect(chatGptMessages[0].role).toBe('user');
    expect(chatGptMessages[1].role).toBe('assistant');

    // 2. Claude message extraction
    document.body.innerHTML = `
      <div class="font-user-message">How does async/await work?</div>
      <div class="font-claude-message">Async/await simplifies Promise chaining.</div>
    `;
    window.location = new URL('https://claude.ai/chat/claude-123');
    const claudeMessages = await window.getChatMessages('Claude');
    expect(claudeMessages.length).toBe(2);
    expect(claudeMessages[0].role).toBe('user');
    expect(claudeMessages[1].role).toBe('assistant');

    // 3. Rovo message extraction
    document.body.innerHTML = `
      <div data-testid="user-message">Show open tickets</div>
      <div data-testid="rovo-message" class="ak-renderer-document">Found 3 open tickets.</div>
    `;
    window.location = new URL('https://company.atlassian.net/jira/rovo');
    const rovoMessages = await window.getChatMessages('Rovo');
    expect(rovoMessages.length).toBe(2);
    expect(rovoMessages[0].role).toBe('user');
    expect(rovoMessages[1].role).toBe('assistant');
  });

  test('getChatMessages extracts 20 questions and 20 answers on live Gemini with single-draft-response-container without Gate 2 violation', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    let chatHtml = '<infinite-scroller class="chat-history">';
    for (let i = 1; i <= 20; i++) {
      chatHtml += `
        <user-query>
          <div class="query-text">Question ${i}: How does nutritional dum cooking work?</div>
        </user-query>
        <response-container class="response-container">
          <div class="response-container-header">
            <div class="draft-picker"><button>View other drafts</button></div>
          </div>
          <div class="single-draft-response-container">
            <message-content>
              <p>Answer ${i}: Dum cooking breaks down collagen into gelatin.</p>
              <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Protein</td><td>35g</td></tr></tbody></table>
            </message-content>
          </div>
          <div class="response-container-footer">
            <div class="message-actions"><button>Copy</button><button>Share</button></div>
          </div>
        </response-container>
      `;
    }
    chatHtml += '</infinite-scroller>';

    document.body.innerHTML = chatHtml;
    delete window.location;
    window.location = new URL('https://gemini.google.com/app/c8427f91');

    const messages = await window.getChatMessages('Gemini');
    expect(messages.length).toBe(40);

    const userMessages = messages.filter(m => m.role === 'user');
    const asstMessages = messages.filter(m => m.role === 'assistant');
    expect(userMessages.length).toBe(20);
    expect(asstMessages.length).toBe(20);

    // Verify draft UI was removed while content and table were preserved
    expect(asstMessages[0].html).toContain('Dum cooking breaks down collagen');
    expect(asstMessages[0].html).toContain('<table>');
    expect(asstMessages[0].html).not.toContain('View other drafts');
    expect(asstMessages[0].html).not.toContain('Copy');
  });

  test('getChatMessages extracts 20 questions and 20 answers on live Gemini with .conversation-container cards and <model-response>', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    let chatHtml = '<infinite-scroller class="chat-history">';
    for (let i = 1; i <= 20; i++) {
      chatHtml += `
        <div class="conversation-container message-actions-hover-boundary turn-content-visibility ng-star-inserted" id="conv-${i}">
          <user-query class="ng-star-inserted">
            <h5>Question ${i}: how will fenugreek extract help?</h5>
            <div class="query-text"><p>Question ${i}: how will fenugreek extract help?</p></div>
          </user-query>
          <model-response class="enable-lr26-response-chrome-updates ng-star-inserted">
            <div>
              <div class="model-title">Gemini said</div>
              <response-container>
                <model-response-content>
                  <structured-content-container>
                    <message-content>
                      <response-element>
                        <p>Answer ${i}: Fenugreek mildly inhibits aromatase and helps keep testosterone circulating.</p>
                        <table><thead><tr><th>Metric</th><th>Result</th></tr></thead><tbody><tr><td>Dosage</td><td>2250mg</td></tr></tbody></table>
                      </response-element>
                    </message-content>
                  </structured-content-container>
                </model-response-content>
                <message-actions><button>Copy</button></message-actions>
              </response-container>
            </div>
          </model-response>
        </div>
      `;
    }
    chatHtml += '</infinite-scroller>';

    document.body.innerHTML = chatHtml;
    delete window.location;
    window.location = new URL('https://gemini.google.com/app/fe76f1294308a0c8');

    const messages = await window.getChatMessages('Gemini');
    expect(messages.length).toBe(40);

    const userMessages = messages.filter(m => m.role === 'user');
    const asstMessages = messages.filter(m => m.role === 'assistant');
    expect(userMessages.length).toBe(20);
    expect(asstMessages.length).toBe(20);

    // Verify user query title h5 was stripped and model response content was extracted
    expect(userMessages[0].html).not.toContain('<h5');
    expect(userMessages[0].html).toContain('how will fenugreek extract help?');
    expect(asstMessages[0].html).toContain('Fenugreek mildly inhibits aromatase');
    expect(asstMessages[0].html).toContain('<table>');
    expect(asstMessages[0].html).not.toContain('Gemini said');
    expect(asstMessages[0].html).not.toContain('Copy');
  });
});
