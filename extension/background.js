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
  
  // Handle audio capture requests
  if (message.type === 'start_audio_capture') {
    console.log('[Background] Starting audio capture for tab:', tabId);
    startTabAudioCapture(tabId, message.meetingId, sendResponse);
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'stop_audio_capture') {
    console.log('[Background] Stopping audio capture for tab:', tabId);
    stopTabAudioCapture(tabId);
    sendResponse({ success: true });
    return true;
  }
  
  // Original message handling
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
  }
  
  return true;
});

// Handle tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    console.log('[Background] Tab closed:', tabId);
    activeTabs.delete(tabId);
  }
  stopTabAudioCapture(tabId);
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

// ============ Tab Audio Capture ============
let activeCaptures = new Map(); // tabId -> {mediaRecorder, stream, meetingId}

function startTabAudioCapture(tabId, meetingId, sendResponse) {
  if (activeCaptures.has(tabId)) {
    console.log('[Background] Already capturing for tab:', tabId);
    sendResponse({ success: true, message: 'Already capturing' });
    return;
  }
  
  chrome.tabCapture.capture({
    audio: true,
    video: false,
  }, (stream) => {
    if (chrome.runtime.lastError) {
      console.error('[Background] tabCapture error:', chrome.runtime.lastError.message);
      sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }
    
    if (!stream) {
      console.error('[Background] No stream from tabCapture');
      sendResponse({ success: false, error: 'No stream returned' });
      return;
    }
    
    console.log('[Background] Tab capture stream obtained for tab:', tabId);
    
    try {
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 64000,
      });
      
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          console.log('[Background] Audio chunk:', event.data.size, 'bytes');
          
          // Convert blob to base64
          const arrayBuffer = await event.data.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          
          // Send to content script
          try {
            chrome.tabs.sendMessage(tabId, {
              type: 'audio_chunk_data',
              audioData: base64,
              size: event.data.size,
              timestamp: Date.now(),
              duration: 10, // 10 second chunks
              meetingId: meetingId,
            });
          } catch (err) {
            console.error('[Background] Failed to send chunk to content:', err);
          }
        }
      };
      
      mediaRecorder.onerror = (error) => {
        console.error('[Background] MediaRecorder error:', error);
      };
      
      mediaRecorder.onstop = () => {
        console.log('[Background] MediaRecorder stopped for tab:', tabId);
        stream.getTracks().forEach(track => track.stop());
        activeCaptures.delete(tabId);
      };
      
      mediaRecorder.start(10000); // 10 second chunks
      activeCaptures.set(tabId, { mediaRecorder, stream, meetingId });
      
      console.log('[Background] Audio recording started for tab:', tabId);
      sendResponse({ success: true });
      
    } catch (err) {
      console.error('[Background] MediaRecorder setup failed:', err);
      stream.getTracks().forEach(track => track.stop());
      sendResponse({ success: false, error: err.message });
    }
  });
}

function stopTabAudioCapture(tabId) {
  const capture = activeCaptures.get(tabId);
  if (capture) {
    console.log('[Background] Stopping capture for tab:', tabId);
    if (capture.mediaRecorder && capture.mediaRecorder.state !== 'inactive') {
      capture.mediaRecorder.stop();
    }
    if (capture.stream) {
      capture.stream.getTracks().forEach(track => track.stop());
    }
    activeCaptures.delete(tabId);
  }
}

console.log('[Background] Service worker started with audio capture support');
