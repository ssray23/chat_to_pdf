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
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(cleanUrl);
      reader.readAsDataURL(blob);
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
  // 1. Remove input composer / toolbar elements
  const composerSelectors = [
    'form',
    'textarea',
    'input:not([type="checkbox"])',
    '[data-testid*="composer" i]',
    '[data-testid*="prompt-box" i]',
    '[data-testid*="prompt-input" i]',
    '[data-testid*="prompt-editor" i]',
    '[data-testid*="chat-input" i]',
    '[class*="Composer" i]:not([class*="--composer" i])',
    '[class*="composer" i]:not([class*="--composer" i])',
    '[class*="PromptBar" i]',
    '[class*="prompt-bar" i]',
    '[class*="PromptInput" i]',
    '[class*="prompt-input" i]',
    '[class*="BottomBar" i]',
    '[class*="bottom-bar" i]',
    '[class*="ActionToolbar" i]',
    '[class*="action-toolbar" i]',
    '[class*="PromptContainer" i]',
    '[aria-label*="prompt" i]',
    '[aria-label*="Add sources" i]'
  ];

  composerSelectors.forEach(sel => {
    try {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    } catch (e) {}
  });

  // 2. Remove action buttons, but PRESERVE:
  //    a) Interactive media cards / image attachments
  //    b) Suggested follow-up prompt buttons (e.g. "↳ Read the full Confluence page...")
  //    c) Sources pills (e.g. "10 Sources" / "14 Issues")
  clone.querySelectorAll('button, [role="button"]').forEach(el => {
    const isMediaCard = el.matches && el.matches('[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i], [class*="thumbnail" i], div[data-node-type="media" i]');
    const hasMediaCardChild = el.querySelector('[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i], div[data-node-type="media" i]');
    const hasImage = el.querySelector('img, picture, canvas');
    const hasBgImage = el.style && el.style.backgroundImage && el.style.backgroundImage !== 'none';

    const text = el.textContent.trim();
    const isFeedbackOrDebug = /good response|bad response|debug response|provide feedback|give feedback|was this helpful|rate response|report response|thumbs up|thumbs down/i.test(text);
    const isActionControl = isFeedbackOrDebug || /^(copy|share|retry|thumbs|good|bad|submit|add|cancel|edit|auto|\+\d+|\+add)$/i.test(text);

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
    } else {
      // If it's a large text block (like an expandable tool log, timeline, or code block), preserve it.
      // Real UI action buttons rarely have > 80 characters of text.
      if (text.length > 80 && !isActionControl) {
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
      } else {
        // Remove all short action buttons (+Add, Submit, Auto, Copy, Thumbs, Feedback, etc.)
        el.remove();
      }
    }
  });
  
  // 3. Remove platform-specific layout controls and action bars (targeted selectors only)
  const noiseSelectors = [
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
    '[aria-label*="Auto" i]'
  ];

  noiseSelectors.forEach(selector => {
    try {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    } catch (e) {}
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

    // Find links inside the list item
    const links = li.querySelectorAll('a, [data-testid*="inline-card" i], [class*="InlineCard" i], [data-smart-card]');
    links.forEach(link => {
      const linkText = link.textContent.trim();
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
      } else if (linkText.startsWith('🗎') || link.querySelector('svg') || href.includes('confluence') || href.includes('atlassian')) {
        const titleText = linkText.replace(/^[🗎\s]+/, '').trim();
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

// Check if an element or its descendants have a distinct user bubble background color (blue, gray, dark pill, etc.)
function hasUserBubbleStyle(el) {
  if (!el) return false;
  try {
    const cs = window.getComputedStyle(el);
    const bg = cs.backgroundColor || '';
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        const r = parseInt(match[1], 10);
        const g = parseInt(match[2], 10);
        const b = parseInt(match[3], 10);
        // Blue bubble
        if (b > 160 && b > r + 25 && b > g + 20) return true;
        // Dark gray/charcoal bubble in light mode or distinct pill in dark mode
        if (r === g && g === b && (r < 60 || (r > 220 && r < 250))) return true;
      }
    }
    const radius = parseFloat(cs.borderRadius) || 0;
    if (radius >= 12 && cs.display !== 'inline') return true;
  } catch (e) {}
  return false;
}

// Multi-Signal Role Classifier: scores an element to determine if it is a user turn or assistant turn
function classifyTurnRole(el, index = 0, totalTurns = 1) {
  if (!el) return 'assistant';
  
  let score = 0; // Positive => User, Negative => Assistant
  const tagName = el.tagName ? el.tagName.toLowerCase() : '';
  const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
  const testId = (el.getAttribute('data-testid') || '').toLowerCase();
  const authorRole = (el.getAttribute('data-message-author-role') || el.getAttribute('data-role') || el.getAttribute('role') || '').toLowerCase();
  
  // 1. Explicit semantic attributes (Highest weight: +/- 15)
  if (authorRole === 'user' || authorRole === 'human') return 'user';
  if (authorRole === 'assistant' || authorRole === 'agent' || authorRole === 'model' || authorRole === 'bot') return 'assistant';
  if (tagName === 'user-query') return 'user';
  if (tagName === 'model-response') return 'assistant';
  if (el.querySelector('[data-message-author-role="user"]')) return 'user';
  if (el.querySelector('[data-message-author-role="assistant"]')) return 'assistant';

  // 2. Class & TestID semantic markers (+/- 6)
  if (/\b(user|human|query|prompt|sent|user-message)\b/.test(className) || /\b(user|human|query|prompt)\b/.test(testId)) {
    score += 6;
  }
  if (/\b(assistant|agent|model|response|bot|answer|claude-message|rovo|prose)\b/.test(className) || /\b(assistant|agent|model|response|bot|answer)\b/.test(testId)) {
    score -= 6;
  }

  // 3. Rich Markdown / Assistant Content Fingerprint
  const hasCodeBlock = el.querySelector('pre, code.hljs, [class*="code-block" i]') !== null;
  const hasTable = el.querySelector('table') !== null;
  const hasMath = el.querySelector('.katex, .MathJax, [data-math]') !== null;
  const hasHeadings = el.querySelector('h1, h2, h3, h4, h5, h6') !== null;
  const hasSources = el.querySelector('[data-testid*="source" i], [class*="source" i], [class*="citation" i]') !== null;
  const hasMarkdown = el.querySelector('.markdown, .prose, [class*="markdown" i], [class*="prose" i]') !== null;
  
  if (hasMarkdown) score -= 4;
  if (hasCodeBlock) score -= 4;
  if (hasTable) score -= 4;
  if (hasMath) score -= 3;
  if (hasHeadings) score -= 2;
  if (hasSources) score -= 3;

  // 4. Layout Geometry and Alignment (+/- 4)
  try {
    const cs = window.getComputedStyle(el);
    if (cs.marginLeft === 'auto' || cs.justifyContent === 'flex-end' || cs.alignSelf === 'flex-end' || cs.textAlign === 'right') {
      score += 4;
    }
    if (className.includes('self-end') || className.includes('items-end') || className.includes('justify-end')) {
      score += 4;
    }
  } catch (e) {}

  // 5. Visual Bubble Styling & Color Contrast
  if (hasUserBubbleStyle(el) || el.querySelector('[style*="rgb(12, 102, 228)"], [style*="rgb(0, 82, 204)"], [style*="rgb(0, 101, 255)"]')) {
    score += 4;
  }

  // 6. Tie-breaker via Alternating Rhythm Parity
  if (score === 0) {
    if (index % 2 === 0) {
      score += 2;
    } else {
      score -= 2;
    }
  }

  return score >= 0 ? 'user' : 'assistant';
}

// Extract ChatGPT /share/ public page content (DOM and SSR JSON payload fallback)
function extractChatGPTShareMessages() {
  const extracted = [];
  
  // 1. Try DOM elements with [data-message-id] or articles
  const messageNodes = document.querySelectorAll('[data-message-id], [data-testid*="conversation-turn"], [data-testid*="message"], article');
  if (messageNodes.length > 0) {
    const unique = getUniqueElements(messageNodes);
    for (let i = 0; i < unique.length; i++) {
      const node = unique[i];
      const role = classifyTurnRole(node, i, unique.length);
      const contentEl = node.querySelector('[data-message-author-role="assistant"]') || 
                        node.querySelector('[data-message-author-role="user"]') || 
                        node.querySelector('[data-message-author-role]') || 
                        node.querySelector('.whitespace-pre-wrap') || 
                        node;
      extracted.push({ role, contentEl });
    }
    if (extracted.length > 0) return extracted;
  }

  // 2. Try querying .markdown containers and matching with prompt elements
  const allBlocks = getUniqueElements(document.querySelectorAll('h1, h2, h3, .whitespace-pre-wrap, .markdown, div[class*="markdown" i]'));
  if (allBlocks.length > 0) {
    for (let i = 0; i < allBlocks.length; i++) {
      const el = allBlocks[i];
      const role = classifyTurnRole(el, i, allBlocks.length);
      extracted.push({ role, contentEl: el });
    }
    if (extracted.length > 0) return extracted;
  }

  // 3. Fallback: Parse embedded JSON state (e.g. client-bootstrap, __NEXT_DATA__)
  try {
    const scripts = document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__, script#client-bootstrap');
    for (const script of scripts) {
      const raw = script.textContent.trim();
      if (!raw || (!raw.includes('mapping') && !raw.includes('linear_conversation') && !raw.includes('message') && !raw.includes('title'))) continue;
      
      const data = JSON.parse(raw);
      const foundMessages = [];
      const traverse = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.message && obj.message.content && obj.message.author) {
          const role = obj.message.author.role === 'user' ? 'user' : 'assistant';
          const parts = obj.message.content.parts || [];
          const text = parts.filter(p => typeof p === 'string').join('\n');
          if (text.trim()) {
            foundMessages.push({ role, text });
          }
        }
        for (const key of Object.keys(obj)) {
          traverse(obj[key]);
        }
      };
      traverse(data);

      if (foundMessages.length > 0) {
        for (const m of foundMessages) {
          const div = document.createElement('div');
          if (m.role === 'assistant') {
            div.className = 'markdown';
          }
          div.textContent = m.text;
          extracted.push({ role: m.role, contentEl: div });
        }
        return extracted;
      }
    }
  } catch (e) {
    console.warn('Failed to parse share page JSON payload:', e);
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
    'div[class*="bubble" i]',
    'div[class*="row" i]'
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

// Scrape chat messages by platform with self-adapting DOM change detection
async function getChatMessages(platform) {
  const messages = [];
  const url = window.location.href;

  await captureCrossoriginIframes();

  let extractedTurns = [];

  if (platform === 'ChatGPT' || url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
    const isSharePage = url.includes('/share/');
    
    // Standard in-session ChatGPT extraction
    const articles = document.querySelectorAll('article');
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const isUser = article.querySelector('[data-message-author-role="user"]') !== null;
      const isAssistant = article.querySelector('[data-message-author-role="assistant"]') !== null;
      
      let role = null;
      let contentEl = null;

      if (isUser) {
        role = 'user';
        contentEl = article.querySelector('[data-message-author-role="user"]') || article.querySelector('.whitespace-pre-wrap') || article;
      } else if (isAssistant) {
        role = 'assistant';
        contentEl = article.querySelector('[data-message-author-role="assistant"]') || article.querySelector('.markdown') || article;
      } else {
        role = classifyTurnRole(article, i, articles.length);
        contentEl = article.querySelector('[data-message-author-role="assistant"]') || article.querySelector('[data-message-author-role="user"]') || article.querySelector('.markdown') || article;
      }

      if (role && contentEl) {
        extractedTurns.push({ role, contentEl });
      }
    }

    // If standard articles yielded nothing (e.g. /share/... page or React UI update), run share-page / adaptive extractor
    if (extractedTurns.length === 0 && (isSharePage || articles.length === 0)) {
      extractedTurns = extractChatGPTShareMessages();
    }
  } else if (platform === 'Claude' || url.includes('claude.ai')) {
    const rawElements = document.querySelectorAll(
      '.font-user-message, .font-claude-message, [data-testid="user-message"], [data-testid="assistant-message"], ' +
      'div[class*="font-user"], div[class*="font-claude"], div[class*="user-message"], div[class*="claude-message"], ' +
      'div[class*="assistant-message"], .user-message, .claude-message'
    );
    const turns = getUniqueElements(rawElements);

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const role = classifyTurnRole(turn, i, turns.length);
      extractedTurns.push({ role, contentEl: turn });
    }
  } else if (platform === 'Gemini' || url.includes('gemini.google.com')) {
    const rawElements = document.querySelectorAll(
      'user-query, model-response, .query-text-container, .model-response-container, ' +
      'div[class*="query"], div[class*="response"], div[class*="message-content"]'
    );
    const elements = getUniqueElements(rawElements);

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
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

      extractedTurns.push({ role, contentEl });
    }
  } else if (platform === 'Perplexity' || url.includes('perplexity.ai')) {
    extractedTurns = extractPerplexityMessages();
  } else if (platform === 'Rovo' || url.includes('atlassian.net') || url.includes('atlassian.com')) {
    const isComposerOrToolbar = (el) => {
      if (!el) return false;
      if (el.closest && el.closest('form, footer, [data-testid*="composer" i], [data-testid*="prompt-box" i], [data-testid*="prompt-input" i], [class*="Composer" i]:not([class*="--composer" i]), [class*="composer" i]:not([class*="--composer" i]), [class*="PromptBar" i], [class*="prompt-bar" i], [class*="Toolbar" i], [class*="toolbar" i], [class*="prompt-input" i]')) {
        return true;
      }
      if (el.querySelector && el.querySelector('textarea, input[type="text"], [contenteditable="true"]')) {
        return true;
      }
      return false;
    };

    let turns = Array.from(document.querySelectorAll(
      '[data-testid*="user-message" i], [data-testid*="assistant-message" i], [data-testid*="rovo-message" i], [data-testid*="agent-message" i], ' +
      'div[class*="UserMessage" i], div[class*="AgentMessage" i], div[class*="AssistantMessage" i], div[class*="RovoMessage" i], ' +
      'div[class*="user-message" i], div[class*="agent-message" i], div[class*="assistant-message" i]'
    )).filter(el => !isComposerOrToolbar(el));

    if (turns.length === 0) {
      turns = Array.from(document.querySelectorAll(
        '[data-testid="chat-message"]:not([data-testid*="list"]):not([data-testid*="scroll"]), [data-testid*="message-item" i], .ak-renderer-document, ' +
        'div[class*="message" i]:not([class*="list"]):not([class*="container"]):not([class*="composer"]):not([class*="toolbar"]), div[class*="bubble" i]'
      )).filter(el => !isComposerOrToolbar(el));
    }
    turns = getUniqueElements(turns).filter(el => !isComposerOrToolbar(el));

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (isComposerOrToolbar(turn)) continue;

      const role = classifyTurnRole(turn, i, turns.length);
      extractedTurns.push({ role, contentEl: turn });
    }
  } else if (platform === 'Grok' || url.includes('grok.com') || url.includes('x.com')) {
    const rawElements = document.querySelectorAll(
      'div[class*="message" i], div[class*="bubble" i], div[class*="chat-turn" i], div[data-testid*="message" i]'
    );
    const messageContainers = getUniqueElements(rawElements);

    for (let i = 0; i < messageContainers.length; i++) {
      const el = messageContainers[i];
      const role = classifyTurnRole(el, i, messageContainers.length);
      extractedTurns.push({ role, contentEl: el });
    }
  }

  // Universal Adaptive Fallback in case platform parsing failed completely
  if (extractedTurns.length === 0) {
    console.log('No messages found with primary platform selectors. Using adaptive turn discovery engine...');
    extractedTurns = extractAdaptiveTurns(document.body);
  }

  // Process extracted turns: clone, clean UI noise, serialize images & canvases
  for (let i = 0; i < extractedTurns.length; i++) {
    const { role, contentEl } = extractedTurns[i];
    if (!contentEl) continue;

    const clone = deepCloneWithShadowsAndSvgs(contentEl);

    // Merge associated subsequent media attachment cards on Atlassian Rovo
    if (role === 'user' && i + 1 < extractedTurns.length && (platform === 'Rovo' || url.includes('atlassian'))) {
      const nextTurn = extractedTurns[i + 1];
      const nextEl = nextTurn ? nextTurn.contentEl : null;
      if (nextEl && nextEl.matches && nextEl.matches('[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i]')) {
        const cardClone = deepCloneWithShadowsAndSvgs(nextEl);
        clone.appendChild(cardClone);
        i++;
      }
    }

    cleanNoise(clone);
    await processImages(clone);

    const textContent = clone.textContent.trim();
    const hasMedia = clone.querySelector('img, canvas, svg, iframe, table');
    if (textContent || hasMedia) {
      messages.push({ role, html: clone.innerHTML });
    }
  }

  return messages;
}
