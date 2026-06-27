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
  // User prompts become headings (h1 for the very first prompt, h2 for subsequent prompts)
  // Assistant responses flow immediately below them as continuous content.
  chat.messages.forEach((msg, index) => {
    if (msg.role === 'user') {
      const heading = document.createElement('h2');
      heading.className = 'user-prompt-heading';
      heading.innerHTML = msg.html;
      threadContainer.appendChild(heading);
    } else {
      const responseDiv = document.createElement('div');
      responseDiv.className = 'assistant-response-body';
      responseDiv.innerHTML = msg.html;
      threadContainer.appendChild(responseDiv);
    }
  });

  // 3. Clear stored chat data to avoid bloating storage
  await chrome.storage.local.remove('chatData');

  // 4. Trigger print after a short delay to ensure rendering completes
  setTimeout(() => {
    window.print();
  }, 500);
});
