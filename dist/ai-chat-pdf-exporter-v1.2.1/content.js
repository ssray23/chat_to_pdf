const CONTENT_SCRIPT_VERSION = '1.2.14';
if (typeof window !== 'undefined') {
  window.__AI_EXPORTER_VERSION__ = CONTENT_SCRIPT_VERSION;
}

// Comprehensive Pipeline Diagnostic Logger
const Logger = {
  prefix: '[AI Exporter Pipeline]',
  stage1(msg, ...args) {
    console.log(`%c${this.prefix} [Stage 1: MountSweep] ${msg}`, 'color: #0284c7; font-weight: bold;', ...args);
  },
  stage2(msg, ...args) {
    console.log(`%c${this.prefix} [Stage 2: Inventory] ${msg}`, 'color: #7c3aed; font-weight: bold;', ...args);
  },
  recovery(msg, ...args) {
    console.log(`%c${this.prefix} [Stage 2: Auto-Recovery] ${msg}`, 'color: #d97706; font-weight: bold;', ...args);
  },
  gate(gateName, passed, details) {
    const color = passed ? '#16a34a' : '#dc2626';
    console.log(`%c${this.prefix} [${gateName}] ${passed ? 'PASSED' : 'FAILED'}:`, `color: ${color}; font-weight: bold;`, details);
  },
  stage3(msg, ...args) {
    console.log(`%c${this.prefix} [Stage 3: Markdown Handover] ${msg}`, 'color: #059669; font-weight: bold;', ...args);
  },
  error(msg, ...args) {
    console.error(`%c${this.prefix} [ERROR] ${msg}`, 'color: #dc2626; font-weight: bold;', ...args);
  }
};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof window !== 'undefined' && window.__AI_EXPORTER_VERSION__ && window.__AI_EXPORTER_VERSION__ !== CONTENT_SCRIPT_VERSION) {
    // If a newer version of the script is active in the page, ignore messages in this stale closure
    return false;
  }
  if (message.action === 'ping') {
    sendResponse({ pong: true, version: CONTENT_SCRIPT_VERSION });
    return true;
  }
  if (message.action === 'export_chat') {
    (async () => {
      try {
        Logger.stage1(`Initiating 3-stage gated chat export for platform: ${message.platform}`);
        const messages = await getChatMessages(message.platform);
        const mathStylesheets = getPageStylesheets();
        Logger.stage2(`Successfully extracted and verified ${messages.length} conversation turns.`);
        sendResponse({ success: true, messages, mathStylesheets, version: CONTENT_SCRIPT_VERSION });
      } catch (err) {
        Logger.error('Scrape execution halted:', err);
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
  const elements = document.querySelectorAll('header, footer, nav, aside, form, fieldset, [style*="fixed" i], [style*="sticky" i], [class*="fixed" i], [class*="sticky" i], [class*="overlay" i], [class*="toolbar" i]');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    try {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        hidden.push({ el, orig: el.style.visibility });
        el.style.visibility = 'hidden';
      }
    } catch (e) {}
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
  const iframes = Array.from(document.querySelectorAll('iframe'));
  if (iframes.length === 0) return;

  const hiddenOverlays = hideOverlays();
  const scrollPositions = saveScrollPositions();

  for (const iframe of iframes) {
    const initialRect = iframe.getBoundingClientRect();
    // Ignore invisible, detached, or tiny tracking iframes
    if (initialRect.width < 20 || initialRect.height < 20) continue;

    const origTransform = iframe.style.transform;
    const origTransformOrigin = iframe.style.transformOrigin;
    let scaled = false;
    let scale = 1;

    // If the iframe is taller or wider than the viewport, scale it down so it fits in a single screenshot
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

// Helper to fetch any media URL and convert to base64 Data URL
async function fetchUrlAsBase64(url) {
  if (!url) return '';
  // Clean url if wrapped in CSS url("...") or url('...')
  const cleanUrl = url.replace(/^url\(["']?/, '').replace(/["']?\)$/, '').trim();
  if (!cleanUrl || cleanUrl === 'none' || cleanUrl.startsWith('data:')) return cleanUrl;

  try {
    const res = await fetch(cleanUrl, { credentials: 'include' });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result || cleanUrl);
        reader.onerror = () => resolve(cleanUrl);
        reader.readAsDataURL(blob);
      } catch (err) {
        resolve(cleanUrl);
      }
    });
  } catch (e) {
    console.warn('Failed to fetch URL as base64:', cleanUrl, e);
    return cleanUrl;
  }
}

// Convert image to base64 Data URL
async function imgToBase64(img) {
  const src = img.getAttribute('src') || img.src || img.getAttribute('data-src') || '';
  if (!src) return '';
  if (src.startsWith('data:')) return src;

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
    console.warn('Canvas export failed, falling back to fetch:', src, e);
  }

  // 2. Fallback to fetching blob (handles CORS / credentials)
  return await fetchUrlAsBase64(src);
}

// Process images and media cards inside container
async function processImages(containerEl) {
  // 1. Process and convert Atlaskit / Rovo Media Attachment Cards into clean <img> elements
  const mediaCardSelectors = [
    '[data-testid*="media-card" i]',
    '[data-testid*="media-file" i]',
    '[data-testid*="file-card" i]',
    '[data-testid*="attachment" i]',
    '[data-testid*="file-item" i]',
    '[class*="media-card" i]',
    '[class*="file-card" i]',
    '[class*="attachment" i]',
    'div[data-node-type="media" i]',
    'div[data-node-type="mediaSingle" i]',
    'div[data-node-type="mediaGroup" i]'
  ];

  const cards = containerEl.querySelectorAll(mediaCardSelectors.join(', '));
  const processedCards = new Set();

  for (const card of cards) {
    // Avoid double-processing nested child cards
    if (processedCards.has(card)) continue;
    let parent = card.parentElement;
    let isNested = false;
    while (parent && parent !== containerEl) {
      if (processedCards.has(parent)) { isNested = true; break; }
      parent = parent.parentElement;
    }
    if (isNested) continue;

    // Check if card contains an img, background-image, canvas, or link
    const nestedImg = card.querySelector('img');
    const nestedCanvas = card.querySelector('canvas');
    const nestedLink = card.querySelector('a[href]');
    let bgUrl = '';
    
    // Check style for background-image
    if (card.style && card.style.backgroundImage && card.style.backgroundImage !== 'none') {
      bgUrl = card.style.backgroundImage;
    } else {
      const bgEl = card.querySelector('[style*="background-image"]');
      if (bgEl && bgEl.style && bgEl.style.backgroundImage) {
        bgUrl = bgEl.style.backgroundImage;
      }
    }

    // Extract filename / title if present
    const nameEl = card.querySelector('[data-testid*="file-name" i], [class*="title" i], [class*="name" i], [class*="filename" i], span, p');
    const fileName = (nestedImg && nestedImg.alt) || 
                     (nameEl ? nameEl.textContent.trim() : '') || 
                     card.getAttribute('aria-label') || 
                     '';

    let base64 = '';
    if (nestedImg) {
      base64 = await imgToBase64(nestedImg);
    } else if (nestedCanvas) {
      try {
        base64 = nestedCanvas.toDataURL('image/png');
      } catch (e) {}
    } else if (bgUrl) {
      base64 = await fetchUrlAsBase64(bgUrl);
    } else if (nestedLink && nestedLink.href && /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(nestedLink.href)) {
      base64 = await fetchUrlAsBase64(nestedLink.href);
    }

    if (base64) {
      const mediaWrapper = document.createElement('div');
      mediaWrapper.className = 'ai-exporter-media-card';

      const img = document.createElement('img');
      img.src = base64;
      img.alt = fileName || 'Image attachment';
      img.className = 'ai-exporter-attachment-img';
      mediaWrapper.appendChild(img);

      if (fileName && fileName.length < 80) {
        const caption = document.createElement('span');
        caption.className = 'ai-exporter-media-caption';
        caption.textContent = fileName;
        mediaWrapper.appendChild(caption);
      }

      card.replaceWith(mediaWrapper);
      processedCards.add(card);
    }
  }

  // 2. Process background images on remaining elements
  const bgElements = containerEl.querySelectorAll('[style*="background-image"]');
  for (const el of bgElements) {
    if (el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none') {
      const base64 = await fetchUrlAsBase64(el.style.backgroundImage);
      if (base64 && base64.startsWith('data:')) {
        // If the element has no other text content, convert it to an img
        if (!el.textContent.trim() && el.children.length === 0) {
          const img = document.createElement('img');
          img.src = base64;
          img.className = el.className;
          el.replaceWith(img);
        } else {
          el.style.backgroundImage = `url("${base64}")`;
        }
      }
    }
  }

  // 3. Process standard images inside container
  const imgs = containerEl.querySelectorAll('img:not(.ai-exporter-attachment-img)');
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
// Style language labels above code blocks into professional pills
function formatLanguagePills(clone) {
  const KNOWN_LANGUAGES = new Set([
    'javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'python', 'py', 'html', 'css', 'scss', 'sass', 'less',
    'bash', 'sh', 'zsh', 'shell', 'json', 'yaml', 'yml', 'xml', 'sql', 'c', 'cpp', 'c++', 'c#', 'csharp', 'cs',
    'java', 'rust', 'rs', 'go', 'golang', 'ruby', 'rb', 'php', 'swift', 'kotlin', 'kt', 'scala', 'r', 'dart',
    'lua', 'perl', 'dockerfile', 'docker', 'graphql', 'markdown', 'md', 'diff', 'makefile', 'plaintext', 'text', 'txt', 'console', 'terminal'
  ]);

  clone.querySelectorAll('pre').forEach(pre => {
    let current = pre;
    let header = null;
    
    // Walk up to find the header div (usually immediate sibling or parent's sibling)
    for (let i = 0; i < 3; i++) {
      if (current.previousElementSibling) {
        let sibling = current.previousElementSibling;
        const text = sibling.textContent.trim().toLowerCase();
        
        // Strictly require valid language token or explicit language header element
        const isKnownLang = KNOWN_LANGUAGES.has(text) || (/^[a-z0-9+#.-]{1,12}$/i.test(text) && (
          (sibling.className && typeof sibling.className === 'string' && (
            sibling.className.toLowerCase().includes('lang') || 
            sibling.className.toLowerCase().includes('header')
          )) ||
          sibling.getAttribute('data-language') ||
          (sibling.parentElement && typeof sibling.parentElement.className === 'string' && sibling.parentElement.className.toLowerCase().includes('header'))
        ));
        
        if (isKnownLang && !sibling.querySelector('p') && !sibling.querySelector('pre')) {
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

// Clean UI noise (buttons, icons, action rows, composer input toolbars)
function cleanNoise(clone) {
  // 1. Remove input composer / toolbar elements (strictly active inputs, never sent prompt cards)
  const composerSelectors = [
    'form:not([class*="message"])',
    'textarea',
    'input:not([type="checkbox"]):not([type="radio"])',
    '[data-testid="composer"]',
    '[data-testid="prompt-composer"]',
    '[data-testid*="chat-composer" i]',
    '[class*="Composer" i]:not([class*="--composer" i]):not([class*="message" i])',
    '[class*="composer" i]:not([class*="--composer" i]):not([class*="message" i])',
    '[class*="ActionToolbar" i]',
    '[class*="action-toolbar" i]',
    '[aria-label="Add sources" i]'
  ];

  composerSelectors.forEach(sel => {
    try {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    } catch (e) {}
  });

  // 1b. Remove code-block line-number gutters (e.g. Atlaskit code blocks with line numbers)
  clone.querySelectorAll('[class*="linenumber" i], [class*="line-number" i], [class*="gutter" i], [data-testid*="line-number" i]').forEach(el => {
    if (/^\s*\d+\s*$/.test(el.textContent)) {
      el.remove();
    }
  });

  // 2. Remove action buttons, but PRESERVE user messages, media cards, and content:
  clone.querySelectorAll('button, [role="button"]').forEach(el => {
    const isMediaCard = el.matches && el.matches('[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i], [class*="thumbnail" i], div[data-node-type="media" i]');
    const hasMediaCardChild = el.querySelector('[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i], div[data-node-type="media" i]');
    const hasImage = el.querySelector('img, picture, canvas');
    const hasBgImage = el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none';

    const text = el.textContent.trim();
    const isFeedbackOrDebug = /good response|bad response|debug response|provide feedback|give feedback|was this helpful|rate response|report response|thumbs up|thumbs down/i.test(text);
    const isActionControl = isFeedbackOrDebug || /^(copy|share|retry|thumbs|good|bad|submit|add|cancel|edit|auto|\+\d+|\+add|\d{1,4})$/i.test(text);

    const isSourcesPill = !isFeedbackOrDebug && (
      (el.matches && el.matches('[data-testid*="source" i], [class*="source" i], [data-testid*="reference" i]')) || 
      /^\d+\s*(sources?|issues?|references?|documents?)/i.test(text)
    );

    const isSuggestedPrompt = !isActionControl && !isFeedbackOrDebug && (
      (el.matches && el.matches('[data-testid*="suggest" i], [data-testid*="followup" i], [class*="suggest" i], [class*="followup" i]')) ||
      text.startsWith('↳') || text.startsWith('⤷')
    );

    if (isMediaCard || hasMediaCardChild || hasImage || hasBgImage) {
      // Preserve media attachment container
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      if (el.tagName.toLowerCase() === 'button') {
        const div = document.createElement('div');
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          div.setAttribute(attr.name, attr.value);
        }
        while (el.firstChild) {
          div.appendChild(el.firstChild);
        }
        el.replaceWith(div);
      }
    } else if (isSourcesPill) {
      // Convert sources button to styled pill container
      const pill = document.createElement('div');
      pill.className = 'atlassian-sources-pill';
      while (el.firstChild) {
        pill.appendChild(el.firstChild);
      }
      el.replaceWith(pill);
    } else if (isSuggestedPrompt) {
      // Convert suggested prompt button to styled suggestion row
      const cleanPrompt = text.replace(/^[↳⤷\s]+/, '').trim();
      const div = document.createElement('div');
      div.className = 'rovo-suggested-prompt';
      div.innerHTML = `<span class="suggested-prompt-arrow">↳</span> <span class="suggested-prompt-text">${cleanPrompt}</span>`;
      el.replaceWith(div);
    } else if (isActionControl || isFeedbackOrDebug) {
      // Strictly remove UI control buttons (Copy, Feedback, Thumbs, Submit)
      el.remove();
    } else {
      // For any other button or role="button" (such as clickable user prompt bubbles or cards):
      // NEVER delete! Preserve the full prompt text and convert to a clean div.
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      if (el.tagName.toLowerCase() === 'button') {
        const div = document.createElement('div');
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          div.setAttribute(attr.name, attr.value);
        }
        while (el.firstChild) {
          div.appendChild(el.firstChild);
        }
        el.replaceWith(div);
      }
    }
  });
  
  // 3. Remove platform-specific layout controls and action bars (targeted selectors only)
  const noiseSelectors = [
    // Screen-reader-only labels and live regions
    '.sr-only',
    '[class*="sr-only" i]',
    '#aria-notify-live-region-assertive',
    '#aria-notify-live-region-polite',
    '[aria-live][class*="sr-only" i]',
    '[aria-live].sr-only',
    // ChatGPT Action bars & feedback buttons
    '[data-testid*="action-bar" i]',
    '[data-testid*="copy-turn-action-button" i]',
    '[data-testid*="good-response-turn-action-button" i]',
    '[data-testid*="bad-response-turn-action-button" i]',
    '[aria-label*="Read aloud" i]',
    '[aria-label*="Good response" i]',
    '[aria-label*="Bad response" i]',
    // Claude Actions & Thinking Collapsibles
    '.chat-actions',
    '[class*="thumbs-down"]',
    '[class*="copy-button"]',
    '[data-testid*="thinking" i]',
    '[data-testid*="thought" i]',
    '[class*="thinking" i]',
    '[class*="thought" i]',
    '[class*="Thinking" i]',
    '[class*="Thought" i]',
    // Perplexity
    '.query-actions',
    '.answer-actions',
    '[data-testid*="share" i]',
    '[aria-label*="Rewrite" i]',
    '[aria-label*="Copy" i]',
    '[aria-label*="Search web" i]',
    '[aria-label*="Search images" i]',
    // Gemini
    '.message-actions',
    'button-row',
    '.action-row',
    '.action-area',
    // Rovo / Atlassian
    '[data-testid*="feedback" i]',
    '[data-testid*="action-bar" i]',
    '[data-testid*="copy-action" i]',
    '[data-testid*="toolbar" i]',
    '[data-testid*="bottom-bar" i]',
    '[class*="feedback-container" i]',
    '[class*="actionBar" i]',
    '[class*="ActionGroup" i]',
    '[class*="Toolbar" i]',
    '[class*="toolbar" i]',
    '[aria-label*="thumbs" i]',
    '[aria-label*="copy" i]',
    '[aria-label*="Submit" i]',
    '[aria-label*="Add sources" i]',
    '[aria-label*="Auto" i]',
    // ChatGPT Search, Citation and Source count badges
    '[data-testid*="citation" i]',
    '[class*="citation" i]',
    '[class*="source-badge" i]',
    '[class*="sources-badge" i]',
    '[class*="search-badge" i]',
    '[aria-label*="source" i]',
    '[aria-label*="citation" i]'
  ];

  noiseSelectors.forEach(selector => {
    try {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    } catch (e) {}
  });

  // Remove conversational announcement headers used by screen readers (e.g. "You said:", "ChatGPT said:")
  clone.querySelectorAll('h1, h2, h3, h4, h5, h6, span, div, p').forEach(el => {
    const txt = el.textContent.trim();
    if (/^(You said|ChatGPT said|Claude said|User said):?$/i.test(txt)) {
      el.remove();
    }
  });

  // Remove standalone digit badge elements (e.g. search source count "9", citation badge)
  clone.querySelectorAll('span, div, button, a').forEach(el => {
    if (el.children.length === 0 && /^\s*\d{1,3}\s*$/.test(el.textContent)) {
      if (el.closest('table, pre, code, ol, ul')) return;
      el.remove();
    }
  });

  // Detect and normalize ChatGPT file attachments in prompts into structured attachment pills
  const attachmentExts = 'md|markdown|pdf|docx?|xlsx?|csv|txt|json|py|js|ts|jsx|tsx|html|css|yaml|yml|xml|log|sh|sql|zip|tar|gz';
  const fileRegex = new RegExp('([a-zA-Z0-9_\\-\\.]+\\.(?:' + attachmentExts + '))(?:Document|File|Spreadsheet|Presentation|Archive|PDF|Text|Code|\\b|$)', 'i');

  clone.querySelectorAll('[data-testid*="attachment" i], [data-testid*="file" i], [class*="file" i], [class*="attachment" i], [aria-label*="attachment" i], [aria-label*="file" i]').forEach(el => {
    if (el.tagName === 'PRE' || el.tagName === 'CODE' || el.hasAttribute('data-message-author-role')) return;
    if (el.querySelector('img, svg, canvas, video, audio') || el.classList.contains('media-card-view')) return;
    const text = el.textContent.trim();
    const fileMatch = text.match(fileRegex);
    if (fileMatch) {
      const fileName = fileMatch[1].trim();
      const pill = document.createElement('div');
      pill.className = 'ai-exporter-file-attachment';
      pill.setAttribute('data-filename', fileName);
      pill.textContent = fileName;
      el.replaceWith(pill);
    }
  });

  // Secondary scan for any small widget containing a file name followed by Document/File
  clone.querySelectorAll('div, a, span').forEach(el => {
    if (el.classList.contains('ai-exporter-file-attachment') || el.classList.contains('media-card-view')) return;
    if (el.querySelector('img, svg, canvas, video, audio')) return;
    if (el.children.length <= 3 && el.textContent.length < 100 && !el.querySelector('pre, code, table, p, h1, h2, h3, h4')) {
      const text = el.textContent.trim();
      const match = text.match(new RegExp('^([a-zA-Z0-9_\\-\\.]+\\.(?:' + attachmentExts + '))(?:Document|File|Spreadsheet|Presentation|Archive|PDF|Text|Code)?$', 'i'));
      if (match) {
        const fileName = match[1].trim();
        const pill = document.createElement('div');
        pill.className = 'ai-exporter-file-attachment';
        pill.setAttribute('data-filename', fileName);
        pill.textContent = fileName;
        el.replaceWith(pill);
      }
    }
  });

  // Remove empty pre or code containers that have no text and no visual media
  clone.querySelectorAll('pre, [class*="code-block" i]').forEach(el => {
    if (!el.textContent.trim() && !el.querySelector('img, svg, canvas, iframe')) {
      el.remove();
    }
  });

  // Remove non-media tool-call containers, but ALWAYS preserve code blocks, pre elements, tables, and text
  clone.querySelectorAll('[data-testid="tool-use-block"], [data-testid="tool-result-block"], .tool-use, .toolUse').forEach(toolEl => {
    // If it contains code, pre, table, or readable text, never remove it
    if (toolEl.querySelector('pre, code, table, p, ul, ol') || toolEl.textContent.trim().length > 80) {
      toolEl.querySelectorAll('summary, button, [class*="header" i], [class*="status" i]').forEach(hdr => {
        const text = hdr.textContent.trim().toLowerCase();
        if (text.includes('visualize') || text.includes('connecting') || text.includes('show_widget') || text === 'v') {
          hdr.remove();
        }
      });
      return;
    }
    const hasVisualMedia = toolEl.querySelector('img, iframe, canvas, svg') !== null;
    if (!hasVisualMedia) {
      toolEl.remove();
    }
  });

  // Clean orphan tool status text (e.g. "V Connecting to visualize...", "visualize show_widget")
  clone.querySelectorAll('p, div, span, summary, button').forEach(el => {
    const text = el.textContent.trim().toLowerCase();
    if (
      text === 'v' || 
      text === 'connecting to visualize...' || 
      text === 'connecting to visualize' ||
      text.startsWith('v connecting to visualize') ||
      text.startsWith('connecting to visualize') ||
      text.includes('visualize show_widget') ||
      text.includes('show_visual')
    ) {
      if (!el.querySelector('img, iframe, svg, canvas')) {
        el.remove();
      }
    }
  });

  // Remove Claude "Thought for Xs" / reasoning collapsible blocks
  clone.querySelectorAll('button, div, summary, p, span').forEach(el => {
    const text = el.textContent.trim();
    if (/^thought for \d+s/i.test(text) || /^thought for a few seconds/i.test(text) || /^thinking(\.\.\.)?$/i.test(text)) {
      const details = el.closest('details') || el;
      details.remove();
    }
  });

  // Remove copy buttons and clipboard icons from inside and above code blocks
  clone.querySelectorAll('pre, [class*="code-block" i], code-block').forEach(pre => {
    pre.querySelectorAll('button, .copy-code-button, button[class*="copy" i], [aria-label*="Copy" i], [data-testid*="copy" i]').forEach(el => el.remove());
    // Also remove copy svg icons inside code container
    pre.querySelectorAll('svg').forEach(svg => {
      const parentBtn = svg.closest('button, a, [role="button"]');
      if (parentBtn || svg.classList.contains('icon-sm') || svg.classList.contains('icon-md')) {
        svg.remove();
      }
    });
  });

  // Remove search source citation favicons/icons (e.g. giant Reddit, Apple logos attached to links)
  clone.querySelectorAll('a img, a svg, [data-testid*="source" i]:not([data-testid="sources-pill"]) img, [class*="citation" i] img, [class*="attribution" i] img, [class*="source" i]:not(.atlassian-sources-pill) img, [class*="source" i]:not(.atlassian-sources-pill) svg').forEach(media => {
    media.remove();
  });

  // Remove standalone favicon / logo images where parent or sibling has text
  clone.querySelectorAll('img, svg').forEach(img => {
    const alt = (img.getAttribute('alt') || '').toLowerCase().trim();
    const src = (img.getAttribute('src') || img.src || '').toLowerCase();
    
    // Aggressively match site names often used in search citations
    const isFaviconOrLogo = 
      alt.includes('reddit') || alt.includes('apple support') || alt.includes('apple.com') || alt.includes('favicon') || alt.includes('logo') || alt.includes('icon') ||
      src.includes('favicon') || src.includes('google.com/s2/favicons') || src.includes('gstatic.com/favicon') || src.includes('icons.duckduckgo.com') ||
      src.includes('redditstatic.com') || (src.includes('apple.com') && (src.includes('favicon') || src.includes('touch-icon') || src.includes('logo') || src.includes('nav_apple_icon'))) ||
      // Remove tiny inline images which are usually icons/favicons that blow up in print
      (img.tagName.toLowerCase() === 'img' && (img.width > 0 && img.width <= 32 || parseInt(img.getAttribute('width')) <= 32));
    
    if (isFaviconOrLogo) {
      img.remove();
    }
  });

  // Remove empty list items (e.g. left behind after removing action buttons)
  clone.querySelectorAll('li').forEach(li => {
    if (!li.textContent.trim() && !li.querySelector('img, canvas, svg')) {
      li.remove();
    }
  });

  // Remove empty lists
  clone.querySelectorAll('ul, ol').forEach(list => {
    if (list.children.length === 0 || (!list.textContent.trim() && !list.querySelector('img, canvas, svg'))) {
      list.remove();
    }
  });

  // Remove empty paragraphs, divs with only whitespace/nbsp/br, or standalone br tags (excluding code/pre blocks)
  clone.querySelectorAll('p, div, span').forEach(el => {
    if (el.closest('pre, code, textarea')) return;
    const text = el.textContent.replace(/\u00a0/g, ' ').trim();
    const hasMedia = el.querySelector('img, svg, canvas, iframe, video, .ai-exporter-media-card, .atlassian-smart-chip, .atlassian-sources-pill, .rovo-suggested-prompt, pre, code, table');
    if (!text && !hasMedia) {
      if (['p', 'div', 'span'].includes(el.tagName.toLowerCase())) {
        el.remove();
      }
    }
  });

  // Remove consecutive <br> tags
  clone.querySelectorAll('br + br').forEach(br => br.remove());

  // Advanced Widget Header Cleaner: Removes UI elements (like "V" and "visualize show_widget") that are siblings to the widget image
  clone.querySelectorAll('*').forEach(el => {
    try {
      // Find containers that have both the widget media and the tool text
      const hasWidgetMedia = el.querySelector('img, iframe') || ['img', 'iframe'].includes(el.tagName.toLowerCase());
      if (hasWidgetMedia) {
        const text = el.textContent.toLowerCase();
        if (text.includes('visualize') || text.includes('show_widget') || text.includes('show_visual') || text.includes('connecting')) {
          Array.from(el.children).forEach(child => {
            // Check if this branch actually contains the main widget (ignore tiny icons)
            const branchHasWidget = Array.from(child.querySelectorAll('img, iframe, svg, canvas')).some(media => {
              if (media.tagName.toLowerCase() === 'iframe') return true;
              // If it's an image, it must be the captured screenshot or a reasonably sized image, not a tiny icon
              return (media.src && media.src.startsWith('data:image/png')) || 
                     media.clientWidth > 50 || media.clientHeight > 50 || 
                     media.style.width === '100%' || media.style.height === 'auto';
            }) || (['img', 'iframe', 'svg', 'canvas'].includes(child.tagName.toLowerCase()));

            if (!branchHasWidget) {
              const childText = child.textContent.trim();
              const lowerText = childText.toLowerCase();
              
              // If the text is exactly the tool name, it's definitely the header
              const isToolText = lowerText.includes('visualize') || 
                                 lowerText.includes('show_widget') || 
                                 lowerText.includes('show_visual') ||
                                 lowerText.includes('connecting') ||
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

  // Normalize Atlassian Smart Links, Jira issue lozenges, and list spacing on Atlassian platforms
  const currentUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
  if (currentUrl.includes('atlassian.net') || currentUrl.includes('atlassian.com')) {
    normalizeSmartLinksAndLists(clone);
  }
  if (currentUrl.includes('gemini.google')) {
    normalizeGeminiTurn(clone);
  }
}

// Normalize Atlassian Smart Links, Jira issue lozenges, and list item spacing
function normalizeSmartLinksAndLists(container) {
  // 1. Remove stray checkbox / empty icon paragraphs or orphaned checkbox containers
  container.querySelectorAll('p, div, span').forEach(el => {
    const text = el.textContent.replace(/\u00a0/g, ' ').trim();
    const hasMedia = el.querySelector('img, svg, canvas, iframe, video, .ai-exporter-media-card, .atlassian-smart-chip, .atlassian-sources-pill, .rovo-suggested-prompt');
    if ((!text || text === '☑' || text === '☐' || text === '◻' || text === '▫' || text === '✓' || text === '✔') && !hasMedia && el.querySelectorAll('pre, code, a').length === 0) {
      if (['p', 'div', 'span'].includes(el.tagName.toLowerCase())) {
        el.remove();
      }
    }
  });

  // 2. Process list items containing Jira issue links or Confluence links
  container.querySelectorAll('li').forEach(li => {
    // Clean up empty checkbox text/spans inside li before the link
    Array.from(li.childNodes).forEach(child => {
      if (child.nodeType === Node.TEXT_NODE && (child.nodeValue.trim() === '☑' || child.nodeValue.trim() === '☐')) {
        child.remove();
      } else if (child.nodeType === Node.ELEMENT_NODE && (child.textContent.trim() === '☑' || child.textContent.trim() === '☐') && child.tagName.toLowerCase() !== 'a' && !child.classList.contains('atlassian-smart-chip')) {
        child.remove();
      }
    });
  });

  // Strip preview buttons and preview text from inside smart cards
  container.querySelectorAll('a button, [data-testid*="preview" i], button[class*="preview" i]').forEach(btn => {
    if (btn.textContent.trim().toLowerCase() === 'preview') {
      btn.remove();
    }
  });

  // Find all smart links inside the entire container (both in paragraphs and list items)
  const links = container.querySelectorAll('a, [data-testid*="inline-card" i], [class*="InlineCard" i], [data-smart-card]');
  links.forEach(link => {
    // Skip if already converted
    if (link.classList.contains('atlassian-smart-chip')) return;

    let linkText = link.textContent.replace(/\s*Preview$/i, '').trim();
    const href = link.getAttribute('href') || '#';

    // Match Jira Issue Link (e.g. DO-1515: Title [Done/In Use])
    const jiraMatch = linkText.match(/^([☑☐\s]*)([A-Z]+-\d+:\s*.+?)(Done|In Use|In Progress|To Do|In Review|Closed|Open|Resolved|Under Review|Blocked|Wont Do|Won't Do)?$/i);
    
    if (jiraMatch && jiraMatch[2]) {
      const iconChar = '☑';
      let issueTitle = jiraMatch[2].trim();
      let status = jiraMatch[3] ? jiraMatch[3].trim() : '';

      // Check if there's a separate lozenge element inside the link or next to it
      const nestedLozenge = link.querySelector('[data-testid*="lozenge" i], [class*="lozenge" i], [class*="Lozenge" i]');
      if (nestedLozenge) {
        status = nestedLozenge.textContent.trim();
      } else if (!status) {
        const siblingLozenge = link.nextElementSibling && link.nextElementSibling.matches('[data-testid*="lozenge" i], [class*="lozenge" i]') ? link.nextElementSibling : null;
        if (siblingLozenge) {
          status = siblingLozenge.textContent.trim();
          siblingLozenge.remove();
        }
      }

      if (status) {
        const statusRegex = new RegExp(`\\s*${status}$`, 'i');
        issueTitle = issueTitle.replace(statusRegex, '').trim();
      }

      const chip = document.createElement('a');
      chip.className = 'atlassian-smart-chip';
      chip.href = href;

      let statusClass = 'status-done';
      const stLower = status.toLowerCase();
      if (stLower.includes('progress') || stLower.includes('review')) statusClass = 'status-in-progress';
      else if (stLower.includes('to do') || stLower.includes('open')) statusClass = 'status-todo';
      else if (stLower.includes('block') || stLower.includes('warn')) statusClass = 'status-blocked';
      else if (stLower.includes('use') || stLower.includes('done') || stLower.includes('resolv')) statusClass = 'status-done';

      chip.innerHTML = `
        <span class="smart-chip-icon">${iconChar}</span>
        <span class="smart-chip-title">${issueTitle}</span>
        ${status ? `<span class="smart-chip-lozenge ${statusClass}">${status}</span>` : ''}
      `;

      link.replaceWith(chip);
    } else if (linkText.startsWith('🗎') || link.querySelector('svg') || href.includes('confluence') || href.includes('atlassian') || link.matches('[data-testid*="inline-card" i], [class*="InlineCard" i]')) {
      const titleText = linkText.replace(/^[🗎\s]+/, '').replace(/\s*Preview$/i, '').trim();
      if (titleText) {
        const chip = document.createElement('a');
        chip.className = 'atlassian-smart-chip';
        chip.href = href;
        chip.innerHTML = `
          <span class="smart-chip-icon">🗎</span>
          <span class="smart-chip-title">${titleText}</span>
        `;
        link.replaceWith(chip);
      }
    }
  });

  // 3. Format suggested prompt rows starting with ↳ (excluding feedback/debug controls)
  container.querySelectorAll('button, a, .suggested-prompt, [class*="suggestion" i], [class*="suggested" i]').forEach(el => {
    const text = el.textContent.trim();
    if (/(good response|bad response|debug response|provide feedback|give feedback|was this helpful|rate response|report response)/i.test(text)) {
      el.remove();
      return;
    }
    if ((text.startsWith('↳') || text.startsWith('⤷')) && !el.classList.contains('rovo-suggested-prompt') && !el.closest('.rovo-suggested-prompt')) {
      if (text.length < 250 && el.querySelectorAll('p, div, pre, blockquote, table, ol, ul').length === 0) {
        const cleanPrompt = text.replace(/^[↳⤷\s]+/, '').trim();
        if (cleanPrompt) {
          const div = document.createElement('div');
          div.className = 'rovo-suggested-prompt';
          div.innerHTML = `<span class="suggested-prompt-arrow">↳</span> <span class="suggested-prompt-text">${cleanPrompt}</span>`;
          el.replaceWith(div);
        }
      }
    }
  });

  // 4. Format bottom summary / sources pill (e.g. "10 Sources" / "14 Issues")
  container.querySelectorAll('p, div, a, span').forEach(el => {
    const text = el.textContent.trim();
    if (/^([🗎\s]*|\s*)(\d+\s+(sources?|issues?|tickets?|pages?|links?|references?))\s*$/i.test(text) && el.children.length <= 3) {
      if (!el.classList.contains('atlassian-sources-pill') && !el.classList.contains('atlassian-issues-summary-chip') && !el.closest('.atlassian-sources-pill, .atlassian-issues-summary-chip')) {
        const match = text.match(/(\d+\s+(sources?|issues?|tickets?|pages?|links?|references?))/i);
        if (match) {
          const pill = document.createElement('div');
          pill.className = 'atlassian-sources-pill atlassian-issues-summary-chip';
          
          // Preserve any existing icons inside the original element
          const icons = Array.from(el.querySelectorAll('svg, img, [class*="icon" i]'));
          if (icons.length > 0) {
            icons.forEach(ic => pill.appendChild(ic.cloneNode(true)));
          } else {
            pill.innerHTML = `<span class="summary-chip-icon">🗎</span>`;
          }
          
          const textSpan = document.createElement('span');
          textSpan.className = 'sources-pill-text';
          textSpan.textContent = ` ${match[1]}`;
          pill.appendChild(textSpan);

          el.replaceWith(pill);
        }
      }
    }
  });

  // 5. Merge split <ol> / <ul> lists that are separated by descriptive paragraphs or broken up
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;

    // Pattern: <ol><li>...</li></ol> <p>...</p> <ol start="...">
    const splitLists = container.querySelectorAll('ol + p + ol, ul + p + ul');
    if (splitLists.length > 0) {
      splitLists.forEach(secondList => {
        const p = secondList.previousElementSibling;
        const firstList = p ? p.previousElementSibling : null;
        if (firstList && p && firstList.lastElementChild) {
          firstList.lastElementChild.appendChild(p);
          while (secondList.firstElementChild) {
            firstList.appendChild(secondList.firstElementChild);
          }
          secondList.remove();
          changed = true;
        }
      });
    }

    // Pattern: <ol> + <ol> or <ul> + <ul>
    const adjacentLists = container.querySelectorAll('ol + ol, ul + ul');
    if (adjacentLists.length > 0) {
      adjacentLists.forEach(secondList => {
        const firstList = secondList.previousElementSibling;
        if (firstList) {
          while (secondList.firstElementChild) {
            firstList.appendChild(secondList.firstElementChild);
          }
          secondList.remove();
          changed = true;
        }
      });
    }
  }
}

// Clean internal Gemini preview elements and UI chrome
function normalizeGeminiTurn(clone, role) {
  if (!clone) return;

  // 1. Remove Gemini UI action bars, draft pickers, and tool drawers
  // NOTE: Never remove response content containers (.single-draft-response-container, markdown, etc.)!
  clone.querySelectorAll(
    '.message-actions, button-row, .action-row, .action-area, .draft-picker, ' +
    '[class*="draft-picker" i], [class*="draft-select" i], [data-testid*="draft-picker" i], ' +
    '.draft-actions, .export-menu, .response-feedback, .response-container-header, .response-container-footer'
  ).forEach(el => {
    // Safety check: Never delete a container that holds the actual response message or markdown
    if (el.matches && (el.matches('.single-draft-response-container, [class*="single-draft" i]') ||
        el.querySelector('message-content, structured-content-container, response-element, model-response-content, .markdown, [class*="model-response-text" i], table, pre'))) {
      return;
    }
    el.remove();
  });

  // Remove "Gemini said" internal screen-reader header if present
  if (role === 'assistant') {
    clone.querySelectorAll('.model-title, [class*="model-title" i]').forEach(el => {
      if (/^gemini(\s+said)?$/i.test(el.textContent.trim())) {
        el.remove();
      }
    });
  }

  // 2. On user turns, remove Gemini duplicate internal preview title (<h5>)
  // Gemini renders an <h5> (often ending in an ellipsis "…") as an internal preview/card header
  // while the actual prompt body is in a sibling <p> or <div class="query-text">.
  const isUserTurn = role === 'user' || (clone.tagName && clone.tagName.toLowerCase() === 'user-query') || (clone.querySelector && clone.querySelector('user-query'));
  if (isUserTurn) {
    const h5List = Array.from(clone.querySelectorAll('h5, [class*="query-title" i], [class*="query-header" i]'));
    if (h5List.length > 0) {
      const allText = clone.textContent.trim();
      const h5Text = h5List.map(h => h.textContent.trim()).join(' ');
      if (allText.length > h5Text.length + 5 || clone.querySelector('p, div.query-text, [class*="query-text" i]')) {
        h5List.forEach(h => h.remove());
      } else {
        h5List.forEach(h => {
          const p = document.createElement('p');
          p.innerHTML = h.innerHTML;
          h.replaceWith(p);
        });
      }
    }
  }
}

// Helper to filter out nested child elements of the same selector list
function getUniqueElements(elements) {
  const arr = Array.from(elements);
  return arr.filter(el => {
    // If el contains multiple other candidate items in arr, el is a container list; discard el in favor of individual items
    const childCandidatesCount = arr.filter(other => other !== el && el.contains && el.contains(other)).length;
    if (childCandidatesCount > 1) {
      return false;
    }
    // If an ancestor of el is also in arr:
    let parent = el.parentElement;
    while (parent) {
      if (arr.includes(parent)) {
        const parentChildCount = arr.filter(other => other !== parent && parent.contains && parent.contains(other)).length;
        // If the ancestor contains only this single candidate (redundant 1:1 wrapper), discard this child in favor of the ancestor
        if (parentChildCount === 1) {
          return false;
        }
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

  // Freeze image display sizes if it's an IMG so markdown exporter knows its original layout size
  if (originalNode.tagName && originalNode.tagName.toLowerCase() === 'img') {
    const rect = originalNode.getBoundingClientRect ? originalNode.getBoundingClientRect() : null;
    const displayWidth = Math.round((rect && rect.width) || originalNode.clientWidth || originalNode.width || 0);
    const displayHeight = Math.round((rect && rect.height) || originalNode.clientHeight || originalNode.height || 0);
    if (displayWidth > 0) {
      clone.setAttribute('data-display-width', displayWidth);
      clone.setAttribute('data-display-height', displayHeight);
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

// Check if an element has a distinct authentic user bubble background color (blue, purple pill)
function hasUserBubbleStyle(el) {
  if (!el) return false;
  try {
    // Elements with rich assistant content are never user bubbles
    if (el.querySelector && el.querySelector('pre, table, .markdown, .prose, .ak-renderer-document, code.hljs')) {
      return false;
    }
    const cs = window.getComputedStyle(el);
    const bg = cs.backgroundColor || '';
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        const r = parseInt(match[1], 10);
        const g = parseInt(match[2], 10);
        const b = parseInt(match[3], 10);
        // Blue bubble: primary Atlaskit #0c66e4 is rgb(12, 102, 228), #0052cc is rgb(0, 82, 204), #0065ff is rgb(0, 101, 255)
        if (b > 130 && b > r + 20 && b > g + 20) return true;
        // Purple bubble: e.g. #7c3aed
        if (r > 100 && b > 180 && b > g + 30 && r > g + 30) return true;
      }
    }
  } catch (e) {}
  return false;
}

// Determines if a message node represents a user turn (prompt)
function isUserTurn(el) {
  if (!el) return false;

  // 1. Explicit author role attributes on el, descendants, or ancestors
  const authorRole = (el.getAttribute('data-message-author-role') || el.getAttribute('data-role') || el.getAttribute('role') || '').toLowerCase();
  if (authorRole === 'user' || authorRole === 'human') return true;
  if (authorRole === 'assistant' || authorRole === 'agent' || authorRole === 'model' || authorRole === 'bot') return false;

  const tagName = el.tagName ? el.tagName.toLowerCase() : '';
  if (tagName === 'user-query') return true;
  if (tagName === 'model-response' || tagName === 'message-content' || tagName === 'response-container' || tagName === 'structured-content-container') return false;
  if (el.className && typeof el.className === 'string' && (el.className.includes('presented-response') || el.className.includes('response-container') || el.className.includes('model-response'))) return false;

  // Rich assistant structures are never user turns unless explicitly tagged author="user"
  if (el.classList && el.classList.contains('ak-renderer-document')) return false;
  if (el.querySelector && el.querySelector('.ak-renderer-document, table, pre, code.hljs')) return false;

  const hasAsstChild = el.querySelector && el.querySelector(
    '[data-message-author-role="assistant"], model-response, message-content, response-container, [class*="presented-response" i], [class*="response-container" i], [class*="model-response" i], .markdown, div[class*="markdown" i]'
  );
  const hasUserChild = el.querySelector && el.querySelector(
    '[data-message-author-role="user"], user-query, [class*="user-query" i]'
  );
  // If container has BOTH user and assistant, it is a compound turn (not solely a user turn)
  if (hasAsstChild && hasUserChild) return false;
  if (hasUserChild) return true;
  if (hasAsstChild) return false;
  if (el.closest && el.closest('[data-message-author-role="user"]')) return true;

  // 2. Explicit User testid or class markers (excluding parent message containers that also match 'assistant' or 'agent')
  const testId = (el.getAttribute('data-testid') || '').toLowerCase();
  const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';

  const isExplicitAssistant = /\b(assistant|agent|model-response|message-content|response-container|bot-message|rovo-message)\b/i.test(testId) || 
                              /\b(assistant|agent|claude-message|rovo-assistant|presented-response|response-container)\b/i.test(className) ||
                              className.includes('model-response-text');

  if (!isExplicitAssistant) {
    if (/\b(user|human|query|prompt|sent)\b/i.test(testId) || /\b(user-message|font-user|usermessage|user_message|user-query)\b/i.test(className)) {
      return true;
    }
    if (el.querySelector && el.querySelector('[data-testid*="user" i], [class*="UserMessage" i], [class*="user-message" i], [class*="user_message" i]')) {
      return true;
    }
    if (el.closest && el.closest('[data-testid*="user" i], [class*="UserMessage" i], [class*="user-message" i]')) {
      return true;
    }
  }

  // 3. User bubble styling (Blue bubble on el or direct parent)
  if (hasUserBubbleStyle(el)) return true;
  if (el.parentElement && hasUserBubbleStyle(el.parentElement)) return true;
  if (el.closest && (el.closest('[style*="rgb(12, 102, 228)"]') || el.closest('[style*="rgb(0, 82, 204)"]') || el.closest('[style*="rgb(0, 101, 255)"]'))) {
    return true;
  }

  // 4. Layout alignment (right-aligned user bubbles)
  try {
    const cs = window.getComputedStyle(el);
    if (cs.marginLeft === 'auto' || cs.justifyContent === 'flex-end' || cs.alignSelf === 'flex-end' || cs.textAlign === 'right') {
      return true;
    }
    if (className.includes('self-end') || className.includes('items-end') || className.includes('justify-end')) {
      return true;
    }
  } catch (e) {}

  return false;
}

// Multi-Signal Role Classifier: scores an element to determine if it is a user turn or assistant turn
function classifyTurnRole(el, index = 0, totalTurns = 1) {
  if (!el) return 'assistant';
  
  // 1. Explicit author role attributes
  const authorRole = (el.getAttribute('data-message-author-role') || el.getAttribute('data-role') || el.getAttribute('role') || '').toLowerCase();
  if (authorRole === 'user' || authorRole === 'human') return 'user';
  if (authorRole === 'assistant' || authorRole === 'agent' || authorRole === 'model' || authorRole === 'bot') return 'assistant';

  // 2. Explicit tag names
  const tagName = el.tagName ? el.tagName.toLowerCase() : '';
  if (tagName === 'user-query') return 'user';
  if (tagName === 'model-response' || tagName === 'message-content' || tagName === 'response-container' || tagName === 'structured-content-container') return 'assistant';

  // 3. Explicit assistant classes / testids
  const testId = (el.getAttribute('data-testid') || '').toLowerCase();
  const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';

  if (/\b(assistant|agent|model-response|message-content|response-container|bot-message|rovo)\b/i.test(className) || 
      /\b(assistant|agent|model-response|message-content|response-container|bot-message|rovo)\b/i.test(testId) ||
      className.includes('model-response-text') ||
      className.includes('presented-response') ||
      className.includes('response-container') ||
      className.includes('single-draft-response')) {
    return 'assistant';
  }

  // 4. Prioritize explicit user turn markers
  if (isUserTurn(el)) return 'user';

  // 5. Rich Assistant Content Fingerprint (Tables, Code Blocks, Prose, Math, Smart Links)
  const hasCodeBlock = el.querySelector && el.querySelector('pre, code.hljs, [class*="code-block" i]') !== null;
  const hasTable = el.querySelector && el.querySelector('table') !== null;
  const hasMath = el.querySelector && el.querySelector('.katex, .MathJax, [data-math]') !== null;
  const hasSources = el.querySelector && el.querySelector('[data-testid*="source" i], [class*="source" i], [class*="citation" i]') !== null;
  const hasMarkdown = el.querySelector && el.querySelector('.markdown, [class*="markdown" i], .prose:not([class*="query" i])') !== null;
  const hasAkRenderer = (el.classList && el.classList.contains('ak-renderer-document')) || (el.querySelector && el.querySelector('.ak-renderer-document') !== null);

  if (hasAkRenderer || hasMarkdown || hasCodeBlock || hasTable || hasMath || hasSources) {
    return 'assistant';
  }

  // On Atlassian / Rovo platform: any turn in conversation that does not have .ak-renderer-document is a user prompt
  const isAtlassianRovo = (typeof window !== 'undefined' && window.location && (window.location.href.includes('atlassian') || window.location.href.includes('rovo')));
  if (isAtlassianRovo && !el.querySelector('.ak-renderer-document')) {
    return 'user';
  }

  // 6. Tie-breaker via alternating rhythm parity
  return index % 2 === 0 ? 'user' : 'assistant';
}

// Extract ChatGPT /share/ public page content (DOM and SSR JSON/Turbo-Stream payload fallback)
function extractChatGPTShareMessages() {
  const extracted = [];
  
  // 1. Try explicit author role elements first
  const explicitMessages = document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]');
  if (explicitMessages.length > 0) {
    const unique = getUniqueElements(explicitMessages);
    for (let i = 0; i < unique.length; i++) {
      const node = unique[i];
      const role = (node.getAttribute('data-message-author-role') || '').toLowerCase() === 'user' ? 'user' : 'assistant';
      extracted.push({ role, contentEl: node });
    }
    if (extracted.length > 0) return extracted;
  }

  // 2. Try DOM elements with [data-message-id] or articles and split compound turns
  const messageNodes = document.querySelectorAll('[data-message-id], [data-testid*="conversation-turn"], [data-testid*="message"], article');
  if (messageNodes.length > 0) {
    const unique = getUniqueElements(messageNodes);
    for (let i = 0; i < unique.length; i++) {
      const node = unique[i];
      const userEl = node.querySelector('[data-message-author-role="user"]') || node.querySelector('.font-user-message, div[class*="user-message" i], div[class*="user_message" i]');
      const asstEl = node.querySelector('[data-message-author-role="assistant"]') || node.querySelector('.markdown, div[class*="markdown" i], [class*="agent-turn" i]');
      if (userEl && asstEl && userEl !== asstEl) {
        extracted.push({ role: 'user', contentEl: userEl });
        extracted.push({ role: 'assistant', contentEl: asstEl });
      } else {
        const role = classifyTurnRole(node, i, unique.length);
        const contentEl = asstEl || userEl || 
                          node.querySelector('[data-message-author-role]') || 
                          node.querySelector('.whitespace-pre-wrap') || 
                          node;
        extracted.push({ role, contentEl });
      }
    }
    if (extracted.length > 0) return extracted;
  }

  // 3. Try querying .markdown containers and matching with prompt elements
  const allBlocks = getUniqueElements(document.querySelectorAll('h1, h2, h3, .whitespace-pre-wrap, .markdown, div[class*="markdown" i]'));
  if (allBlocks.length > 0) {
    for (let i = 0; i < allBlocks.length; i++) {
      const el = allBlocks[i];
      const role = classifyTurnRole(el, i, allBlocks.length);
      extracted.push({ role, contentEl: el });
    }
    if (extracted.length > 0) return extracted;
  }

  // 4. Fallback: Parse embedded JSON / Remix Turbo-Stream state
  try {
    // (A) Check React Router / Remix streamController.enqueue or window.__reactRouterContext
    const decodeTurbo = (turbo, index, seen = new Map()) => {
      if (seen.has(index)) return seen.get(index);
      const raw = turbo[index];
      if (raw === null || raw === undefined) return raw;
      if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
      if (Array.isArray(raw)) {
        const arr = [];
        seen.set(index, arr);
        for (const item of raw) {
          if (typeof item === 'number') {
            if (item === -1) arr.push(undefined);
            else if (item === -2) arr.push(null);
            else if (item === -3) arr.push(NaN);
            else if (item === -4) arr.push(Infinity);
            else if (item === -5) arr.push(-Infinity);
            else arr.push(decodeTurbo(turbo, item, seen));
          } else arr.push(item);
        }
        return arr;
      }
      if (typeof raw === 'object') {
        const obj = {};
        seen.set(index, obj);
        for (const [k, v] of Object.entries(raw)) {
          let realKey = k;
          if (k.startsWith('_')) {
            const keyIdx = parseInt(k.slice(1), 10);
            realKey = turbo[keyIdx];
          }
          let realVal = v;
          if (typeof v === 'number') {
            if (v === -1) realVal = undefined;
            else if (v === -2) realVal = null;
            else if (v === -3) realVal = NaN;
            else if (v === -4) realVal = Infinity;
            else if (v === -5) realVal = -Infinity;
            else realVal = decodeTurbo(turbo, v, seen);
          }
          obj[realKey] = realVal;
        }
        return obj;
      }
      return raw;
    };

    const foundMessages = [];
    const visited = new Set();
    const seenIds = new Set();
    let currentTurbo = null;

    const traverse = (obj) => {
      if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
      visited.add(obj);

      const target = (obj && obj.message && typeof obj.message === 'object') ? obj.message : obj;
      if (obj && obj.message && typeof obj.message === 'object') {
        visited.add(obj.message);
      }

      if (target && target.content && target.author) {
        const rawParts = target.content.parts || [];
        const parts = Array.isArray(rawParts) ? rawParts : [rawParts];
        const text = parts.map(p => (typeof p === 'number' && currentTurbo && currentTurbo[p]) ? currentTurbo[p] : p)
                          .filter(p => typeof p === 'string')
                          .join('\n').trim();
        const role = target.author.role === 'user' ? 'user' : (target.author.role === 'assistant' ? 'assistant' : null);
        const dedupeKey = target.id || (role + '|' + text);

        if (!seenIds.has(dedupeKey)) {
          seenIds.add(dedupeKey);
          if (role) {
            const meta = target.metadata || {};
            const isHidden = meta.is_visually_hidden_from_conversation || meta.is_user_system_message;
            if (text && !isHidden && text !== 'Original custom instructions no longer available') {
              let attachmentName = '';
              if (meta.attachments && meta.attachments.length > 0 && meta.attachments[0].name) {
                attachmentName = meta.attachments[0].name;
              }
              foundMessages.push({ role, text, attachmentName });
            }
          }
        }
      }

      if (Array.isArray(obj)) {
        for (const item of obj) traverse(item);
      } else {
        for (const key of Object.keys(obj)) {
          traverse(obj[key]);
        }
      }
    };

    // First try scripts with streamController.enqueue
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('streamController.enqueue')) {
        const match = text.match(/window\.__reactRouterContext\.streamController\.enqueue\(([\s\S]*?)\);?\s*$/m) ||
                      text.match(/streamController\.enqueue\(([\s\S]*?)\);?\s*$/m);
        if (match) {
          const rawArg = match[1].trim().replace(/\);?\s*$/, '');
          try {
            const turbo = JSON.parse(JSON.parse(rawArg));
            currentTurbo = turbo;
            const root = decodeTurbo(turbo, 0);
            traverse(root);
          } catch (e) {}
        }
      }
    }

    // Next try standard JSON script tags (__NEXT_DATA__, client-bootstrap)
    if (foundMessages.length === 0) {
      const jsonScripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__, script#client-bootstrap');
      for (const script of jsonScripts) {
        const raw = script.textContent.trim();
        if (!raw || (!raw.includes('mapping') && !raw.includes('linear_conversation') && !raw.includes('message') && !raw.includes('title'))) continue;
        try {
          const data = JSON.parse(raw);
          traverse(data);
        } catch (e) {}
      }
    }

    if (foundMessages.length > 0) {
      for (const m of foundMessages) {
        const div = document.createElement('div');
        div.setAttribute('data-message-author-role', m.role);
        if (m.attachmentName) {
          const attachEl = document.createElement('div');
          attachEl.className = 'ai-exporter-file-attachment';
          attachEl.setAttribute('data-filename', m.attachmentName);
          attachEl.textContent = m.attachmentName;
          div.appendChild(attachEl);
        }
        const textEl = document.createElement('div');
        textEl.className = m.role === 'assistant' ? 'markdown' : 'whitespace-pre-wrap';
        textEl.setAttribute('data-raw-markdown', 'true');
        textEl.textContent = m.text;
        div.appendChild(textEl);
        extracted.push({ role: m.role, contentEl: div });
      }
      return extracted;
    }
  } catch (e) {
    console.warn('Failed to parse share page JSON/Turbo payload:', e);
  }

}

// Extract ChatGPT live web application content (robust multi-variant discovery)
function extractChatGPTLiveMessages(root = document) {
  const extracted = [];
  const url = typeof window !== 'undefined' && window.location ? window.location.href : '';
  const isShare = url.includes('/share/');

  // 0. Share page extraction if URL is /share/
  if (isShare) {
    const shareTurns = extractChatGPTShareMessages();
    if (shareTurns.length > 0) return shareTurns;
  }

  const isInsideComposerOrNav = (el) => {
    if (!el) return true;
    if (el.closest && el.closest('form:not([class*="message"]), nav, aside, [data-testid="composer"], [data-testid*="sidebar" i], [aria-label*="sidebar" i]')) {
      return true;
    }
    return false;
  };

  // 1. Explicit author role elements
  const explicit = Array.from(root.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
    .filter(el => !isInsideComposerOrNav(el))
    .filter(el => {
      if (el.getAttribute('aria-hidden') === 'true' || (el.closest && el.closest('[aria-hidden="true"]'))) return false;
      if (el.classList && (el.classList.contains('sr-only') || el.classList.contains('invisible'))) return false;
      return true;
    });
  if (explicit.length > 0) {
    const uniqueExplicit = getUniqueElements(explicit);
    Logger.stage2(`Matched ${uniqueExplicit.length} explicit author-role ChatGPT turns.`);
    return uniqueExplicit.map(el => ({
      role: (el.getAttribute('data-message-author-role') || '').toLowerCase(),
      contentEl: el
    }));
  }

  // 2. Conversation turn cards / containers
  const turnContainers = Array.from(root.querySelectorAll(
    'article, [data-testid^="conversation-turn-"], [data-testid*="conversation-turn" i], div[class*="conversation-turn" i], div[class*="agent-turn" i], div[class*="user-turn" i]'
  )).filter(el => !isInsideComposerOrNav(el));

  if (turnContainers.length > 0) {
    const uniqueTurns = getUniqueElements(turnContainers);
    Logger.stage2(`Matched ${uniqueTurns.length} ChatGPT turn containers.`);
    for (let i = 0; i < uniqueTurns.length; i++) {
      const art = uniqueTurns[i];
      const userSub = art.querySelector('[data-message-author-role="user"], .font-user-message, div[class*="user-message" i], div[class*="user_message" i], .whitespace-pre-wrap');
      const asstSub = art.querySelector('[data-message-author-role="assistant"], .markdown, div[class*="markdown" i], [class*="agent-turn" i], .prose');
      if (userSub && asstSub && userSub !== asstSub && !asstSub.contains(userSub) && !userSub.contains(asstSub)) {
        extracted.push({ role: 'user', contentEl: userSub });
        extracted.push({ role: 'assistant', contentEl: asstSub });
      } else {
        const role = classifyTurnRole(art, i, uniqueTurns.length);
        const contentEl = (role === 'assistant' ? (asstSub || art) : (userSub || art));
        extracted.push({ role, contentEl });
      }
    }
    if (extracted.length > 0) return extracted;
  }

  // 3. Fallback: Direct Content Block Walker inside main
  // In ChatGPT, all assistant messages contain .markdown / .prose, and user messages contain .whitespace-pre-wrap
  const mainEl = root.querySelector('main, [role="main"]') || root.body || root;
  const markdownBlocks = Array.from(mainEl.querySelectorAll('.markdown, div[class*="markdown" i], .prose'))
    .filter(el => !isInsideComposerOrNav(el));

  if (markdownBlocks.length > 0) {
    Logger.stage2(`Found ${markdownBlocks.length} markdown response blocks in ChatGPT main.`);
    const userBlocks = Array.from(mainEl.querySelectorAll('.whitespace-pre-wrap, div[class*="user" i], .font-user-message'))
      .filter(el => !isInsideComposerOrNav(el) && !markdownBlocks.some(mb => mb.contains(el)));

    const allCandidateNodes = [];
    userBlocks.forEach(u => allCandidateNodes.push({ role: 'user', contentEl: u }));
    markdownBlocks.forEach(m => allCandidateNodes.push({ role: 'assistant', contentEl: m }));

    // If user prompt blocks weren't captured by class, look for preceding siblings
    if (userBlocks.length === 0) {
      for (const mb of markdownBlocks) {
        let p = mb.parentElement;
        while (p && p !== mainEl) {
          if (p.previousElementSibling && !p.previousElementSibling.querySelector('.markdown') && p.previousElementSibling.textContent.trim().length > 0) {
            allCandidateNodes.push({ role: 'user', contentEl: p.previousElementSibling });
            break;
          }
          p = p.parentElement;
        }
      }
    }

    allCandidateNodes.sort((a, b) => {
      if (a.contentEl && b.contentEl && a.contentEl.compareDocumentPosition) {
        const pos = a.contentEl.compareDocumentPosition(b.contentEl);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      }
      return 0;
    });

    for (const item of allCandidateNodes) {
      if (item.contentEl && item.contentEl.textContent.trim().length > 0) {
        extracted.push(item);
      }
    }
    if (extracted.length > 0) return extracted;
  }

  // 4. Share page fallback if URL is /share/
  if (isShare) {
    return extractChatGPTShareMessages();
  }

  return extracted;
}

// Extract Gemini live web application content (pairwise .conversation-container cards and elements)
function extractGeminiLiveMessages(root = document) {
  const extracted = [];
  const containers = Array.from(root.querySelectorAll('.conversation-container, div[class*="conversation-container" i], [class*="conversation-turn" i], [class*="chat-turn" i]'));
  Logger.stage2(`Inspecting ${containers.length} live conversation container elements...`);

  const processedElements = new Set();

  if (containers.length > 0) {
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i];
      const userEl = c.querySelector('user-query');
      let asstEl = c.querySelector('message-content') ||
                   c.querySelector('structured-content-container') ||
                   c.querySelector('model-response') ||
                   c.querySelector('response-container') ||
                   c.querySelector('[class*="presented-response" i]') ||
                   c.querySelector('[class*="model-response-text" i]') ||
                   c.querySelector('.markdown, div[class*="markdown" i]');

      // Direct sibling walk within conversation card if not found by selector
      if (!asstEl && userEl) {
        let sib = userEl.nextElementSibling;
        while (sib) {
          if (!sib.matches('user-query') && sib.textContent.trim().length > 0) {
            asstEl = sib;
            break;
          }
          sib = sib.nextElementSibling;
        }
      }

      if (userEl) {
        processedElements.add(userEl);
        extracted.push({ role: 'user', contentEl: userEl });
      }
      if (asstEl) {
        processedElements.add(asstEl);
        const deepContent = asstEl.querySelector('message-content, structured-content-container, [class*="presented-response" i], .markdown');
        extracted.push({ role: 'assistant', contentEl: deepContent || asstEl });
      }

      Logger.stage2(`[Live Card ${i + 1}/${containers.length}] Q: ${userEl ? 'found (<' + userEl.tagName + '>)' : 'MISSING'}, A: ${asstEl ? 'found (<' + asstEl.tagName + '>, ' + asstEl.textContent.trim().length + ' chars)' : 'MISSING'}`);
    }
  }

  // Safety check: capture any user-query elements outside standard container wrappers (e.g. initial turn or custom wrappers)
  const allUserQueries = Array.from(root.querySelectorAll('user-query'));
  const uncapturedQueries = allUserQueries.filter(el => !processedElements.has(el) && !Array.from(processedElements).some(p => p.contains(el) || el.contains(p)));
  if (uncapturedQueries.length > 0) {
    Logger.stage2(`Found ${uncapturedQueries.length} uncaptured user-query elements outside containers. Capturing...`);
    for (const uq of uncapturedQueries) {
      extracted.push({ role: 'user', contentEl: uq });
      let sib = uq.nextElementSibling;
      let foundAsst = null;
      while (sib) {
        if (sib.matches && (sib.matches('model-response, response-container, message-content, [class*="model-response" i]') || sib.querySelector('model-response, response-container, message-content'))) {
          foundAsst = sib;
          break;
        }
        sib = sib.nextElementSibling;
      }
      if (foundAsst) {
        const deep = foundAsst.querySelector('message-content, structured-content-container, .markdown') || foundAsst;
        extracted.push({ role: 'assistant', contentEl: deep });
      }
    }
  }

  return extracted;
}

// Extract Gemini /share/ public page content (DOM pairwise structure)
function extractGeminiShareMessages(root = document) {
  const extracted = [];
  const viewers = root.querySelectorAll('share-turn-viewer');
  Logger.stage2(`Inspecting ${viewers.length} <share-turn-viewer> elements...`);

  if (viewers.length > 0) {
    for (let i = 0; i < viewers.length; i++) {
      const v = viewers[i];
      const userEl = v.querySelector('user-query');
      let asstEl = v.querySelector('message-content') || 
                   v.querySelector('response-container') ||
                   v.querySelector('[class*="presented-response" i]') ||
                   v.querySelector('[class*="response-container" i]') ||
                   v.querySelector('structured-content-container') ||
                   v.querySelector('model-response') ||
                   v.querySelector('[class*="model-response-text" i]') || 
                   v.querySelector('.markdown, div[class*="markdown" i]') ||
                   v.querySelector('[class*="response" i]');

      // Check shadowRoot if not found in light DOM
      if (!asstEl && v.shadowRoot) {
        asstEl = v.shadowRoot.querySelector('message-content, response-container, [class*="presented-response" i], structured-content-container, model-response, .markdown');
      }

      // Check siblings within viewer container (Angular custom element slot or wrapper)
      if (!asstEl && userEl) {
        let sib = userEl.nextElementSibling;
        while (sib) {
          if (!sib.matches('user-query') && sib.textContent.trim().length > 0) {
            asstEl = sib;
            break;
          }
          sib = sib.nextElementSibling;
        }
      }

      // Check viewer's next sibling if asstEl was mounted outside viewer
      if (!asstEl) {
        let sib = v.nextElementSibling;
        while (sib) {
          if (!sib.matches('share-turn-viewer') && sib.textContent.trim().length > 0) {
            asstEl = sib;
            break;
          }
          sib = sib.nextElementSibling;
        }
      }

      if (userEl) {
        extracted.push({ role: 'user', contentEl: userEl });
      }
      if (asstEl) {
        extracted.push({ role: 'assistant', contentEl: asstEl });
      }

      Logger.stage2(`[Viewer ${i + 1}/${viewers.length}] Q: ${userEl ? 'found (<' + userEl.tagName + '>)' : 'MISSING'}, A: ${asstEl ? 'found (<' + asstEl.tagName + '>, ' + asstEl.textContent.trim().length + ' chars)' : 'MISSING'}`);
    }
  }
  return extracted;
}

// Extract Perplexity queries, answers, search sources, and tables
function extractPerplexityMessages() {
  const extracted = [];
  
  const allCandidates = Array.from(document.querySelectorAll(
    '[data-testid*="query" i], [data-testid*="answer" i], [class*="query" i], [class*="answer" i], ' +
    '[class*="prose" i], .default.font-sans, h1.text-textMain, div[class*="Query" i], div[class*="Answer" i]'
  )).filter(el => {
    if (el.closest('form, footer, [class*="composer" i], [class*="toolbar" i], nav, header')) return false;
    if (el.querySelector('textarea, input[type="text"]:not([readonly])')) return false;
    return true;
  });

  const uniqueTurns = getUniqueElements(allCandidates);
  for (let i = 0; i < uniqueTurns.length; i++) {
    const turn = uniqueTurns[i];
    const role = classifyTurnRole(turn, i, uniqueTurns.length);
    extracted.push({ role, contentEl: turn });
  }

  return extracted;
}

// Adaptive Thread & Turn Discovery across any AI chat interface
function extractAdaptiveTurns(root = document.body) {
  const isComposerOrNav = (el) => {
    if (!el) return true;
    if (el.closest && el.closest('form, footer, nav, header, [data-testid*="composer" i], [data-testid*="prompt-box" i], [class*="composer" i], [class*="toolbar" i]')) {
      return true;
    }
    if (el.querySelector && el.querySelector('textarea, input[type="text"]:not([readonly]), [contenteditable="true"]')) {
      return true;
    }
    return false;
  };

  const candidateSelectors = [
    'article',
    'user-query',
    'model-response',
    '[data-message-id]',
    '[data-message-author-role]',
    '[data-testid*="message" i]',
    '[data-testid*="turn" i]',
    '[data-testid*="query" i]',
    '[data-testid*="answer" i]',
    '.user-message',
    '.assistant-message',
    '.claude-message',
    '.font-user-message',
    '.font-claude-message',
    '.markdown',
    '.prose',
    'div[class*="message" i]',
    'div[class*="chat-turn" i]',
    'div[class*="bubble" i]'
  ];

  const rawCandidates = Array.from(root.querySelectorAll(candidateSelectors.join(', ')))
    .filter(el => !isComposerOrNav(el));

  const uniqueTurns = getUniqueElements(rawCandidates).filter(el => {
    if (isComposerOrNav(el)) return false;
    const text = el.textContent.trim();
    const hasMedia = el.querySelector('img, canvas, svg, iframe');
    return text.length > 0 || hasMedia !== null;
  });

  const extracted = [];
  for (let i = 0; i < uniqueTurns.length; i++) {
    const turn = uniqueTurns[i];
    const role = classifyTurnRole(turn, i, uniqueTurns.length);
    extracted.push({ role, contentEl: turn });
  }

  return extracted;
}

// Helper to find the actual scrollable conversation container
function findChatScrollContainer() {
  // 1. Walk up from any rendered message or document, strictly avoiding sidebars
  const sample = document.querySelector(
    'article, [data-testid*="conversation-turn" i], [data-message-author-role], .markdown, div[class*="markdown" i], [data-message-id], .ak-renderer-document, [data-testid*="message" i], [class*="message" i], [class*="bubble" i], [data-testid*="user-message" i], user-query, message-content, model-response, .conversation-container, div[class*="conversation-container" i]'
  );
  if (sample) {
    let p = sample.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      if (p.closest && p.closest('nav, aside, [aria-label*="sidebar" i], [data-testid*="sidebar" i]')) {
        p = p.parentElement;
        continue;
      }
      const style = window.getComputedStyle(p);
      const ov = style.overflowY || style.overflow;
      if (/(auto|scroll|overlay)/.test(ov) && p.scrollHeight > p.clientHeight + 40) {
        return p;
      }
      p = p.parentElement;
    }
  }

  // Direct check for known chat scroller tags/classes inside main
  const knownScroller = document.querySelector('main infinite-scroller, main [class*="infinite-scroller" i], main [class*="chat-history" i], main chat-window, main [class*="chat-scroll" i], main [class*="react-scroll-to-bottom" i], infinite-scroller, [class*="react-scroll-to-bottom" i]');
  if (knownScroller && knownScroller.scrollHeight > knownScroller.clientHeight + 40) {
    const style = window.getComputedStyle(knownScroller);
    const ov = style.overflowY || style.overflow;
    if (/(auto|scroll|overlay)/.test(ov)) {
      return knownScroller;
    }
  }

  // 2. Scan all block elements with scrollable overflow inside main FIRST
  const mainEl = document.querySelector('main, [role="main"]');
  const mainCandidates = mainEl ? Array.from(mainEl.querySelectorAll('div, section, [class*="scroller" i]')) : [];
  let best = null;
  let maxDiff = 0;
  for (const el of mainCandidates) {
    const diff = el.scrollHeight - el.clientHeight;
    if (diff > maxDiff && el.clientHeight > 150) {
      const style = window.getComputedStyle(el);
      const ov = style.overflowY || style.overflow;
      if (/(auto|scroll|overlay)/.test(ov)) {
        best = el;
        maxDiff = diff;
      }
    }
  }
  if (best) return best;

  // 3. Fallback across document, strictly avoiding nav and aside sidebars
  const candidates = Array.from(document.querySelectorAll('div, main, section, infinite-scroller, chat-window, mat-sidenav-content, [class*="scroller" i], [class*="chat" i]'))
    .filter(el => !el.closest('nav, aside, [aria-label*="sidebar" i], [data-testid*="sidebar" i]'));
  for (const el of candidates) {
    const diff = el.scrollHeight - el.clientHeight;
    if (diff > maxDiff && el.clientHeight > 150) {
      const style = window.getComputedStyle(el);
      const ov = style.overflowY || style.overflow;
      if (/(auto|scroll|overlay)/.test(ov)) {
        best = el;
        maxDiff = diff;
      }
    }
  }
  return best || document.scrollingElement || document.documentElement;
}

/**
 * STAGE 1: Mount & Sweep Engine
 * Ensures any dynamic/virtualized chat container mounts its full conversational tree
 * by systematically traversing from top to bottom.
 */
class ChatMountEngine {
  constructor(options = {}) {
    this.options = Object.assign({
      stepFraction: 0.7,
      stepMin: 350,
      stepDelayMs: 60,
      initialTopDelayMs: 400,
      maxUpwardIterations: 12
    }, options);
  }

  async sweep() {
    Logger.stage1('Starting dynamic conversational mount sweep...');
    try {
      window.dispatchEvent(new Event('beforeprint'));
    } catch (e) {}
    await new Promise(r => setTimeout(r, 100));

    const hiddenOverlays = hideOverlays();
    const savedScroll = saveScrollPositions();

    const innerScroller = findChatScrollContainer();
    const isDoc = !innerScroller || innerScroller === document.documentElement || innerScroller === document.body;

    const initialScrollTop = isDoc ? window.scrollY : innerScroller.scrollTop;
    const clientHeight = innerScroller && !isDoc ? innerScroller.clientHeight : window.innerHeight;
    let totalTraversed = 0;

    Logger.stage1(`Active scroll container: <${innerScroller ? innerScroller.tagName : 'WINDOW'}${innerScroller && innerScroller.className ? '.' + String(innerScroller.className).slice(0, 40) : ''}>, clientHeight: ${clientHeight}`);

    const scrollBothTo = (top) => {
      try {
        if (innerScroller && innerScroller !== document.documentElement && innerScroller !== document.body) {
          innerScroller.scrollTop = top;
          innerScroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        window.scrollTo({ top, behavior: 'instant' });
        window.dispatchEvent(new Event('scroll'));
        if (document.documentElement) {
          document.documentElement.scrollTop = top;
        }
        if (document.body) {
          document.body.scrollTop = top;
        }
      } catch (e) {}
    };

    const getTurnCount = () => {
      return document.querySelectorAll(
        '.conversation-container, div[class*="conversation-container" i], user-query, [data-testid*="message" i], [class*="message" i], [class*="chat-turn" i], [class*="bubble" i], [data-message-author-role]'
      ).length;
    };

    const getFirstTurnSignature = () => {
      const first = document.querySelector(
        '.conversation-container, div[class*="conversation-container" i], user-query, [data-testid*="message" i], [class*="chat-turn" i]'
      );
      return first ? (first.id || first.textContent.trim().slice(0, 80)) : '';
    };

    const getScrollHeight = () => {
      return innerScroller && !isDoc ? innerScroller.scrollHeight : (document.documentElement ? document.documentElement.scrollHeight : 0);
    };

    try {
      // 1. UPWARD MOUNT CONVERGENCE LOOP:
      // In virtualized chats (Gemini, ChatGPT, etc.), older history is dynamically prepended when scrolled to top.
      // Pulse to top repeatedly until no new turns or content appear.
      let prevCount = getTurnCount();
      let prevFirstSig = getFirstTurnSignature();
      let prevScrollHeight = getScrollHeight();
      let stableUpwardRounds = 0;

      Logger.stage1(`Initiating upward mount loop (initial turns: ${prevCount}, scrollHeight: ${prevScrollHeight})...`);

      for (let iteration = 0; iteration < this.options.maxUpwardIterations; iteration++) {
        scrollBothTo(0);

        // Wait for potential network fetch / rendering of prepended history
        await new Promise(r => setTimeout(r, iteration === 0 ? this.options.initialTopDelayMs : 300));

        // Check if loading spinner is currently visible
        const hasSpinner = !!document.querySelector('mat-progress-spinner, mat-spinner, [class*="loading" i], [class*="spinner" i], [role="progressbar"]');
        if (hasSpinner) {
          Logger.stage1('[Upward Mount] Loading indicator detected. Waiting for prepended batch to settle...');
          await new Promise(r => setTimeout(r, 400));
        }

        const newCount = getTurnCount();
        const newFirstSig = getFirstTurnSignature();
        const newScrollHeight = getScrollHeight();

        const prependedTurns = newCount > prevCount;
        const firstTurnChanged = newFirstSig !== prevFirstSig && newFirstSig.length > 0;
        const heightExpanded = newScrollHeight > prevScrollHeight + 50;

        if (prependedTurns || firstTurnChanged || heightExpanded) {
          Logger.stage1(`[Upward Mount Iteration ${iteration + 1}] Detected new earlier content prepended (turns: ${prevCount} -> ${newCount}, height: ${prevScrollHeight} -> ${newScrollHeight}).`);
          prevCount = newCount;
          prevFirstSig = newFirstSig;
          prevScrollHeight = newScrollHeight;
          stableUpwardRounds = 0;
        } else {
          stableUpwardRounds++;
          // Require at least 2 consecutive stable rounds at scrollTop = 0 to confirm top of chat history reached
          if (stableUpwardRounds >= (iteration === 0 ? 2 : 1)) {
            Logger.stage1(`[Upward Mount] Reached top of conversation history after ${iteration + 1} iterations (total turns: ${newCount}).`);
            break;
          }
        }
      }

      // 2. DOWNWARD SWEEP:
      // Traverse top-to-bottom so lazy renderers (KaTeX/LaTeX, tables, syntax highlighters, images) hydrate into DOM.
      let scrollHeight = isDoc ? (document.documentElement ? document.documentElement.scrollHeight : 0) : innerScroller.scrollHeight;
      let maxScroll = Math.max(0, scrollHeight - clientHeight);
      Logger.stage1(`Downward sweep bounds: scrollHeight=${scrollHeight}, maxScroll=${maxScroll}`);

      if (maxScroll > 50) {
        let curr = 0;
        let stepCount = 0;
        const maxSteps = 15;
        let step = Math.max(this.options.stepMin, Math.floor(clientHeight * 1.5));
        if (maxScroll / step > maxSteps) {
          step = Math.ceil(maxScroll / maxSteps);
        }

        while (curr < maxScroll) {
          curr = Math.min(curr + step, maxScroll);
          scrollBothTo(curr);

          await new Promise(r => setTimeout(r, this.options.stepDelayMs));
          totalTraversed = curr;
          stepCount++;

          scrollHeight = isDoc ? (document.documentElement ? document.documentElement.scrollHeight : 0) : innerScroller.scrollHeight;
          maxScroll = Math.max(0, scrollHeight - clientHeight);
          if (curr >= maxScroll) break;
        }
        Logger.stage1(`Completed downward sweep: ${stepCount} steps across ${totalTraversed}px.`);
      }

      // GATE 1: Verify Mount Settle
      const gate1 = this.verifyGate1({ isDoc, totalTraversed, maxScroll });
      Logger.gate('Gate 1 (Mount Sweep)', gate1.passed, gate1.reason);

      return { success: true, totalTraversed, gate1, savedScroll, hiddenOverlays };
    } finally {
      try {
        window.dispatchEvent(new Event('afterprint'));
      } catch (e) {}
      if (!this.options.skipRestore) {
        restoreScrollPositions(savedScroll);
        restoreOverlays(hiddenOverlays);
      }
    }
  }

  verifyGate1({ isDoc, totalTraversed, maxScroll }) {
    if (!document.body || document.body.children.length === 0) {
      return { passed: false, reason: 'Document body is empty after sweep.' };
    }
    return { passed: true, reason: 'DOM mounted and swept successfully.' };
  }
}

/**
 * STAGE 2: Comprehensive Chat Element & Turn Inventory Engine
 * Inspects all conversation islands, catalogs sub-components (tables, code blocks,
 * charts, images, surveys, sources), and indexes them in exact natural DOM order.
 */
class ChatInventoryEngine {
  constructor(options = {}) {
    this.options = options;
  }

  async inspect(platform) {
    const url = typeof window !== 'undefined' && window.location ? window.location.href : '';
    Logger.stage2(`Inspecting chat elements for platform: ${platform} (URL: ${url})`);

    let candidateTurns = [];

    // 1. Platform-specific island discovery
    if (platform === 'ChatGPT' || url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
      candidateTurns = extractChatGPTLiveMessages(document);
    } else if (platform === 'Claude' || url.includes('claude.ai')) {
      const claudeEls = Array.from(document.querySelectorAll(
        '.font-user-message, .font-claude-message, [data-testid="user-message"], [data-testid="assistant-message"], ' +
        'div[class*="font-user"], div[class*="font-claude"], div[class*="user-message"], div[class*="claude-message"], ' +
        'div[class*="assistant-message"], .user-message, .claude-message'
      ));
      const unique = getUniqueElements(claudeEls);
      Logger.stage2(`Matched ${unique.length} Claude message elements.`);
      candidateTurns = unique.map((el, i) => ({
        role: classifyTurnRole(el, i, unique.length),
        contentEl: el
      }));
    } else if (platform === 'Perplexity' || url.includes('perplexity.ai')) {
      Logger.stage2('Extracting Perplexity questions and answers...');
      candidateTurns = extractPerplexityMessages();
    } else if (platform === 'Rovo' || url.includes('atlassian')) {
      const isComposerOrToolbar = (el) => {
        if (!el) return false;
        if (el.matches && el.matches('form, [data-testid="composer"], [data-testid="chat-composer"], footer[role="contentinfo"]')) return true;
        if (el.closest && el.closest('form, [data-testid="composer"], [data-testid="chat-composer"], footer[role="contentinfo"]')) return true;
        if (el.querySelector && el.querySelector('textarea:not([readonly]), [contenteditable="true"]:not([contenteditable="false"])')) return true;
        return false;
      };
      const rovoSelectors = [
        '[data-testid="chat-message"]:not([data-testid*="list"]):not([data-testid*="scroll"])',
        '[data-testid*="message-item" i]',
        'div[class*="MessageRow" i]:not([class*="list" i]):not([class*="container" i])',
        'div[class*="message-row" i]:not([class*="list" i]):not([class*="container" i])',
        'div[class*="ChatMessage" i]:not([class*="list" i]):not([class*="container" i]):not([class*="wrapper" i])',
        'div[class*="chat-message" i]:not([class*="list" i]):not([class*="container" i]):not([class*="wrapper" i])',
        '[data-testid*="user" i]',
        'div[class*="User" i]:not([class*="list" i]):not([class*="container" i])',
        'div[class*="user" i]:not([class*="list" i]):not([class*="container" i])',
        'div[class*="bubble" i]',
        'div[class*="Bubble" i]',
        '.ak-renderer-document',
        '[data-testid*="assistant-message" i]',
        '[data-testid*="rovo-message" i]',
        '[data-testid*="agent-message" i]',
        'div[class*="AgentMessage" i]',
        'div[class*="AssistantMessage" i]',
        'div[class*="RovoMessage" i]',
        'div[class*="agent-message" i]',
        'div[class*="assistant-message" i]'
      ].join(', ');
      const rovoEls = Array.from(document.querySelectorAll(rovoSelectors)).filter(el => !isComposerOrToolbar(el));
      const unique = getUniqueElements(rovoEls);
      Logger.stage2(`Matched ${unique.length} Rovo conversational items.`);
      candidateTurns = unique.map((el, i) => ({
        role: classifyTurnRole(el, i, unique.length),
        contentEl: el
      }));
    } else if (platform === 'Grok' || url.includes('grok.com') || url.includes('x.com')) {
      const grokEls = Array.from(document.querySelectorAll(
        'div[class*="message" i], div[class*="bubble" i], div[class*="chat-turn" i], div[data-testid*="message" i]'
      ));
      const unique = getUniqueElements(grokEls);
      Logger.stage2(`Matched ${unique.length} Grok message elements.`);
      candidateTurns = unique.map((el, i) => ({
        role: classifyTurnRole(el, i, unique.length),
        contentEl: el
      }));
    } else if (platform === 'Gemini' || url.includes('gemini.google') || document.querySelectorAll('share-turn-viewer').length > 0 || document.querySelectorAll('.conversation-container, div[class*="conversation-container" i]').length > 0) {
      const isShare = url.includes('/share/') || url.includes('share.gemini.google') || document.querySelectorAll('share-turn-viewer').length > 0;
      if (isShare) {
        Logger.stage2('Using Gemini share page viewer extractor...');
        const shareTurns = extractGeminiShareMessages(document);
        const hasAsst = shareTurns.some(t => t.role === 'assistant');
        if (shareTurns.length > 0 && hasAsst) {
          candidateTurns = shareTurns;
          Logger.stage2(`Extracted ${shareTurns.length} pairwise turns from share-turn-viewer.`);
        }
      }
      if (candidateTurns.length === 0) {
        // Live Gemini conversation-container turn cards
        const liveTurns = extractGeminiLiveMessages(document);
        const hasAsst = liveTurns.some(t => t.role === 'assistant');
        if (liveTurns.length > 0 && hasAsst) {
          candidateTurns = liveTurns;
          Logger.stage2(`Extracted ${liveTurns.length} pairwise turns from live Gemini conversation-container cards.`);
        }
      }
      if (candidateTurns.length === 0) {
        Logger.stage2('Querying live Gemini elements from light and custom element DOM...');
        const liveElements = Array.from(document.querySelectorAll(
          'user-query, response-container, [class*="presented-response" i], [class*="response-container" i], ' +
          '[class*="single-draft-response" i], .single-draft-response-container, ' +
          'structured-content-container, message-content, model-response, [class*="model-response-text" i], ' +
          '[class*="query-text" i], .query-text-container, .model-response-container'
        ));
        const unique = getUniqueElements(liveElements);
        candidateTurns = unique.map((el, i) => ({
          role: classifyTurnRole(el, i, unique.length),
          contentEl: el
        }));
        Logger.stage2(`Matched ${unique.length} unique Gemini live elements.`);
      }
    }

    // Dynamic mount retry if primary discovery yielded 0 turns (e.g. freshly reloaded tab)
    if (candidateTurns.length === 0 && (platform === 'ChatGPT' || url.includes('chatgpt.com') || url.includes('chat.openai.com'))) {
      Logger.stage2('Primary discovery yielded 0 turns on ChatGPT. Waiting 800ms for dynamic messages mount...');
      await new Promise(r => setTimeout(r, 800));
      candidateTurns = extractChatGPTLiveMessages(document);
    }

    // Universal Adaptive Turn Discovery fallback if primary query yielded nothing
    if (candidateTurns.length === 0) {
      Logger.stage2('Primary discovery yielded 0 turns. Running Universal Adaptive Turn Discovery...');
      const adaptive = extractAdaptiveTurns(document.body);
      candidateTurns = adaptive.map(t => ({ role: t.role, contentEl: t.contentEl }));
      Logger.stage2(`Adaptive Turn Discovery identified ${candidateTurns.length} candidate turns.`);
    }

    // 2. Sort candidate turns strictly by natural loaded DOM document order
    candidateTurns.sort((a, b) => {
      if (a.contentEl && b.contentEl && a.contentEl.isConnected && b.contentEl.isConnected && a.contentEl.compareDocumentPosition) {
        const pos = a.contentEl.compareDocumentPosition(b.contentEl);
        if (pos & (Node.DOCUMENT_POSITION_DISCONNECTED || 1)) return 0;
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      }
      return 0;
    });

    // 3. Catalog and normalize each turn & inventory sub-components
    let { inventory, stats } = await this.buildInventory(candidateTurns, platform, url);

    // GATE 2 INTEGRITY CHECK & SELF-HEALING AUTO-RECOVERY
    if (stats.userCount > 1 && stats.asstCount === 0) {
      Logger.recovery(`Detected ${stats.userCount} user questions but 0 assistant responses. Attempting self-healing recovery...`);
      candidateTurns = this.recoverInterstitialAssistantTurns(candidateTurns);
      // Rebuild inventory with recovered turns
      const rebuilt = await this.buildInventory(candidateTurns, platform, url);
      inventory = rebuilt.inventory;
      stats = rebuilt.stats;
      Logger.recovery(`Post-recovery inventory stats: userCount=${stats.userCount}, asstCount=${stats.asstCount}, tables=${stats.tables}, codeBlocks=${stats.codeBlocks}`);
    }

    // Verify Gate 2
    const gate2 = this.verifyGate2(inventory, stats);
    Logger.gate('Gate 2 (Structural Integrity)', gate2.passed, gate2.passed ? `Verified ${stats.userCount} questions, ${stats.asstCount} answers, ${stats.tables} tables, ${stats.codeBlocks} code blocks` : gate2.reason);
    if (!gate2.passed) {
      Logger.error('Gate 2 Structural Integrity Check FAILED. Diagnostic dump:', {
        inventoryCount: inventory.length,
        userCount: stats.userCount,
        asstCount: stats.asstCount,
        candidateTurnsCount: candidateTurns.length
      });
      throw new Error(`Gate 2 Integrity Violation: ${gate2.reason}`);
    }

    return {
      success: true,
      turns: inventory,
      stats,
      gate2
    };
  }

  async buildInventory(candidateTurns, platform, url) {
    const inventory = [];
    const stats = {
      userCount: 0,
      asstCount: 0,
      tables: 0,
      codeBlocks: 0,
      charts: 0,
      media: 0,
      surveys: 0
    };

    for (let i = 0; i < candidateTurns.length; i++) {
      const { role, contentEl } = candidateTurns[i];
      if (!contentEl) continue;

      // Deep clone node into isolated memory with shadow roots & canvases preserved
      const clone = deepCloneWithShadowsAndSvgs(contentEl);

      // Merge associated subsequent media attachment cards on Atlassian Rovo
      if (role === 'user' && i + 1 < candidateTurns.length && (platform === 'Rovo' || url.includes('atlassian'))) {
        const nextTurn = candidateTurns[i + 1];
        const nextEl = nextTurn && nextTurn.contentEl ? nextTurn.contentEl : null;
        if (nextEl && nextEl.matches && nextEl.matches('[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i]')) {
          const nextClone = deepCloneWithShadowsAndSvgs(nextEl);
          clone.appendChild(nextClone);
          i++;
        }
      }

      // Normalizations
      if (platform === 'Rovo' || url.includes('atlassian')) {
        normalizeSmartLinksAndLists(clone);
      }
      if (platform === 'Gemini' || url.includes('gemini.google')) {
        normalizeGeminiTurn(clone, role);
      }

      cleanNoise(clone);
      await processImages(clone);

      const text = clone.textContent.trim();
      const hasMedia = clone.querySelector('img, canvas, svg, iframe, table');
      if (!text && !hasMedia) {
        Logger.stage2(`[Turn ${i + 1}] Filtered out empty turn <${contentEl.tagName}>`);
        continue;
      }

      // Deduplicate consecutive identical or subset turns (e.g. ChatGPT responsive/sr duplicates)
      const lastTurn = inventory.length > 0 ? inventory[inventory.length - 1] : null;
      if (lastTurn && lastTurn.role === role) {
        const lastText = (lastTurn.clone ? lastTurn.clone.textContent : '').trim().replace(/\s+/g, ' ');
        const currText = text.replace(/\s+/g, ' ');

        // Case 1: Exact duplicate
        if (lastText === currText) {
          Logger.stage2(`[Turn ${i + 1}] Skipping exact consecutive duplicate ${role} turn.`);
          if (hasMedia && !lastTurn.clone.querySelector('img, canvas, svg, table, .ai-exporter-file-attachment')) {
            lastTurn.clone = clone;
            lastTurn.html = clone.innerHTML;
            lastTurn.contentEl = contentEl;
          }
          continue;
        }

        // Case 2: Substring / superset duplicate for substantive turns (>= 25 characters)
        const minLen = Math.min(lastText.length, currText.length);
        if (minLen >= 25) {
          if (lastText.includes(currText)) {
            // Current turn is an incomplete subset/echo of last turn; skip current turn
            Logger.stage2(`[Turn ${i + 1}] Skipping subset consecutive ${role} turn (${currText.length} chars inside ${lastText.length} chars).`);
            continue;
          } else if (currText.includes(lastText)) {
            // Current turn is a superset (e.g. contains attachment pill + prompt text); upgrade previous turn
            Logger.stage2(`[Turn ${i + 1}] Upgrading previous ${role} turn with superset (${currText.length} chars vs ${lastText.length} chars).`);
            if (role === 'user') stats.userCount--; else stats.asstCount--;
            stats.tables -= lastTurn.components.tablesCount;
            stats.codeBlocks -= lastTurn.components.codeBlocksCount;
            stats.charts -= lastTurn.components.chartsCount;
            stats.media -= lastTurn.components.imagesCount;
            stats.surveys -= lastTurn.components.surveysCount;
            inventory.pop();
            // Proceed to add current turn below
          }
        }
      }

      // Inventory sub-components in this turn
      const tables = Array.from(clone.querySelectorAll('table'));
      const codeBlocks = Array.from(clone.querySelectorAll('pre, code.hljs, [class*="code-block" i]'));
      const charts = Array.from(clone.querySelectorAll('svg, canvas'));
      const images = Array.from(clone.querySelectorAll('img, .ai-exporter-media-card'));
      const surveys = Array.from(clone.querySelectorAll('[data-testid*="feedback" i], [class*="feedback" i], .rovo-suggested-prompt'));

      stats.tables += tables.length;
      stats.codeBlocks += codeBlocks.length;
      stats.charts += charts.length;
      stats.media += images.length;
      stats.surveys += surveys.length;

      if (role === 'user') stats.userCount++;
      else stats.asstCount++;

      Logger.stage2(`[Turn ${inventory.length + 1}/${candidateTurns.length}] role: ${role}, tag: <${contentEl.tagName}>, length: ${text.length} chars, tables: ${tables.length}, codeBlocks: ${codeBlocks.length}`);

      inventory.push({
        index: inventory.length,
        role,
        html: clone.innerHTML,
        contentEl,
        clone,
        components: {
          tablesCount: tables.length,
          codeBlocksCount: codeBlocks.length,
          chartsCount: charts.length,
          imagesCount: images.length,
          surveysCount: surveys.length,
          textLength: text.length
        }
      });
    }

    return { inventory, stats };
  }

  recoverInterstitialAssistantTurns(candidateTurns) {
    Logger.recovery(`Running interstitial recovery on ${candidateTurns.length} candidate turns...`);

    // Pass A: Re-classify turns that have assistant hallmarks
    let reclassified = 0;
    for (const turn of candidateTurns) {
      if (turn.role === 'user' && turn.contentEl) {
        const el = turn.contentEl;
        const isExplicitUser = (el.tagName && el.tagName.toLowerCase() === 'user-query') ||
                               (el.getAttribute('data-message-author-role') || '').toLowerCase() === 'user';
        if (!isExplicitUser) {
          const hasAssistantHallmarks = el.querySelector && el.querySelector('pre, table, .markdown, .prose, .ak-renderer-document');
          if (hasAssistantHallmarks) {
            turn.role = 'assistant';
            reclassified++;
          }
        }
      }
    }

    if (reclassified > 0) {
      Logger.recovery(`Reclassified ${reclassified} mislabeled assistant turns.`);
      if (candidateTurns.some(t => t.role === 'assistant')) {
        return candidateTurns;
      }
    }

    // Pass B: Interstitial DOM discovery between user questions
    const userTurns = candidateTurns.filter(t => t.role === 'user');
    Logger.recovery(`Scanning DOM between ${userTurns.length} user questions...`);

    const paired = [];
    for (let i = 0; i < userTurns.length; i++) {
      const u = userTurns[i].contentEl;
      paired.push({ role: 'user', contentEl: u });

      const nextU = (i + 1 < userTurns.length) ? userTurns[i + 1].contentEl : null;
      let asstEl = null;

      // 1. Container / Island search (strictly for per-turn isolated cards, never the global scroller)
      const containerCandidate = u.closest('share-turn-viewer, .conversation-container, div[class*="conversation-container" i], [data-testid*="turn" i], [class*="turn" i], [class*="row" i], article');
      const isGlobalScroller = (c) => !c || c === document.body || c === document.documentElement || (
        c.matches && (
          c.matches('infinite-scroller, [class*="chat-history" i], [class*="conversations-list" i], [class*="chat-window" i], main, [role="main"]') &&
          !c.matches('.conversation-container, div[class*="conversation-container" i], share-turn-viewer')
        )
      );
      const hasOtherUserTurns = (c) => c && (
        (nextU && c.contains(nextU)) ||
        c.querySelectorAll('user-query, [data-message-author-role="user"]').length > 1
      );

      if (containerCandidate && !isGlobalScroller(containerCandidate) && !hasOtherUserTurns(containerCandidate)) {
        const candidates = Array.from(containerCandidate.querySelectorAll(
          'response-container, [class*="presented-response" i], [class*="response-container" i], [class*="single-draft-response" i], ' +
          'message-content, model-response, structured-content-container, .markdown, [class*="markdown" i], ' +
          '[class*="response" i], [class*="answer" i], .ak-renderer-document, [data-message-author-role="assistant"]'
        )).filter(el => !el.contains(u) && !u.contains(el));

        if (candidates.length > 0) {
          asstEl = candidates[candidates.length - 1];
        }
      }

      // 2. Direct sibling walk between u and nextU
      if (!asstEl) {
        let sib = u.nextElementSibling;
        while (sib && sib !== nextU) {
          if (!sib.contains(u) && (!nextU || !sib.contains(nextU)) && sib.textContent.trim().length > 0) {
            const asstSub = (sib.matches && sib.matches('response-container, [class*="response" i], [class*="presented-response" i], model-response, message-content, structured-content-container, .markdown')) ? sib :
              sib.querySelector('response-container, [class*="presented-response" i], [class*="response-container" i], [class*="single-draft-response" i], message-content, model-response, structured-content-container, .markdown, [class*="model-response-text" i]');
            asstEl = asstSub || sib;
            break;
          }
          sib = sib.nextElementSibling;
        }
      }

      // 3. Parent tree sibling walk between u and nextU
      if (!asstEl) {
        let p = u.parentElement;
        while (p && p !== document.body && !isGlobalScroller(p)) {
          let sib = p.nextElementSibling;
          while (sib && (!nextU || !sib.contains(nextU))) {
            if (!sib.contains(u) && sib.textContent.trim().length > 0) {
              const asstSub = (sib.matches && sib.matches('response-container, [class*="response" i], [class*="presented-response" i], model-response, message-content, structured-content-container, .markdown')) ? sib :
                sib.querySelector('response-container, [class*="presented-response" i], [class*="response-container" i], [class*="single-draft-response" i], message-content, model-response, structured-content-container, .markdown, [class*="model-response-text" i]');
              asstEl = asstSub || sib;
              break;
            }
            sib = sib.nextElementSibling;
          }
          if (asstEl) break;
          p = p.parentElement;
        }
      }

      if (asstEl) {
        const cleanSub = asstEl.querySelector('message-content, [class*="presented-response" i], .markdown, structured-content-container');
        const finalAsst = cleanSub || asstEl;
        paired.push({ role: 'assistant', contentEl: finalAsst });
        Logger.recovery(`[Turn ${i + 1}/${userTurns.length}] Paired: Q=<${u.tagName}> -> A=<${finalAsst.tagName}> (${finalAsst.textContent.trim().length} chars)`);
      } else {
        Logger.recovery(`[Turn ${i + 1}/${userTurns.length}] No interstitial response element found in DOM after question.`);
      }
    }

    return paired;
  }

  verifyGate2(inventory, stats) {
    if (inventory.length === 0) {
      return { passed: false, reason: 'No conversation turns were found in the DOM.' };
    }
    // Prevent prompt-only incomplete export
    if (stats.userCount > 1 && stats.asstCount === 0) {
      return {
        passed: false,
        reason: `Found ${stats.userCount} user questions but 0 assistant responses. Model responses were stripped or missing from the DOM.`
      };
    }
    return { passed: true, reason: 'Structural integrity verified.' };
  }
}

// Scrape chat messages by platform through the unified gated pipeline
async function getChatMessages(platform) {
  Logger.stage1(`Starting getChatMessages for platform: ${platform}`);
  const inventoryEngine = new ChatInventoryEngine();

  // FAST PATH (Immediate extraction):
  // If the conversation turns are already present and visible in the DOM (e.g. ChatGPT, Claude, active tab),
  // capture them directly without triggering scroll sweeps that can unmount or desync virtualized lists.
  try {
    const immediateRes = await inventoryEngine.inspect(platform);
    if (immediateRes && immediateRes.turns && immediateRes.turns.length > 0) {
      Logger.stage1(`Immediate DOM extraction succeeded: captured ${immediateRes.turns.length} turns without scroll sweep.`);
      return immediateRes.turns.map(t => ({
        role: t.role,
        html: t.html,
        components: t.components
      }));
    }
  } catch (e) {
    Logger.stage1(`Immediate inspection did not find complete turns (${e.message}). Proceeding to dynamic mount sweep...`);
  }

  // SWEEP PATH (Lazy/virtualized chats like Gemini):
  const mountEngine = new ChatMountEngine({ skipRestore: false });
  const mountResult = await mountEngine.sweep();

  try {
    const inventoryResult = await inventoryEngine.inspect(platform);
    Logger.stage3(`Inventory verified. Preparing ${inventoryResult.turns.length} turns for Markdown converter.`);
    return inventoryResult.turns.map(t => ({
      role: t.role,
      html: t.html,
      components: t.components
    }));
  } finally {
    if (mountResult && mountResult.savedScroll) {
      restoreScrollPositions(mountResult.savedScroll);
    }
    if (mountResult && mountResult.hiddenOverlays) {
      restoreOverlays(mountResult.hiddenOverlays);
    }
  }
}
