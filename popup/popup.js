document.addEventListener('DOMContentLoaded', async () => {
  const statusCard = document.getElementById('status-card');
  const statusIconWrapper = document.getElementById('status-icon-wrapper');
  const statusTitle = document.getElementById('status-title');
  const statusDesc = document.getElementById('status-desc');
  const btnExport = document.getElementById('btn-export');

  // Helper to update status UI
  function updateStatus(type, title, desc) {
    statusCard.className = 'status-card';
    statusIconWrapper.className = 'status-icon-wrapper';
    
    if (type === 'detecting') {
      statusIconWrapper.innerHTML = '<div class="loader"></div>';
      statusTitle.textContent = title;
      statusDesc.textContent = desc;
      btnExport.disabled = true;
    } else if (type === 'detected') {
      statusCard.classList.add('detected');
      statusIconWrapper.classList.add('success');
      statusIconWrapper.innerHTML = `
        <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z" fill="currentColor"/>
        </svg>
      `;
      statusTitle.textContent = title;
      statusDesc.textContent = desc;
      btnExport.disabled = false;
    } else if (type === 'error') {
      statusCard.classList.add('error');
      statusIconWrapper.classList.add('error');
      statusIconWrapper.innerHTML = `
        <svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="currentColor"/>
        </svg>
      `;
      statusTitle.textContent = title;
      statusDesc.textContent = desc;
      btnExport.disabled = true;
    }
  }

  // Detect active tab
  let activeTab = null;
  let platform = '';

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      updateStatus('error', 'No Active Tab', 'Could not access current active tab.');
      return;
    }
    
    activeTab = tabs[0];
    const url = activeTab.url || '';
    
    if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) {
      platform = 'ChatGPT';
    } else if (url.includes('claude.ai')) {
      platform = 'Claude';
    } else if (url.includes('gemini.google.com')) {
      platform = 'Gemini';
    } else if (url.includes('grok.com') || url.includes('x.com/i/grok')) {
      platform = 'Grok';
    }

    if (platform) {
      updateStatus('detected', `${platform} Chat Detected`, `Ready to export the conversation on this tab.`);
    } else {
      updateStatus('error', 'Not Supported', 'Please open a conversation on Claude, ChatGPT, Gemini, or Grok.');
    }
  } catch (err) {
    console.error(err);
    updateStatus('error', 'Error Occurred', err.message || 'Failed to detect active tab.');
  }

  // Handle Export button click
  btnExport.addEventListener('click', async () => {
    if (!activeTab || !platform) return;

    updateStatus('detecting', 'Scraping Chat...', 'Extracting messages, processing images and canvases. Please keep this tab open...');
    
    try {
      let response;
      try {
        // Send message to content script
        response = await chrome.tabs.sendMessage(activeTab.id, { action: 'export_chat', platform });
      } catch (err) {
        // Content script might not be injected. Try injecting content script manually and retry.
        console.warn('Content script not detected. Injecting content script...', err);
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content.js']
        });
        // Wait a short moment and try sending message again
        await new Promise(resolve => setTimeout(resolve, 300));
        response = await chrome.tabs.sendMessage(activeTab.id, { action: 'export_chat', platform });
      }

      if (response && response.success) {
        updateStatus('detected', 'Scrape Completed!', 'Opening print layout...');
        
        // Save conversation data in storage
        await chrome.storage.local.set({
          chatData: {
            platform: platform,
            title: activeTab.title || `${platform} Conversation`,
            url: activeTab.url,
            messages: response.messages
          }
        });

        // Open print.html in a new tab
        await chrome.tabs.create({ url: chrome.runtime.getURL('print.html') });
        window.close(); // Close the popup
      } else {
        updateStatus('error', 'Scrape Failed', (response && response.error) || 'Failed to extract chat content.');
      }
    } catch (err) {
      console.error(err);
      updateStatus('error', 'Export Error', err.message || 'An error occurred during export.');
    }
  });
});
