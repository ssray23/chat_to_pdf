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

const capturedIframes = new WeakMap();

// Hide fixed and sticky overlays before taking screenshot
function hideOverlays() {
  const hidden = [];
  const elements = document.querySelectorAll('header, footer, div, form, fieldset');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const pos = window.getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      hidden.push({ el, orig: el.style.visibility });
      el.style.visibility = 'hidden';
    }
  }
  return hidden;
}

function restoreOverlays(hidden) {
  for (const item of hidden) {
    item.el.style.visibility = item.orig;
  }
}

// Save scroll position of all elements
function saveScrollPositions() {
  const scrollPositions = new Map();
  scrollPositions.set(window, { x: window.scrollX, y: window.scrollY });
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      scrollPositions.set(el, { x: el.scrollLeft, y: el.scrollTop });
    }
  }
  return scrollPositions;
}

function restoreScrollPositions(scrollPositions) {
  for (const [el, pos] of scrollPositions.entries()) {
    if (el === window) {
      window.scrollTo(pos.x, pos.y);
    } else {
      el.scrollLeft = pos.x;
      el.scrollTop = pos.y;
    }
  }
}

// Find and capture screenshots of cross-origin widget iframes before cloning
async function captureCrossoriginIframes() {
  const iframes = document.querySelectorAll('iframe');
  let hasCrossoriginIframes = false;
  for (const iframe of iframes) {
    if (iframe.src && (iframe.src.includes('claudemcpcontent.com') || iframe.src.includes('claudeusercontent.com'))) {
      hasCrossoriginIframes = true;
      break;
    }
  }
  
  if (!hasCrossoriginIframes) return;

  const hiddenOverlays = hideOverlays();
  const scrollPositions = saveScrollPositions();

  for (const iframe of iframes) {
    if (iframe.src && (iframe.src.includes('claudemcpcontent.com') || iframe.src.includes('claudeusercontent.com'))) {
      const origTransform = iframe.style.transform;
      const origTransformOrigin = iframe.style.transformOrigin;
      let scaled = false;
      let scale = 1;

      // If the iframe is taller or wider than the viewport, scale it down so it fits in a single screenshot
      const initialRect = iframe.getBoundingClientRect();
      const maxW = window.innerWidth;
      const maxH = window.innerHeight;
      
      if (initialRect.height > maxH) scale = maxH / initialRect.height;
      if (initialRect.width * scale > maxW) scale = Math.min(scale, maxW / initialRect.width);
      
      if (scale < 1) {
        iframe.style.transform = `scale(${scale})`;
        iframe.style.transformOrigin = 'center center';
        scaled = true;
        await new Promise(resolve => setTimeout(resolve, 50)); // Wait for reflow
      }

      iframe.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, 600)); // wait for scroll/render
      
      const rect = iframe.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'capture_tab' }, res => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(res);
            });
          });
          
          if (response && response.dataUrl) {
            const img = new Image();
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              img.src = response.dataUrl;
            });
            
            const canvas = document.createElement('canvas');
            
            // Calculate exact physical pixel scaling
            const scaleX = img.naturalWidth / window.innerWidth;
            const scaleY = img.naturalHeight / window.innerHeight;
            
            // Bounds check the crop to ensure we don't draw outside the image (and clamp > 0)
            const sx = Math.max(0, rect.left * scaleX);
            const sy = Math.max(0, rect.top * scaleY);
            const sw = Math.max(1, Math.min(rect.width * scaleX, img.naturalWidth - sx));
            const sh = Math.max(1, Math.min(rect.height * scaleY, img.naturalHeight - sy));
            
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext('2d');
            
            // Draw cropped portion
            ctx.drawImage(
              img, 
              sx, sy, sw, sh,
              0, 0, canvas.width, canvas.height
            );
            
            capturedIframes.set(iframe, canvas.toDataURL('image/png'));
          }
        } catch (e) {
          console.warn('Failed to capture iframe:', e);
        }
      }
      
      if (scaled) {
        iframe.style.transform = origTransform;
        iframe.style.transformOrigin = origTransformOrigin;
      }
    }
  }
  
  restoreScrollPositions(scrollPositions);
  restoreOverlays(hiddenOverlays);
}

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



// Style language labels above code blocks into professional pills
function formatLanguagePills(clone) {
  clone.querySelectorAll('pre').forEach(pre => {
    let current = pre;
    let header = null;
    
    // Walk up to find the header div (usually immediate sibling or parent's sibling)
    for (let i = 0; i < 3; i++) {
      if (current.previousElementSibling) {
        let sibling = current.previousElementSibling;
        const text = sibling.textContent.trim();
        // Check if it's a short text block (like "python", "javascript") without nested paragraphs
        if (text.length > 0 && text.length < 25 && !sibling.querySelector('p') && !sibling.querySelector('pre')) {
          header = sibling;
          break;
        }
      }
      current = current.parentElement;
      if (!current) break;
    }
    
    if (header) {
      let target = header;
      // Drill down to the innermost element containing the exact same text
      while (target.children.length === 1 && target.textContent.trim() === target.children[0].textContent.trim()) {
        target = target.children[0];
      }
      
      // Apply pill styling class
      target.classList.add('code-language-pill');
      target.style.cssText = ''; // Clear inline styles that might interfere
      
      // Clean up the parent wrapper to ensure it doesn't enforce weird layouts
      if (header !== target) {
        header.className = 'code-language-pill-wrapper';
        header.style.cssText = '';
      }
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
    'summary', // Removes tool use headers like 'V visualize show_widget' since they use details/summary
    '[data-testid*="tool"]',
    '[class*="tool-use"]',
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

  // Remove empty list items (e.g. left behind after removing action buttons)
  clone.querySelectorAll('li').forEach(li => {
    if (!li.textContent.trim() && !li.querySelector('img, canvas')) {
      li.remove();
    }
  });

  // Remove empty lists
  clone.querySelectorAll('ul, ol').forEach(list => {
    if (list.children.length === 0 || (!list.textContent.trim() && !list.querySelector('img, canvas'))) {
      list.remove();
    }
  });

  // Advanced Widget Header Cleaner: Removes UI elements (like "V" and "visualize show_widget") that are siblings to the widget image
  clone.querySelectorAll('*').forEach(el => {
    try {
      // Find containers that have both the widget media and the tool text
      const hasWidgetMedia = el.querySelector('img, iframe') || ['img', 'iframe'].includes(el.tagName.toLowerCase());
      if (hasWidgetMedia) {
        const text = el.textContent.toLowerCase();
        if (text.includes('visualize') || text.includes('show_widget') || text.includes('show_visual')) {
          Array.from(el.children).forEach(child => {
            // Check if this branch actually contains the main widget (ignore tiny icons)
            const branchHasWidget = Array.from(child.querySelectorAll('img, iframe')).some(media => {
              if (media.tagName.toLowerCase() === 'iframe') return true;
              // If it's an image, it must be the captured screenshot or a reasonably sized image, not a tiny icon
              return (media.src && media.src.startsWith('data:image/png')) || 
                     media.clientWidth > 50 || media.clientHeight > 50 || 
                     media.style.width === '100%' || media.style.height === 'auto';
            }) || (['img', 'iframe'].includes(child.tagName.toLowerCase()));

            if (!branchHasWidget) {
              const childText = child.textContent.trim();
              const lowerText = childText.toLowerCase();
              
              // If the text is exactly the tool name, it's definitely the header
              const isToolText = lowerText.includes('visualize') || 
                                 lowerText.includes('show_widget') || 
                                 lowerText.includes('show_visual') ||
                                 lowerText === 'v' || lowerText === '';

              // Protect user text, but override if it perfectly matches the tool text heuristics
              const hasProtectedContent = (child.querySelector('ul, ol, pre, blockquote') || 
                                          ['ul', 'ol', 'pre', 'blockquote'].includes(child.tagName.toLowerCase())) ||
                                          ((child.querySelector('p') || child.tagName.toLowerCase() === 'p') && !isToolText);
              
              // If it's a short UI block and doesn't contain protected user conversational text, nuke it
              if (childText.length < 150 && !hasProtectedContent) {
                child.remove();
              }
            }
          });
        }
      }
    } catch (e) {}
  });

  // Format language labels as pills
  formatLanguagePills(clone);
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

// Helper to deeply clone a node, including its shadow DOM, and freeze SVG dimensions
function deepCloneWithShadowsAndSvgs(originalNode) {
  if (originalNode.nodeType !== Node.ELEMENT_NODE && originalNode.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return originalNode.cloneNode(false);
  }

  // Convert canvas to image directly from the original node to preserve pixels
  if (originalNode.tagName && originalNode.tagName.toLowerCase() === 'canvas') {
    try {
      const img = document.createElement('img');
      img.src = originalNode.toDataURL('image/png');
      img.style.cssText = originalNode.style.cssText;
      img.className = originalNode.className;
      const rect = originalNode.getBoundingClientRect();
      img.width = originalNode.width || rect.width || originalNode.clientWidth;
      img.height = originalNode.height || rect.height || originalNode.clientHeight;
      return img;
    } catch(e) {
      console.warn('Failed to convert canvas to image during deep clone:', e);
      // Fallback to normal cloning if tainted
    }
  }

  // Replace captured cross-origin iframes with their screenshot image
  if (originalNode.tagName && originalNode.tagName.toLowerCase() === 'iframe') {
    const dataUrl = capturedIframes.get(originalNode);
    if (dataUrl) {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.className = originalNode.className;
      img.style.cssText = originalNode.style.cssText;
      // Force auto height to prevent original iframe height from warping aspect ratio
      img.style.height = 'auto';
      img.style.maxWidth = '100%';
      // Force width to 100% so if it was scaled down for screenshot, it stretches back up to full size cleanly
      img.style.width = '100%';
      img.style.border = '1px solid #e0e0e0';
      img.style.borderRadius = '8px';
      return img;
    }
  }

  const clone = originalNode.cloneNode(false);

  // Freeze SVG sizes if it's an SVG
  if (originalNode.tagName && originalNode.tagName.toLowerCase() === 'svg') {
    const rect = originalNode.getBoundingClientRect();
    if (rect.width && rect.height) {
      clone.setAttribute('width', rect.width);
      clone.setAttribute('height', rect.height);
    }
  }

  // If the original node has a shadow root, extract its contents
  if (originalNode.shadowRoot) {
    const shadowWrapper = document.createElement('div');
    shadowWrapper.className = 'shadow-root-extracted';
    shadowWrapper.style.display = 'contents';
    
    Array.from(originalNode.shadowRoot.childNodes).forEach(child => {
      shadowWrapper.appendChild(deepCloneWithShadowsAndSvgs(child));
    });
    clone.appendChild(shadowWrapper);
  }

  // Also clone normal children
  Array.from(originalNode.childNodes).forEach(child => {
    clone.appendChild(deepCloneWithShadowsAndSvgs(child));
  });

  return clone;
}

// Scrape chat messages by platform
async function getChatMessages(platform) {
  const messages = [];
  const url = window.location.href;

  await captureCrossoriginIframes();

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
        const clone = deepCloneWithShadowsAndSvgs(contentEl);
        cleanNoise(clone);
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

      const clone = deepCloneWithShadowsAndSvgs(turn);
      cleanNoise(clone);
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

      const clone = deepCloneWithShadowsAndSvgs(contentEl);
      cleanNoise(clone);
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
        const clone = deepCloneWithShadowsAndSvgs(el);
        cleanNoise(clone);
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

      const clone = deepCloneWithShadowsAndSvgs(el);
      cleanNoise(clone);
      await processImages(clone);
      messages.push({ role, html: clone.innerHTML });
    }
  }

  return messages;
}
