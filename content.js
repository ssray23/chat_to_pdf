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
    '[class*="Composer" i]',
    '[class*="composer" i]',
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
      // Remove all action buttons (+Add, Submit, Auto, Copy, Thumbs, Feedback, etc.)
      el.remove();
    }
  });
  
  // 3. Remove platform-specific layout controls
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
    '[data-testid*="thinking" i]',
    '[data-testid*="thought" i]',
    '[class*="thinking" i]',
    '[class*="thought" i]',
    '[class*="Thinking" i]',
    '[class*="Thought" i]',
    'summary', // Removes tool use headers like 'V visualize show_widget' since they use details/summary
    '[data-testid*="tool"]',
    '[class*="tool-use"]',
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

  // Remove Claude "Thought for Xs" / reasoning collapsible blocks
  clone.querySelectorAll('button, div, summary, p, span').forEach(el => {
    const text = el.textContent.trim();
    if (/^thought for \d+s/i.test(text) || /^thought for a few seconds/i.test(text) || /^thinking(\.\.\.)?$/i.test(text)) {
      const details = el.closest('details') || el;
      details.remove();
    }
  });

  // Remove copy buttons from inside pre blocks
  clone.querySelectorAll('pre').forEach(pre => {
    pre.querySelectorAll('button, .copy-code-button, [class*="copy"]').forEach(el => el.remove());
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

  // Remove empty paragraphs, divs with only whitespace/nbsp/br, or standalone br tags
  clone.querySelectorAll('p, div, span').forEach(el => {
    const text = el.textContent.replace(/\u00a0/g, ' ').trim();
    const hasMedia = el.querySelector('img, svg, canvas, iframe, video, .ai-exporter-media-card, .atlassian-smart-chip, .atlassian-sources-pill, .rovo-suggested-prompt');
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
  } else if (platform === 'Rovo' || url.includes('atlassian.net') || url.includes('atlassian.com')) {
    // Rovo / Atlassian AI Assistant Scraper
    const isComposerOrToolbar = (el) => {
      if (!el) return false;
      if (el.closest && el.closest('form, footer, [data-testid*="composer" i], [data-testid*="prompt-box" i], [data-testid*="prompt-input" i], [class*="Composer" i], [class*="composer" i], [class*="PromptBar" i], [class*="prompt-bar" i], [class*="Toolbar" i], [class*="toolbar" i], [class*="prompt-input" i]')) {
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

      let role = null;
      const className = turn.className && typeof turn.className === 'string' ? turn.className.toLowerCase() : '';
      const testId = (turn.getAttribute('data-testid') || '').toLowerCase();
      
      let styleBg = '';
      try {
        styleBg = window.getComputedStyle(turn).backgroundColor || '';
      } catch (e) {}

      const isBlue = (bg) => {
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false;
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const r = parseInt(match[1], 10);
          const g = parseInt(match[2], 10);
          const b = parseInt(match[3], 10);
          return b > 160 && b > r + 30 && b > g + 20;
        }
        return false;
      };

      const isWhiteText = (col) => {
        if (!col) return false;
        const match = col.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const r = parseInt(match[1], 10);
          const g = parseInt(match[2], 10);
          const b = parseInt(match[3], 10);
          return r > 230 && g > 230 && b > 230;
        }
        return false;
      };

      let elBg = '';
      let elColor = '';
      try {
        const cs = window.getComputedStyle(turn);
        elBg = cs.backgroundColor || '';
        elColor = cs.color || '';
      } catch (e) {}

      let hasBlueContainer = isBlue(styleBg) || isBlue(elBg);
      if (!hasBlueContainer) {
        const allDescendants = Array.from(turn.querySelectorAll('*'));
        hasBlueContainer = allDescendants.some(desc => {
          try {
            const cs = window.getComputedStyle(desc);
            return isBlue(cs.backgroundColor);
          } catch(e) { return false; }
        });
      }

      const hasWhiteTextContent = isWhiteText(elColor) && turn.textContent.trim().length > 0;

      if (
        className.includes('user') || 
        testId.includes('user') || 
        hasBlueContainer ||
        hasWhiteTextContent ||
        turn.querySelector('[style*="rgb(12, 102, 228)"], [style*="rgb(0, 82, 204)"], [style*="rgb(0, 101, 255)"], [class*="user" i]')
      ) {
        role = 'user';
      } else if (
        className.includes('agent') || 
        className.includes('assistant') || 
        className.includes('rovo') || 
        className.includes('bot') || 
        className.includes('response') || 
        testId.includes('agent') || 
        testId.includes('assistant') || 
        testId.includes('rovo') || 
        testId.includes('response') || 
        turn.querySelector('.ak-renderer-document, [data-node-type="doc"]')
      ) {
        role = 'assistant';
      }

      if (!role) {
        if (className.includes('sent') || className.includes('query')) {
          role = 'user';
        } else {
          role = 'assistant';
        }
      }

      const clone = deepCloneWithShadowsAndSvgs(turn);

      // Check if subsequent element in turns list is an associated attachment card
      if (role === 'user' && i + 1 < turns.length) {
        const nextEl = turns[i + 1];
        const isNextMediaCard = nextEl.matches && nextEl.matches(
          '[data-testid*="media" i], [data-testid*="file" i], [data-testid*="attachment" i], [class*="media-card" i], [class*="file-card" i], [class*="attachment" i]'
        );
        if (isNextMediaCard) {
          const cardClone = deepCloneWithShadowsAndSvgs(nextEl);
          clone.appendChild(cardClone);
          i++; // Skip the media card turn since it's merged into this user prompt
        }
      }

      cleanNoise(clone);
      await processImages(clone);

      const textContent = clone.textContent.trim();
      const hasMedia = clone.querySelector('img, canvas');
      if (textContent || hasMedia) {
        messages.push({ role, html: clone.innerHTML });
      }
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
    const chatEls = getUniqueElements(rawElements).filter(el => {
      if (el.closest('form, footer, [data-testid*="composer" i], [class*="composer" i], [class*="toolbar" i]')) return false;
      if (el.querySelector('textarea, [contenteditable="true"]')) return false;
      return true;
    });

    for (const el of chatEls) {
      let role = 'assistant';
      const className = el.className && typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (className.includes('user') || className.includes('sent') || className.includes('query')) {
        role = 'user';
      }

      const clone = deepCloneWithShadowsAndSvgs(el);
      cleanNoise(clone);
      await processImages(clone);
      if (clone.textContent.trim() || clone.querySelector('img, canvas')) {
        messages.push({ role, html: clone.innerHTML });
      }
    }
  }

  return messages;
}
