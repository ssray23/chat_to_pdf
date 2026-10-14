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

  // 4. Clear stored chat data to avoid bloating storage
  await chrome.storage.local.remove('chatData');

  // 5. Trigger print after a short delay to ensure rendering completes
  setTimeout(() => {
    window.print();
  }, 500);
});
