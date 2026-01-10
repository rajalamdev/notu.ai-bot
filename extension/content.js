/**
 * Notu.AI Meet Bot - Content Script (Fixed Selectors)
 * 
 * This script runs in the context of Google Meet pages.
 * It handles all DOM interaction to avoid bot detection.
 */

(function() {
  'use strict';

  // ============ Configuration ============
  const CONFIG = {
    DEBUG: true,
    FLUSH_INTERVAL_MS: 30000,
    JOIN_TIMEOUT_MS: 90000,
    MAX_DURATION_MS: 100 * 60 * 1000,
    HUMAN_DELAY_MIN: 300,
    HUMAN_DELAY_MAX: 800,
  };

  // ============ Exit phrases ============
  const EXIT_PHRASES = [
    'notetaker, please leave',
    'note taker, please leave',
    'bot, please leave',
    'notu, please leave',
  ];

  // ============ Logging ============
  function log(...args) {
    if (CONFIG.DEBUG) {
      console.log('[Notu.AI Bot]', ...args);
    }
  }

  // ============ Human-like Delay ============
  function randomDelay(min = CONFIG.HUMAN_DELAY_MIN, max = CONFIG.HUMAN_DELAY_MAX) {
    return new Promise(resolve => {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      setTimeout(resolve, delay);
    });
  }

  // ============ State ============
  let botState = {
    isActive: false,
    isInMeeting: false,
    isCaptionEnabled: false,
    captionObserver: null,
    lastCaption: '',
    segmentCount: 0,
    startTime: null,
    flushTimer: null,
    segments: [],
    activeSegments: new Map(),
  };

  // ============ Message Communication ============
  function sendMessage(type, data) {
    const message = {
      source: 'notu-bot-extension',
      type: type,
      data: data,
      timestamp: Date.now(),
    };
    
    window.postMessage(message, '*');
    
    try {
      chrome.runtime.sendMessage({ type, data });
    } catch (e) {}
    
    log('📤 Message sent:', type, JSON.stringify(data).substring(0, 100));
  }

  // ============ Click Helper - Works with both button and div[role=button] ============
  async function clickElement(selector, description) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          await randomDelay(100, 300);
          
          // For div[role=button], we need to dispatch click event
          element.click();
          log('✅ Clicked:', description || selector);
          return true;
        }
      }
    } catch (e) {
      log('❌ Click error:', e);
    }
    return false;
  }

  // ============ Find and Click by Text ============
  async function clickByText(searchTexts, timeout = 5000) {
    const startTime = Date.now();
    const texts = Array.isArray(searchTexts) ? searchTexts : [searchTexts];
    
    while (Date.now() - startTime < timeout) {
      // Search in buttons
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const btnText = btn.textContent?.toLowerCase() || '';
        for (const text of texts) {
          if (btnText.includes(text.toLowerCase())) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              await randomDelay(200, 400);
              btn.click();
              log('✅ Clicked button:', text);
              return true;
            }
          }
        }
      }
      
      await randomDelay(300, 500);
    }
    
    return false;
  }

  // ============ Mute Media - Fixed for div[role="button"] ============
  async function muteMedia() {
    log('🔇 Muting microphone and camera...');
    
    // Mic - could be button OR div[role="button"]
    const micSelectors = [
      'div[role="button"][aria-label*="Turn off microphone"]',
      'div[role="button"][data-is-muted="false"][aria-label*="microphone"]',
      'button[aria-label*="Turn off microphone"]',
    ];
    
    for (const sel of micSelectors) {
      if (await clickElement(sel, 'mute microphone')) {
        break;
      }
    }
    
    await randomDelay(500, 800);
    
    // Camera - could be button OR div[role="button"]
    const camSelectors = [
      'div[role="button"][aria-label*="Turn off camera"]',
      'div[role="button"][data-is-muted="false"][aria-label*="camera"]',
      'button[aria-label*="Turn off camera"]',
    ];
    
    for (const sel of camSelectors) {
      if (await clickElement(sel, 'mute camera')) {
        break;
      }
    }
    
    log('🔇 Media mute attempted');
  }

  // ============ Dismiss Overlays ============
  async function dismissOverlays() {
    log('Dismissing overlays...');
    
    await clickByText(['Got it', 'Dismiss', 'Continue'], 2000);
    
    // Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await randomDelay(200, 400);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  // ============ Click Join Button ============
  async function clickJoin() {
    log('🚪 Looking for join button...');
    
    // Try "Continue without microphone and camera" first
    await clickByText(['Continue without microphone and camera'], 1500);
    await randomDelay(500, 800);
    
    // List of possible join button texts
    const joinTexts = [
      'Ask to join',
      'Join now',
      'Join meeting',
      'Join call',
      'Join',
      'Gabung',
      'Minta untuk bergabung',
    ];
    
    const clicked = await clickByText(joinTexts, 8000);
    
    if (!clicked) {
      log('No join button found, pressing Enter...');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    
    return clicked;
  }

  // ============ Check if In Meeting ============
  function isInMeeting() {
    const bodyText = document.body.innerText;
    
    // FIRST: Check if still in waiting room (must be BEFORE other checks!)
    // These are ALL known waiting room messages in Google Meet
    const waitingRoomIndicators = [
      // English variants
      'Please wait until a meeting host brings you into the call', // EXACT from screenshot!
      'Asking to be let in',
      'Waiting for the host',
      'Someone will let you in soon',
      'Waiting to be admitted',
      'The host will let you in soon',
      'Wait for the host to join',
      'host brings you into the call',
      // Indonesian variants
      'Menunggu persetujuan',
      'Meminta untuk bergabung',
      'Tunggu sampai host',
      'menunggu host',
    ];
    
    for (const indicator of waitingRoomIndicators) {
      if (bodyText.includes(indicator)) {
        log('⏳ Still in waiting room:', indicator);
        return false; // Still in waiting room, NOT in meeting yet!
      }
    }
    
    // Check for Leave call button (most reliable indicator of being IN meeting)
    const leaveBtn = document.querySelector('button[aria-label*="Leave call"], button[aria-label*="Leave meeting"], button[aria-label*="Tinggalkan"]');
    if (leaveBtn) {
      // Double-check: Leave button exists AND no waiting room text
      log('📍 Found Leave button - in meeting!');
      return true;
    }
    
    // Check for meeting UI indicators (secondary checks)
    if (bodyText.includes("You've been admitted")) return true;
    if (bodyText.includes("You're the only one here")) return true;
    if (bodyText.includes("Anda satu-satunya")) return true;
    
    // Check for participant panel or other meeting UI
    const meetingUI = document.querySelector('[data-self-name], [jsname="ME4pPe"]');
    if (meetingUI) return true;
    
    return false;
  }

  // ============ Check if Meeting Ended ============
  function hasMeetingEnded() {
    const text = document.body.innerText;
    return text.includes('You left the meeting') || 
           text.includes("You've left the call") ||
           text.includes('Return to home screen') ||
           text.includes('Anda telah keluar');
  }

  // ============ Wait Until Joined ============
  async function waitUntilJoined(timeoutMs = CONFIG.JOIN_TIMEOUT_MS) {
    log('⏳ Waiting to join meeting...');
    const startTime = Date.now();
    let lastCheck = '';
    
    while (Date.now() - startTime < timeoutMs) {
      if (isInMeeting()) {
        log('✅ Successfully joined meeting!');
        return true;
      }
      
      // Check for rejection
      const bodyText = document.body.innerText;
      if (bodyText.includes("You can't join this call") || bodyText.includes("tidak dapat bergabung")) {
        log('❌ Blocked from joining');
        return false;
      }
      
      // Log status periodically
      const checkStatus = isInMeeting() ? 'in_meeting' : 'waiting';
      if (checkStatus !== lastCheck) {
        log('Status check:', checkStatus);
        lastCheck = checkStatus;
      }
      
      await randomDelay(1000, 1500);
    }
    
    log('⏱️ Timeout waiting to join');
    return false;
  }

  // ============ Send Chat Message ============
  async function sendChatMessage(message) {
    log('💬 Sending chat message...');
    
    try {
      // Open chat panel - handle both English and Indonesian
      const chatSelectors = [
        'button[aria-label*="Chat"]',
        'button[aria-label*="chat"]',
        'button[jsname="A5il2e"]',
      ];
      
      for (const sel of chatSelectors) {
        if (await clickElement(sel, 'chat button')) {
          break;
        }
      }
      
      await randomDelay(1500, 2000);
      
      // Find chat input
      const chatInput = document.querySelector('textarea[aria-label*="Send a message"], textarea[aria-label*="message"], textarea[placeholder*="message"]');
      if (chatInput) {
        chatInput.focus();
        chatInput.value = message;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        await randomDelay(500, 800);
        
        // Find and click send button or press Enter
        const sendBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="Kirim"]');
        if (sendBtn) {
          sendBtn.click();
        } else {
          chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        
        log('💬 Chat message sent');
        await randomDelay(800, 1200);
        
        // Close chat panel
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } else {
        log('Chat input not found');
      }
    } catch (e) {
      log('Chat error:', e);
    }
  }

  // ============ Enable Captions ============
  async function enableCaptions() {
    log('📝 Enabling captions...');
    
    await randomDelay(2000, 3000);
    await dismissOverlays();
    
    // Try Shift+C shortcut (multiple attempts)
    for (let i = 0; i < 5; i++) {
      log(`Caption attempt ${i + 1}: pressing 'c' key`);
      
      // Try lowercase c (some versions use this)
      document.dispatchEvent(new KeyboardEvent('keydown', { 
        key: 'c', 
        code: 'KeyC', 
        bubbles: true 
      }));
      
      await randomDelay(600, 1000);
      
      // Check if captions appeared
      const captionsRegion = document.querySelector('[role="region"][aria-live="polite"], [jsname="dsyhDe"]');
      if (captionsRegion) {
        log('📝 Captions enabled via keyboard');
        return true;
      }
      
      // Check if "Turn off captions" button visible (means already on)
      const ccOffBtn = document.querySelector('button[aria-label*="Turn off captions"], button[aria-label*="Matikan teks"]');
      if (ccOffBtn) {
        log('📝 Captions already enabled');
        return true;
      }
    }
    
    // Fallback: click captions button
    log('Trying captions button fallback...');
    const ccButton = document.querySelector('button[aria-label*="Turn on captions"], button[aria-label*="Aktifkan teks"]');
    if (ccButton) {
      ccButton.click();
      await randomDelay(1000, 1500);
      log('📝 Captions enabled via button');
      return true;
    }
    
    log('⚠️ Could not enable captions');
    return false;
  }

  // ============ Caption Scraping ============
  function startCaptionScraping() {
    log('🎤 Starting caption scraping...');
    
    const badgeSelectors = '.NWpY1d, .xoMHSc';
    let lastSpeaker = 'Unknown Speaker';
    
    const getSpeaker = (node) => {
      const badge = node.querySelector(badgeSelectors);
      return badge?.textContent?.trim() || lastSpeaker;
    };
    
    const getText = (node) => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(badgeSelectors).forEach(el => el.remove());
      return clone.textContent?.trim() || '';
    };
    
    const processCaption = (node) => {
      const text = getText(node);
      const speaker = getSpeaker(node);
      
      if (!text || text === botState.lastCaption) return;
      if (text.toLowerCase() === speaker.toLowerCase()) return;
      
      // Comprehensive filter for Google Meet UI elements
      const UI_PATTERNS = [
        // System messages
        /you left the meeting|return to home screen|leave call|feedback/i,
        /audio and video|learn more|anda telah keluar|You've left/i,
        // Button labels and tooltips
        /^Meeting details$/i,
        /^Share screen$/i,
        /^Send a reaction$/i,
        /^Turn on captions/i,
        /^Raise hand/i,
        /^Chat with everyone$/i,
        /^Meeting tools$/i,
        /^Call ends soon$/i,
        /^More options$/i,
        /^People\d*$/i,  // "People" or "People2"
        /^Meeting timer$/i,
        /^Hand raises$/i,
        /This call is open to anyone/i,
        // Icon names (material icons)
        /^(info|chat|apps|alarm|mood|meeting_room)$/i,
        /^(computer_arrow_up|computer_arrow_down)$/i,
        /^(back_hand|closed_caption|closed_caption_off)$/i,
        /^(arrow_drop_down|chat_bubble|epg-)$/i,
        /^[a-z_]+$/,  // Single lowercase word with underscores = icon name
        // Accessibility text
        /^Press Down Arrow/i,
        /hover tray|Escape to close/i,
        // Very short or no real content
        /^.{0,2}$/,  // 2 chars or less
        // Notu AI bot name appearing as caption
        /^Notu AI$/i,
      ];
      
      // Check if text matches any UI pattern
      const isUIElement = UI_PATTERNS.some(pattern => pattern.test(text));
      if (isUIElement) {
        // Don't log these to reduce noise
        return;
      }
      
      // Filter if speaker is "Unknown Speaker" and text looks like UI
      if (speaker === 'Unknown Speaker' && text.length < 50) {
        // Likely a UI element, skip
        return;
      }
      
      // Check for exit phrases
      const normalized = text.toLowerCase();
      if (EXIT_PHRASES.some(p => normalized.includes(p))) {
        log('🚪 Exit phrase detected, leaving meeting...');
        leaveMeeting('exit_phrase');
        return;
      }
      
      botState.lastCaption = text;
      botState.segmentCount++;
      lastSpeaker = speaker;
      
      const segment = {
        speaker,
        text,
        start: (Date.now() - botState.startTime) / 1000,
        end: (Date.now() - botState.startTime) / 1000,
        index: botState.segmentCount,
      };
      
      log(`🎤 [Caption] ${speaker}: ${text}`);
      
      // Manage active segments
      const existing = botState.activeSegments.get(speaker);
      if (existing && text.startsWith(existing.text.substring(0, 20))) {
        existing.text = text;
        existing.end = segment.end;
      } else {
        if (existing) {
          botState.segments.push(existing);
        }
        botState.activeSegments.set(speaker, { ...segment });
      }
      
      sendMessage('caption', segment);
    };
    
    // Set up MutationObserver
    botState.captionObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            processCaption(node);
          }
        }
        if (m.type === 'characterData' && m.target?.parentElement) {
          processCaption(m.target.parentElement);
        }
      }
    });
    
    botState.captionObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    
    log('🎤 Caption observer started');
  }

  // ============ Watch for Meeting End ============
  function watchForMeetingEnd() {
    log('👀 Watching for meeting end...');
    
    const checkEnd = setInterval(() => {
      if (hasMeetingEnded()) {
        log('🔚 Meeting ended detected');
        clearInterval(checkEnd);
        leaveMeeting('meeting_ended');
      }
    }, 2000);
    
    // Max duration timeout
    setTimeout(() => {
      log('⏱️ Max duration reached');
      leaveMeeting('max_duration');
    }, CONFIG.MAX_DURATION_MS);
  }

  // ============ Leave Meeting ============
  async function leaveMeeting(reason) {
    log('🚪 Leaving meeting:', reason);
    sendMessage('status', { status: 'leaving', reason });
    
    if (botState.captionObserver) {
      botState.captionObserver.disconnect();
    }
    
    if (botState.flushTimer) {
      clearInterval(botState.flushTimer);
    }
    
    const finalSegments = [
      ...botState.segments,
      ...Array.from(botState.activeSegments.values())
    ];
    
    // Click leave button
    const leaveSelectors = [
      'button[aria-label*="Leave call"]',
      'button[aria-label*="Leave meeting"]',
      'button[aria-label*="Tinggalkan"]',
    ];
    
    let left = false;
    for (const sel of leaveSelectors) {
      if (await clickElement(sel, 'leave call')) {
        left = true;
        break;
      }
    }
    
    if (!left) {
      // Fallback: Ctrl+Alt+Q or just close
      document.dispatchEvent(new KeyboardEvent('keydown', { 
        key: 'q', 
        ctrlKey: true, 
        altKey: true, 
        bubbles: true 
      }));
    }
    
    sendMessage('completed', {
      reason,
      segments: finalSegments,
      segmentCount: finalSegments.length,
      duration: (Date.now() - botState.startTime) / 1000,
    });
    
    botState.isActive = false;
    botState.isInMeeting = false;
    log('✅ Bot stopped, total segments:', finalSegments.length);
  }

  // ============ Flush Segments ============
  function startFlushInterval() {
    botState.flushTimer = setInterval(() => {
      const segments = Array.from(botState.activeSegments.values());
      if (segments.length > 0) {
        sendMessage('flush', {
          segments,
          count: botState.segmentCount,
          duration: (Date.now() - botState.startTime) / 1000,
        });
      }
    }, CONFIG.FLUSH_INTERVAL_MS);
  }

  // ============ Main Bot Flow ============
  async function runBot() {
    if (botState.isActive) {
      log('⚠️ Bot already active');
      return;
    }
    
    log('🚀🚀🚀 Bot starting...');
    botState.isActive = true;
    botState.startTime = Date.now();
    
    sendMessage('status', { status: 'starting' });
    
    try {
      // Wait for page to stabilize
      await randomDelay(2000, 3000);
      
      // Mute media first
      await muteMedia();
      
      // Dismiss popups
      await dismissOverlays();
      
      // Click join button
      sendMessage('status', { status: 'joining' });
      await clickJoin();
      
      // Wait until joined
      sendMessage('status', { status: 'waiting_admission' });
      const joined = await waitUntilJoined();
      
      if (!joined) {
        sendMessage('status', { status: 'failed', error: 'Could not join meeting' });
        botState.isActive = false;
        return;
      }
      
      // ✅ Successfully joined!
      botState.isInMeeting = true;
      sendMessage('status', { status: 'in_meeting' });
      log('🎉 IN_MEETING status sent!');
      
      // Announce recording
      await sendChatMessage('📝 Notu.AI Bot is now recording this meeting for transcription.');
      
      // Enable captions
      sendMessage('status', { status: 'enabling_captions' });
      await enableCaptions();
      
      // Start recording
      sendMessage('status', { status: 'recording' });
      startCaptionScraping();
      startFlushInterval();
      
      // Watch for meeting end
      watchForMeetingEnd();
      
      log('✅✅✅ Bot is now recording!');
      
    } catch (error) {
      log('❌ Bot error:', error);
      sendMessage('status', { status: 'failed', error: error.message });
      botState.isActive = false;
    }
  }

  // ============ Message Handler ============
  window.addEventListener('message', async (event) => {
    if (event.data?.source === 'notu-bot-controller') {
      const { type } = event.data;
      log('📥 Received command:', type);
      
      if (type === 'start' && !botState.isActive) {
        runBot();
      } else if (type === 'stop' && botState.isActive) {
        leaveMeeting('user_requested');
      }
    }
  });

  // ============ Auto-start ============
  function shouldAutoStart() {
    const meetingPattern = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
    return meetingPattern.test(window.location.href);
  }

  if (shouldAutoStart()) {
    log('🔍 Detected meeting URL, auto-starting in 3 seconds...');
    setTimeout(() => runBot(), 3000);
  }

  log('📦 Content script loaded on', window.location.href);
  sendMessage('loaded', { url: window.location.href });

})();
