document.addEventListener('DOMContentLoaded', async () => {
  // 1. Fetch conversation data from chrome.storage.local
  const data = await chrome.storage.local.get('chatData');
  if (!data || !data.chatData) {
    document.getElementById('chat-title').textContent = 'Error: No chat data found.';
    return;
  }

  const chat = data.chatData;
  document.title = chat.title;
  document.getElementById('chat-title').textContent = chat.title;
  document.getElementById('chat-platform').textContent = chat.platform;
  document.getElementById('export-date').textContent = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const threadContainer = document.getElementById('chat-thread');

  // 2. Render each message in a clean document structure
  chat.messages.forEach((msg, index) => {
    if (msg.role === 'user') {
      const promptCard = document.createElement('div');
      promptCard.className = 'user-prompt-card';

      const temp = document.createElement('div');
      temp.innerHTML = msg.html;
      const isMultiBlock = temp.querySelector('p, ol, ul, pre, table, blockquote') || temp.textContent.length > 120 || temp.innerHTML.includes('<br>');

      if (!isMultiBlock) {
        promptCard.classList.add('single-line');
        const heading = document.createElement('h2');
        heading.className = 'user-prompt-heading';
        heading.innerHTML = msg.html;
        promptCard.appendChild(heading);
      } else {
        promptCard.classList.add('multi-block');
        const contentDiv = document.createElement('div');
        contentDiv.className = 'user-prompt-content user-prompt-heading';
        contentDiv.innerHTML = msg.html;
        promptCard.appendChild(contentDiv);
      }

      threadContainer.appendChild(promptCard);
    } else {
      const responseDiv = document.createElement('div');
      responseDiv.className = 'assistant-response-body';
      responseDiv.innerHTML = msg.html;
      threadContainer.appendChild(responseDiv);
    }
  });

  // 3. Normalize tables: ensure headers are in thead and data rows are in tbody for clean zebra striping
  const tables = threadContainer.querySelectorAll('table');
  tables.forEach(table => {
    if (!table.querySelector('thead')) {
      const firstRow = table.querySelector('tr');
      if (firstRow && firstRow.querySelector('th')) {
        const thead = document.createElement('thead');
        thead.appendChild(firstRow);
        table.insertBefore(thead, table.firstChild);
      }
    }
    const dataRows = Array.from(table.querySelectorAll('tr')).filter(r => !r.closest('thead'));
    if (dataRows.length > 0 && !table.querySelector('tbody')) {
      const tbody = document.createElement('tbody');
      dataRows.forEach(r => tbody.appendChild(r));
      table.appendChild(tbody);
    }
  });

  // 4. Normalize Atlassian Smart Links, Jira issue lozenges, and list spacing for Rovo
  if (chat.platform === 'Rovo' || (chat.title && chat.title.includes('Rovo'))) {
    normalizeSmartLinksAndLists(threadContainer);
  }

  // 5. Clear stored chat data to avoid bloating storage
  await chrome.storage.local.remove('chatData');

  // 5. Trigger print after a short delay to ensure rendering completes
  setTimeout(() => {
    window.print();
  }, 500);
});

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
