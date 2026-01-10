/**
 * Notu.AI Meet Bot - Background Service Worker
 * 
 * Handles extension lifecycle and message relay.
 */

// Track active tabs
const activeTabs = new Map();

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  
  console.log('[Background] Message from tab', tabId, ':', message.type);
  
  switch (message.type) {
    case 'loaded':
      activeTabs.set(tabId, {
        url: message.data.url,
        status: 'loaded',
        startTime: Date.now(),
      });
      break;
      
    case 'status':
      if (activeTabs.has(tabId)) {
        activeTabs.get(tabId).status = message.data.status;
      }
      break;
      
    case 'caption':
      // Forward captions to any listening connections
      // Could be stored or sent to external service
      break;
  }
  
  return true;
});

// Handle tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    console.log('[Background] Tab closed:', tabId);
    activeTabs.delete(tabId);
  }
});

// Start bot on specific tab
async function startBotOnTab(tabId) {
  try {
    await chrome.storage.local.set({ autoStart: true });
    console.log('[Background] Bot start triggered for tab:', tabId);
  } catch (e) {
    console.error('[Background] Failed to start bot:', e);
  }
}

// Stop bot on specific tab
async function stopBotOnTab(tabId) {
  try {
    await chrome.storage.local.set({ autoStart: false });
    
    // Send stop message to content script
    chrome.tabs.sendMessage(tabId, { type: 'stop' });
    console.log('[Background] Bot stop triggered for tab:', tabId);
  } catch (e) {
    console.error('[Background] Failed to stop bot:', e);
  }
}

// Handle external connections (from Playwright)
chrome.runtime.onConnectExternal?.addListener((port) => {
  console.log('[Background] External connection from:', port.name);
  
  port.onMessage.addListener((message) => {
    console.log('[Background] External message:', message);
    
    switch (message.type) {
      case 'start':
        if (message.tabId) {
          startBotOnTab(message.tabId);
        }
        break;
        
      case 'stop':
        if (message.tabId) {
          stopBotOnTab(message.tabId);
        }
        break;
        
      case 'getStatus':
        port.postMessage({
          type: 'status',
          tabs: Array.from(activeTabs.entries()),
        });
        break;
    }
  });
});

console.log('[Background] Service worker started');
