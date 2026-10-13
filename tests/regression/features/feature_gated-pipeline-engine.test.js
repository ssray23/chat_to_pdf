const fs = require('fs');
const path = require('path');
const { registerRegressionTest } = require('../../helpers/testRegistry');
const { convertChatToMarkdown } = require('../../../md-converter');

registerRegressionTest({
  id: 'REG-FEATURE-GATED-PIPELINE',
  type: 'feature',
  description: 'Comprehensive 3-stage gated AI chat engine with mount sweep, element inventory, and markdown handover gates',
  suiteFn: () => {}
});

describe('[FEATURE] Gated AI Chat Pipeline Architecture Regression Suite', () => {
  const contentJsCode = fs.readFileSync(path.join(__dirname, '../../../content.js'), 'utf8');

  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.location;
    window.location = new URL('https://chatgpt.com/c/test-chat-123');
  });

  test('Stage 1 (ChatMountEngine) runs sweep, captures scroll offsets, and passes Gate 1', async () => {
    eval(contentJsCode + `
      window.ChatMountEngine = ChatMountEngine;
    `);

    document.body.innerHTML = `
      <div id="chat-container" style="overflow-y: scroll; height: 300px;">
        <article><p>Hello AI</p></article>
      </div>
    `;

    const mountEngine = new window.ChatMountEngine({ stepDelayMs: 1, initialTopDelayMs: 1 });
    const result = await mountEngine.sweep();

    expect(result.success).toBe(true);
    expect(result.gate1.passed).toBe(true);
  });

  test('Stage 2 (ChatInventoryEngine) catalogs questions, responses, tables, code blocks and passes Gate 2', async () => {
    eval(contentJsCode + `
      window.ChatInventoryEngine = ChatInventoryEngine;
      window.getChatMessages = getChatMessages;
    `);

    document.body.innerHTML = `
      <article data-testid="conversation-turn-0">
        <div data-message-author-role="user">
          <p>Can you show me a summary table and sample python script?</p>
        </div>
      </article>
      <article data-testid="conversation-turn-1">
        <div data-message-author-role="assistant" class="markdown">
          <p>Here is the table:</p>
          <table>
            <thead><tr><th>Metric</th><th>Value</th></tr></thead>
            <tbody><tr><td>Accuracy</td><td>98.5%</td></tr></tbody>
          </table>
          <p>And here is the code:</p>
          <pre><code class="language-python">def train(): pass</code></pre>
        </div>
      </article>
    `;

    const inventoryEngine = new window.ChatInventoryEngine();
    const invRes = await inventoryEngine.inspect('ChatGPT');

    expect(invRes.success).toBe(true);
    expect(invRes.gate2.passed).toBe(true);
    expect(invRes.stats.userCount).toBe(1);
    expect(invRes.stats.asstCount).toBe(1);
    expect(invRes.stats.tables).toBe(1);
    expect(invRes.stats.codeBlocks).toBe(1);
    expect(invRes.turns.length).toBe(2);

    expect(invRes.turns[0].role).toBe('user');
    expect(invRes.turns[1].role).toBe('assistant');
    expect(invRes.turns[1].components.tablesCount).toBe(1);
    expect(invRes.turns[1].components.codeBlocksCount).toBe(1);
  });

  test('Gate 2 intercepts and blocks export when questions exist but model responses are missing (anti-8KB guard)', async () => {
    eval(contentJsCode + `
      window.ChatInventoryEngine = ChatInventoryEngine;
    `);

    // Simulate scenario where DOM only has user prompt cards (assistant was stripped or failed to mount)
    document.body.innerHTML = `
      <article><div data-message-author-role="user"><p>Question 1</p></div></article>
      <article><div data-message-author-role="user"><p>Question 2</p></div></article>
      <article><div data-message-author-role="user"><p>Question 3</p></div></article>
    `;

    const inventoryEngine = new window.ChatInventoryEngine();
    await expect(inventoryEngine.inspect('ChatGPT')).rejects.toThrow(
      /Gate 2 Integrity Violation: Found 3 user questions but 0 assistant responses/
    );
  });

  test('Gate 3 intercepts and blocks Markdown generation if handed question-only payload', () => {
    const corruptChatData = {
      platform: 'Gemini',
      title: 'Corrupted Chat',
      messages: [
        { role: 'user', html: '<p>Prompt 1</p>' },
        { role: 'user', html: '<p>Prompt 2</p>' }
      ]
    };

    expect(() => {
      convertChatToMarkdown(corruptChatData);
    }).toThrow(/Gate 3 Quality Violation: Document contains 2 user questions but 0 assistant responses/);
  });

  test('End-to-End Gated Pipeline: successfully executes Stages 1-3 producing high-fidelity markdown with prompt card and components', async () => {
    eval(contentJsCode + `
      window.getChatMessages = getChatMessages;
    `);

    document.body.innerHTML = `
      <article><div data-message-author-role="user"><p>What are the key ingredients?</p></div></article>
      <article><div data-message-author-role="assistant" class="markdown">
        <p>The key ingredients are:</p>
        <table>
          <thead><tr><th>Ingredient</th><th>Qty</th></tr></thead>
          <tbody><tr><td>Fenugreek seeds</td><td>1 tsp</td></tr></tbody>
        </table>
      </div></article>
    `;

    const messages = await window.getChatMessages('ChatGPT');
    expect(messages.length).toBe(2);

    const result = convertChatToMarkdown({
      platform: 'ChatGPT',
      title: 'Recipe Ingredients',
      messages
    });

    expect(result.markdown).toContain('> ### **What are the key ingredients?**');
    expect(result.markdown).toContain('| Ingredient | Qty |');
    expect(result.markdown).toContain('| Fenugreek seeds | 1 tsp |');
    expect(result.filename).toBe('Recipe_Ingredients.md');
  });

  test('Stage 2 Interstitial Auto-Recovery self-heals when initial query only yields user questions', async () => {
    eval(contentJsCode + `
      window.ChatInventoryEngine = ChatInventoryEngine;
      window.getChatMessages = getChatMessages;
    `);

    // Simulate scenario where primary query only matched user questions, but assistant responses are in interstitial DOM
    document.body.innerHTML = `
      <div class="chat-thread">
        <user-query><p>What is fenugreek good for?</p></user-query>
        <div class="unclassed-response-container">
          <div class="markdown"><p>Fenugreek has several metabolic benefits and can help with glucose regulation.</p></div>
        </div>
        <user-query><p>Can I take 500mg daily?</p></user-query>
        <div class="unclassed-response-container">
          <div class="markdown"><p>Yes, standard clinical dosages typically range from 500mg to 1000mg.</p></div>
        </div>
      </div>
    `;

    delete window.location;
    window.location = new URL('https://gemini.google.com/app/chat-123');

    const inventoryEngine = new window.ChatInventoryEngine();
    const invRes = await inventoryEngine.inspect('Gemini');

    expect(invRes.success).toBe(true);
    expect(invRes.gate2.passed).toBe(true);
    expect(invRes.stats.userCount).toBe(2);
    expect(invRes.stats.asstCount).toBe(2);
    expect(invRes.turns.length).toBe(4);
    expect(invRes.turns[0].role).toBe('user');
    expect(invRes.turns[1].role).toBe('assistant');
    expect(invRes.turns[2].role).toBe('user');
    expect(invRes.turns[3].role).toBe('assistant');
  });

  test('Stage 2 extracts live ChatGPT conversation turns even when author role attributes are absent and messages are inside main (.whitespace-pre-wrap and .markdown)', async () => {
    eval(contentJsCode + `
      window.ChatInventoryEngine = ChatInventoryEngine;
      window.getChatMessages = getChatMessages;
    `);

    // Simulate modern ChatGPT layout where articles have no author role, or messages are within main without data-message-author-role
    document.body.innerHTML = `
      <main>
        <div class="group/conversation-turn" data-testid="conversation-turn-2">
          <div class="whitespace-pre-wrap">Can you show me the chicken curry recipe?</div>
        </div>
        <div class="group/conversation-turn" data-testid="conversation-turn-3">
          <div class="markdown prose">
            <h3>Tamarind Chicken Curry</h3>
            <p>Here are the steps to make delicious curry.</p>
          </div>
        </div>
      </main>
    `;

    delete window.location;
    window.location = new URL('https://chatgpt.com/c/6ace682e-97fc-83ed-8598-03ef218df8a9');

    const inventoryEngine = new window.ChatInventoryEngine();
    const invRes = await inventoryEngine.inspect('ChatGPT');

    expect(invRes.success).toBe(true);
    expect(invRes.gate2.passed).toBe(true);
    expect(invRes.stats.userCount).toBe(1);
    expect(invRes.stats.asstCount).toBe(1);
    expect(invRes.turns.length).toBe(2);
    expect(invRes.turns[0].role).toBe('user');
    expect(invRes.turns[1].role).toBe('assistant');
  });
});

