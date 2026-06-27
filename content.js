// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'export_chat') {
    (async () => {
      try {
        const messages = await getChatMessages(message.platform);
        const mathStylesheets = getPageStylesheets();
        sendResponse({ success: true, messages, mathStylesheets });
      } catch (err) {
        console.error('AI Chat PDF Exporter Scrape Error:', err);
        sendResponse({ success: false, error: err.message || 'Scrape failed' });
      }
    })();
    return true; // Keep message channel open for async response
  }
});

// Helper to scan page for KaTeX, MathJax, or font stylesheets
function getPageStylesheets() {
  const links = [];
  const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
  stylesheets.forEach(link => {
    if (link.href && (link.href.includes('katex') || link.href.includes('mathjax') || link.href.includes('fonts.googleapis.com'))) {
      links.push(link.href);
    }
  });
  return links;
}

// Convert image to base64 Data URL
async function imgToBase64(img) {
  if (!img.src) return '';
  if (img.src.startsWith('data:')) return img.src;

  // 1. Try canvas drawing if image is fully loaded
  try {
    if (img.complete && img.naturalWidth) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    }
  } catch (e) {
    console.warn('Canvas export failed, falling back to fetch:', img.src, e);
  }

  // 2. Fallback to fetching blob (handles CORS if permitted by browser)
  try {
    const res = await fetch(img.src);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(img.src);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to convert image to base64:', img.src, e);
    return img.src; // Keep original URL as final fallback
  }
}

// Process images inside container
async function processImages(containerEl) {
  const imgs = containerEl.querySelectorAll('img');
  const promises = Array.from(imgs).map(async (img) => {
    const base64 = await imgToBase64(img);
    if (base64) {
      img.src = base64;
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  });
  await Promise.all(promises);
}

// Convert canvas elements to static image elements
function convertCanvasToImg(containerEl) {
  const canvases = containerEl.querySelectorAll('canvas');
  canvases.forEach(canvas => {
    try {
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.style.cssText = canvas.style.cssText;
      img.className = canvas.className;
      img.width = canvas.width || canvas.clientWidth;
      img.height = canvas.height || canvas.clientHeight;
      canvas.replaceWith(img);
    } catch (e) {
      console.warn('Failed to convert canvas to image:', e);
    }
  });
}

// Clean UI noise (buttons, icons, action rows)
function cleanNoise(clone) {
  // Remove buttons
  clone.querySelectorAll('button, [role="button"]').forEach(el => el.remove());
  
  // Remove platform-specific layout controls
  const noiseSelectors = [
    // ChatGPT
    '.flex.justify-between.lg\\:rect',
    '.self-end',
    '.text-token-text-secondary',
    'svg.icon-md',
    '.feedback-button',
    // Claude
    '.flex.gap-1.items-center',
    '[class*="thumbs-down"]',
    '[class*="copy-button"]',
    '.chat-actions',
    // Gemini
    '.message-actions',
    'button-row',
    '.action-row',
    '.action-area'
  ];

  noiseSelectors.forEach(selector => {
    try {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    } catch (e) {}
  });

  // Remove copy buttons from inside pre blocks
  clone.querySelectorAll('pre').forEach(pre => {
    pre.querySelectorAll('button, .copy-code-button, [class*="copy"]').forEach(el => el.remove());
  });
}

// Helper to filter out nested child elements of the same selector list
function getUniqueElements(elements) {
  const arr = Array.from(elements);
  return arr.filter(el => {
    let parent = el.parentElement;
    while (parent) {
      if (arr.includes(parent)) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
}

// Scrape chat messages by platform
async function getChatMessages(platform) {
  const messages = [];
  const url = window.location.href;

  if (platform === 'ChatGPT' || url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
    const articles = document.querySelectorAll('article');
    for (const article of articles) {
      const isUser = article.querySelector('[data-message-author-role="user"]') !== null;
      const isAssistant = article.querySelector('[data-message-author-role="assistant"]') !== null;
      
      let role = null;
      let contentEl = null;

      if (isUser) {
        role = 'user';
        contentEl = article.querySelector('[data-message-author-role="user"]') || article.querySelector('.whitespace-pre-wrap');
      } else if (isAssistant) {
        role = 'assistant';
        contentEl = article.querySelector('.markdown') || article.querySelector('[data-message-author-role="assistant"]');
      }

      if (role && contentEl) {
        const clone = contentEl.cloneNode(true);
        cleanNoise(clone);
        convertCanvasToImg(clone);
        await processImages(clone);
        messages.push({ role, html: clone.innerHTML });
      }
    }
  } else if (platform === 'Claude' || url.includes('claude.ai')) {
    // Ultra-robust Claude selector matching all typical message container variations
    const rawElements = document.querySelectorAll(
      '.font-user-message, .font-claude-message, [data-testid="user-message"], [data-testid="assistant-message"], ' +
      'div[class*="font-user"], div[class*="font-claude"], div[class*="user-message"], div[class*="claude-message"], ' +
      'div[class*="assistant-message"], .user-message, .claude-message'
    );
    const turns = getUniqueElements(rawElements);

    for (const turn of turns) {
      let role = null;
      const className = turn.className && typeof turn.className === 'string' ? turn.className : '';
      const testId = turn.getAttribute('data-testid') || '';

      // Check if it belongs to User
      if (
        className.includes('user') || 
        testId.includes('user') || 
        turn.querySelector('.font-user-message') ||
        turn.closest('.font-user-message')
      ) {
        role = 'user';
      } else {
        role = 'assistant';
      }

      const clone = turn.cloneNode(true);
      cleanNoise(clone);
      convertCanvasToImg(clone);
      await processImages(clone);
      messages.push({ role, html: clone.innerHTML });
    }
  } else if (platform === 'Gemini' || url.includes('gemini.google.com')) {
    const rawElements = document.querySelectorAll(
      'user-query, model-response, .query-text-container, .model-response-container, ' +
      'div[class*="query"], div[class*="response"], div[class*="message-content"]'
    );
    const elements = getUniqueElements(rawElements);

    for (const el of elements) {
      let role = null;
      let contentEl = el;
      const tagName = el.tagName.toLowerCase();
      const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';

      if (tagName === 'user-query' || className.includes('query')) {
        role = 'user';
        contentEl = el.querySelector('.query-text') || el;
      } else {
        role = 'assistant';
        contentEl = el.querySelector('.message-content') || el;
      }

      const clone = contentEl.cloneNode(true);
      cleanNoise(clone);
      convertCanvasToImg(clone);
      await processImages(clone);
      messages.push({ role, html: clone.innerHTML });
    }
  } else if (platform === 'Grok' || url.includes('grok.com') || url.includes('x.com')) {
    const rawElements = document.querySelectorAll(
      'div[class*="message" i], div[class*="bubble" i], div[class*="chat-turn" i], div[data-testid*="message" i]'
    );
    const messageContainers = getUniqueElements(rawElements);

    for (const el of messageContainers) {
      let role = null;
      const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';

      if (className.includes('user') || className.includes('sent') || el.querySelector('[class*="user" i]')) {
        role = 'user';
      } else if (className.includes('assistant') || className.includes('grok') || className.includes('bot') || className.includes('received')) {
        role = 'assistant';
      }

      if (role) {
        const clone = el.cloneNode(true);
        cleanNoise(clone);
        convertCanvasToImg(clone);
        await processImages(clone);
        messages.push({ role, html: clone.innerHTML });
      }
    }
  }

  // Final Heuristic Fallback in case platform parsing failed completely
  if (messages.length === 0) {
    console.log('No messages found with primary platform selectors. Using generic fallback...');
    const rawElements = document.querySelectorAll('[class*="message" i], [class*="chat-turn" i], [class*="bubble" i], [data-testid*="message" i]');
    const chatEls = getUniqueElements(rawElements);

    for (const el of chatEls) {
      let role = 'assistant';
      const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (className.includes('user') || className.includes('sent') || className.includes('query')) {
        role = 'user';
      }

      const clone = el.cloneNode(true);
      cleanNoise(clone);
      convertCanvasToImg(clone);
      await processImages(clone);
      messages.push({ role, html: clone.innerHTML });
    }
  }

  return messages;
}
