/**
 * Notu.AI Meet Bot - Content Script (Comprehensive Fix)
 * 
 * This script runs in the context of Google Meet pages.
 * It handles all DOM interaction to avoid bot detection.
 * 
 * Fixed issues:
 * - Caption language dialog handling
 * - Proper mic/camera disable
 * - Chat message sending
 * - Indonesian caption support
 * - Proper status reporting
 */

(function() {
  'use strict';

  // ============ Configuration ============
  const CONFIG = {
    DEBUG: true,
    FLUSH_INTERVAL_MS: 30000,
    JOIN_TIMEOUT_MS: 120000, // Increased timeout
    MAX_DURATION_MS: 100 * 60 * 1000,
    HUMAN_DELAY_MIN: 300,
    HUMAN_DELAY_MAX: 800,
    CAPTION_LANGUAGE: 'id', // Indonesian
    BOT_NAME: 'Notu AI',
  };

  // ============ Exit phrases ============
  const EXIT_PHRASES = [
    'notetaker, please leave',
    'note taker, please leave',
    'bot, please leave',
    'notu, please leave',
    'notu silahkan keluar',
    'notu keluar',
    'notu out',
    'notu exit',
    'bot keluar',
    'bot silahkan keluar',
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

  // ============ State  // Bot state
  const botState = {
    isActive: false,
    isInMeeting: false,
    isCaptionEnabled: false,
    lastCaption: '',
    segments: [],
    activeSegments: new Map(),
    captionObserver: null,
    flushIntervalId: null,
    segmentCount: 0,
    startTime: Date.now(),
    audioCapture: null, // Audio capture instance
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

  // ============ Click Helper ============
  async function clickElement(selector, description) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          await randomDelay(100, 300);
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
      const buttons = document.querySelectorAll('button, div[role="button"]');
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

  // ============ Handle Caption Language Dialog ============
  // DISABLED: User requested to use keyboard shortcut only (Shift+C)
  /*
  async function handleCaptionLanguageDialog() {
    log('🌐 Handling caption language dialog...');
    
    try {
      await randomDelay(1500, 2000);
      
      // Step 1: Hover over the caption language section to reveal the dropdown
      log('Step 1: Hovering over caption section to reveal dropdown...');
      
      const sectionSelectors = [
        '#ow11 > div > div > div.TKU8Od > div.crqnQb',
        'div.crqnQb',
        'div[jsname="r4nke"]',
        'div.qUPVAc',
      ];
      
      for (const sel of sectionSelectors) {
        const section = document.querySelector(sel);
        if (section) {
          section.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          section.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          log('Hovered:', sel);
          await randomDelay(1000, 1500);
          break;
        }
      }
      
      // Step 2: Click the language dropdown
      log('Step 2: Clicking language dropdown...');
      
      const dropdownSelectors = [
        '#ow11 > div > div > div.TKU8Od > div.crqnQb > div > div.fJsklc.nulMpf.Didmac.G03iKb.hLkVuf > div > div > div.NmXUuc.P9KVBf.IGXezb > div.qUPVAc',
        'div.qUPVAc',
        'div[role="combobox"]',
        'div[jsname="oYxtQd"]',
        '[aria-haspopup="listbox"]',
      ];
      
      let dropdownClicked = false;
      for (const sel of dropdownSelectors) {
        const dropdown = document.querySelector(sel);
        if (dropdown) {
          const rect = dropdown.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            dropdown.click();
            log('Clicked dropdown:', sel);
            dropdownClicked = true;
            await randomDelay(1000, 1500);
            break;
          }
        }
      }
      
      if (!dropdownClicked) {
        log('⚠️ Could not find dropdown, trying fallback...');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }
      
      // Step 3: Find and click Indonesia option OR type it
      log('Step 3: Looking for Indonesia option...');
      
      // Try direct click first
      const allOptions = document.querySelectorAll('li[role="option"]');
      for (const opt of allOptions) {
        const text = opt.textContent || '';
        if (text.includes('Indonesia')) {
          opt.click();
          log('✅ Clicked Indonesia option');
          await randomDelay(800, 1000);
          return true;
        }
      }
      
      // Type Indonesia and press Enter
      log('Typing Indonesia...');
      const typingTarget = document.activeElement || document.body;
      
      for (const char of 'Indonesia') {
        typingTarget.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        typingTarget.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        await randomDelay(50, 100);
      }
      
      await randomDelay(800, 1000);
      
      // Press Enter
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      log('Pressed Enter');
      await randomDelay(500, 800);
      
      log('✅ Caption language handled');
      return true;
      
    } catch (error) {
      log('❌ Error:', error);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
  }
  */

  // ============ Disable Media (Mic & Camera) ============
  async function disableMedia() {
    log('🔇 Disabling microphone and camera...');
    
    // Wait longer for pre-join screen to fully load
    await randomDelay(3000, 4000);
    
    // Try multiple times to ensure it works
    for (let attempt = 0; attempt < 3; attempt++) {
      log(`Attempt ${attempt + 1} to disable media...`);
      
      // Microphone - Multiple selector approaches
      const micSelectors = [
        // Pre-join screen buttons
        'div[role="button"][aria-label*="Turn off microphone"]',
        'div[role="button"][data-is-muted="false"][aria-label*="microphone"]',
        'button[aria-label*="Turn off microphone"]',
        '[data-tooltip*="Turn off microphone"]',
        // Indonesian
        'div[role="button"][aria-label*="Matikan mikrofon"]',
        'button[aria-label*="Matikan mikrofon"]',
        // Keyboard shortcut target
        '[jscontroller][jsaction*="microphone"]',
      ];
      
      let micMuted = false;
      for (const sel of micSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            await randomDelay(200, 400);
            el.click();
            log('✅ Microphone disabled');
            micMuted = true;
            break;
          }
        }
      }
      
      if (!micMuted) {
        // Try keyboard shortcut Ctrl+D
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'd',
          code: 'KeyD',
          ctrlKey: true,
          bubbles: true
        }));
        await randomDelay(300, 500);
        
        // Check if already muted
        const mutedMic = document.querySelector('[aria-label*="Turn on microphone"], [aria-label*="Aktifkan mikrofon"]');
        if (mutedMic) {
          log('✅ Microphone already muted');
          micMuted = true;
        }
      }
      
      await randomDelay(800, 1200);
      
      // Camera - Multiple selector approaches
      const camSelectors = [
        'div[role="button"][aria-label*="Turn off camera"]',
        'div[role="button"][data-is-muted="false"][aria-label*="camera"]',
        'button[aria-label*="Turn off camera"]',
        '[data-tooltip*="Turn off camera"]',
        // Indonesian
        'div[role="button"][aria-label*="Matikan kamera"]',
        'button[aria-label*="Matikan kamera"]',
        '[jscontroller][jsaction*="camera"]',
      ];
      
      let camMuted = false;
      for (const sel of camSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            await randomDelay(200, 400);
            el.click();
            log('✅ Camera disabled');
            camMuted = true;
            break;
          }
        }
      }
      
      if (!camMuted) {
        // Try keyboard shortcut Ctrl+E
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'e',
          code: 'KeyE',
          ctrlKey: true,
          bubbles: true
        }));
        await randomDelay(300, 500);
        
        const mutedCam = document.querySelector('[aria-label*="Turn on camera"], [aria-label*="Aktifkan kamera"]');
        if (mutedCam) {
          log('✅ Camera already muted');
          camMuted = true;
        }
      }
      
      // If both muted, break
      if (micMuted && camMuted) {
        log('🔇 Media disable completed:', { mic: micMuted, cam: camMuted });
        return { mic: micMuted, cam: camMuted };
      }
      
      // Wait before retry
      await randomDelay(1000, 1500);
    }
    
    log('⚠️ Media disable attempts completed (may not be fully muted)');
    return { mic: false, cam: false };
  }

  // ============ Dismiss Overlays ============
  async function dismissOverlays() {
    log('Dismissing overlays...');
    
    await clickByText(['Got it', 'Dismiss', 'Continue', 'Mengerti', 'Lanjutkan'], 2000);
    
    // Press Escape multiple times
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await randomDelay(200, 400);
    }
  }

  // ============ Click Join Button ============
  async function clickJoin() {
    log('🚪 Looking for join button...');
    
    // Handle "Continue without microphone and camera" if shown
    await clickByText(['Continue without microphone and camera', 'Lanjutkan tanpa mikrofon dan kamera'], 2000);
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
      'Gabung sekarang',
    ];
    
    const clicked = await clickByText(joinTexts, 10000);
    
    if (!clicked) {
      log('❌ No join button found');
      // Try pressing Enter as fallback
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    
    return clicked;
  }

  // ============ Check if In Meeting ============
  function isInMeeting() {
    // BEST PRACTICE: Use POSITIVE indicator - wait for meeting code to appear
    // Meeting code element only appears AFTER actually joining the meeting
    
    // Step 1: Check if meeting code element exists (POSITIVE indicator)
    const meetingCodeSelectors = [
      'div[tt-id^="ucc-"]', // Meeting code tooltip element
      'div.uBRSj[tt-id]',   // Alternative selector
      'span.WfLVEc',        // Parent container
    ];
    
    let meetingCodeFound = false;
    for (const sel of meetingCodeSelectors) {
      const element = document.querySelector(sel);
      if (element) {
        // Verify it contains actual meeting code (format: XXX-XXXX-XXX)
        const text = element.textContent || '';
        if (text.match(/[A-Z]{3}-[a-z]{4}-[A-Z]{3}/i)) {
          log('✅ Meeting code found:', text.substring(0, 15), '- IN MEETING');
          meetingCodeFound = true;
          break;
        }
      }
    }
    
    if (meetingCodeFound) {
      return true; // Definitely in meeting
    }
    
    // Step 2: Double-check we're NOT in waiting room (negative indicator as backup)
    const waitingRoomElement = document.querySelector('.U0e0y');
    if (waitingRoomElement) {
      log('⏳ Waiting room element exists - NOT in meeting');
      return false;
    }
    
    // Step 3: Check for waiting room text (backup check)
    const bodyText = document.body.innerText;
    const waitingTexts = [
      'Harap tunggu hingga penyelenggara rapat membawa Anda ke panggilan',
      'Please wait until a meeting host brings you into the call',
      'Asking to be let in',
      'Waiting for the host',
      'Menunggu persetujuan',
      'Tunggu sampai host',
    ];
    
    for (const text of waitingTexts) {
      if (bodyText.includes(text)) {
        log('⏳ Waiting room text detected - NOT in meeting');
        return false;
      }
    }
    
    // No meeting code found and no waiting indicators
    // This is ambiguous state - default to NOT in meeting to be safe
    log('⚠️ Ambiguous state - no meeting code found, assuming NOT in meeting yet');
    return false;
  }

  // ============ Check if Meeting Ended ============
  function hasMeetingEnded() {
    const text = document.body.innerText;
    
    // Check for host-ended meeting (highest priority)
    const hostEndedHeading = document.querySelector('h1[jsname="r4nke"]');
    if (hostEndedHeading) {
      const headingText = hostEndedHeading.textContent || '';
      if (headingText.includes('Penyelenggara mengakhiri rapat') || 
          headingText.includes('host ended the meeting for everyone')) {
        log('🔚 Host ended the meeting for everyone');
        return true;
      }
    }
    
    // Regular meeting end indicators
    return text.includes('You left the meeting') || 
           text.includes("You've left the call") ||
           text.includes('Return to home screen') ||
           text.includes('Anda telah keluar') ||
           text.includes('Anda meninggalkan rapat') ||
           text.includes('Kembali ke layar utama');
  }

  // ============ Wait Until Joined ============
  async function waitUntilJoined(timeoutMs = CONFIG.JOIN_TIMEOUT_MS) {
    log('⏳ Waiting to join meeting...');
    const startTime = Date.now();
    let lastStatus = '';
    let checkCount = 0;
    
    while (Date.now() - startTime < timeoutMs) {
      checkCount++;
      
      
      // Debug: Log element check every 10 iterations
      if (checkCount % 10 === 0) {
        const waitingEl = document.querySelector('.U0e0y');
        log(`[Check #${checkCount}] .U0e0y element: ${waitingEl ? 'EXISTS' : 'NOT FOUND'}`);
      }
      
      if (isInMeeting()) {
        log('✅ Successfully joined meeting!');
        return true;
      }
      
      // Check for rejection
      const bodyText = document.body.innerText;
      if (bodyText.includes("You can't join this call") || 
          bodyText.includes("tidak dapat bergabung") ||
          bodyText.includes("denied")) {
        log('❌ Blocked from joining');
        return false;
      }
      
      // Log status changes
      const currentStatus = isInMeeting() ? 'in_meeting' : 'waiting';
      if (currentStatus !== lastStatus) {
        log('Status:', currentStatus);
        lastStatus = currentStatus;
      }
      
      await randomDelay(1000, 1500);
    }
    
    log('⏱️ Timeout waiting to join');
    return false;
  }

  // ============ Send Chat Message ============
  async function sendChatMessage(message) {
    log('💬 Sending chat message:', message);
    
    try {
      // Wait for meeting to stabilize
      await randomDelay(3000, 4000);
      
      // Try keyboard shortcut first (Ctrl+C or just open chat)
      let chatOpened = false;
      
      // Try clicking chat button
      const chatBtnSelectors = [
        'button[aria-label*="Chat with everyone"]',
        'button[aria-label*="Chat"]',
        '[data-tooltip*="Chat"]',
        'button[aria-label*="Pesan"]',
      ];
      
      for (const sel of chatBtnSelectors) {
        if (await clickElement(sel, 'open chat')) {
          chatOpened = true;
          break;
        }
      }
      
      if (!chatOpened) {
        log('⚠️ Could not open chat panel');
        return false;
      }
      
      await randomDelay(1500, 2000);
      
      // Find chat input
      const chatInputSelectors = [
        'textarea[aria-label*="Send a message"]',
        'textarea[aria-label*="message"]',
        'textarea[placeholder*="message"]',
        'textarea[placeholder*="Send"]',
        'input[aria-label*="message"]',
        'textarea[aria-label*="Kirim pesan"]',
      ];
      
      let chatInput = null;
      for (const sel of chatInputSelectors) {
        chatInput = document.querySelector(sel);
        if (chatInput) {
          log('Found chat input with selector:', sel);
          break;
        }
      }
      
      if (!chatInput) {
        log('⚠️ Chat input not found');
        // Close chat panel
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
      }
      
      // Focus and type message
      chatInput.focus();
      await randomDelay(500, 800);
      
      // Clear existing content
      chatInput.value = '';
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      await randomDelay(200, 300);
      
      // Type message character by character
      for (const char of message) {
        chatInput.value += char;
        // Trigger both input and change events
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        chatInput.dispatchEvent(new Event('change', { bubbles: true }));
        await randomDelay(30, 80);
      }
      
      // Final events to ensure button is enabled
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      chatInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      await randomDelay(1000, 1500); // Wait longer for send button to enable
      
      // Try to find and click send button
      const sendBtnSelectors = [
        'button[aria-label*="Send"]',
        'button[aria-label*="Kirim"]',
        '[data-tooltip*="Send"]',
        'button[jsname]', // Generic button in chat area
      ];
      
      let sent = false;
      for (const sel of sendBtnSelectors) {
        const buttons = document.querySelectorAll(sel);
        for (const sendBtn of buttons) {
          // Check if button is in chat panel and not disabled
          const isDisabled = sendBtn.hasAttribute('disabled') || sendBtn.getAttribute('aria-disabled') === 'true';
          if (!isDisabled) {
            const rect = sendBtn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              sendBtn.click();
              sent = true;
              log('💬 Clicked send button');
              break;
            }
          }
        }
        if (sent) break;
      }
      
      if (!sent) {
        // Use Enter key as fallback
        chatInput.dispatchEvent(new KeyboardEvent('keydown', { 
          key: 'Enter', 
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
        chatInput.dispatchEvent(new KeyboardEvent('keypress', { 
          key: 'Enter', 
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
        log('💬 Sent with Enter key');
      }
      
      await randomDelay(800, 1200);
      
      // Close chat panel
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      
      log('💬 Chat message sent successfully!');
      return true;
    } catch (e) {
      log('❌ Chat error:', e);
      return false;
    }
  }

  // ============ Enable Captions ============
  async function enableCaptions() {
    log('⌨️ Enabling captions via shortcut (c)...');
    try {
      // Allow UI to settle
      await randomDelay(2000, 3000);
      
      // Press 'c' to toggle captions
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keypress', { key: 'c', code: 'KeyC', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'c', code: 'KeyC', bubbles: true }));
      
      await randomDelay(1000, 1500);
      
      // Check if captions appeared (by looking for caption container)
      const captionContainer = document.querySelector('.TbmXe, .iOzk7, .V4259c');
      if (captionContainer) {
          log('✅ Captions enabled via shortcut');
          botState.isCaptionEnabled = true;
          return true;
      }
      
      // If not, try Shift + c
      log('Trying Shift+C...');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', code: 'KeyC', shiftKey: true, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keypress', { key: 'C', code: 'KeyC', shiftKey: true, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'C', code: 'KeyC', shiftKey: true, bubbles: true }));
      
      botState.isCaptionEnabled = true; // Assume success
      return true;
    } catch (error) {
       log('❌ Error enabling captions:', error);
       return false;
    }
  }

  // ============ Set Caption Language to Indonesian ============
  async function setCaptionLanguage() {
    log('🌐 Setting caption language to Indonesian...');
    
    try {
      await randomDelay(2000, 3000);
      
      // Step 1: Click "More options" button (three dots)
      log('Step 1: Opening more options menu...');
      const moreOptionsSelectors = [
        'button[aria-label*="More options"]',
        'button[aria-label*="Opsi lainnya"]',
        '[data-tooltip*="More options"]',
        'button[jsname="V67aGc"]',
      ];
      
      let optionsOpened = false;
      for (const sel of moreOptionsSelectors) {
        if (await clickElement(sel, 'more options')) {
          optionsOpened = true;
          break;
        }
      }
      
      if (!optionsOpened) {
        log('⚠️ Could not open more options menu');
        return false;
      }
      
      await randomDelay(1000, 1500);
      
      // Step 2: Click "Setelan" (Settings)
      log('Step 2: Clicking Settings...');
      const settingsClicked = await clickByText(['Settings', 'Setelan'], 3000);
      
      if (!settingsClicked) {
        log('⚠️ Could not find Settings option');
        return false;
      }
      
      await randomDelay(1500, 2000);
      
      // Step 3: Click "Teks" TAB (not menu item)
      log('Step 3: Clicking Teks tab...');
      const tekstTab = document.querySelector('button[aria-label="Teks"]') ||
                       document.querySelector('button[aria-label="Captions"]') ||
                       document.querySelector('button[role="tab"][aria-label*="Teks"]');
      
      if (!tekstTab) {
        log('⚠️ Could not find Teks tab');
        return false;
      }
      
      tekstTab.click();
      log('✅ Clicked Teks tab');
      
      await randomDelay(1500, 2000);
      
      // Step 4: Click language dropdown to open list
      log('Step 4: Opening language dropdown...');
      const langDropdown = document.querySelector('div[jsname="oYxtQd"][role="combobox"][aria-label*="Bahasa"]') || 
                           document.querySelector('div[jsname="oYxtQd"][role="combobox"][aria-label*="Language"]') ||
                           document.querySelector('div[jsname="oYxtQd"][role="combobox"]');
      
      if (!langDropdown) {
        log('⚠️ Could not find language dropdown');
        return false;
      }
      
      langDropdown.click();
      log('Clicked language dropdown');
      await randomDelay(1500, 2000);
      
      // Step 5: Find and click Indonesia LI element from list
      log('Step 5: Looking for Indonesia option in list...');
      
      // Try multiple selectors for the Indonesia option
      const indonesiaSelectors = [
        'li[role="option"][data-value="id-ID"]',
        'li[role="option"][aria-label*="Indonesia (Indonesia)"]',
        'li[role="option"] span.aqdrmf-rymPhb-fpDzbe-fmcmS:contains("Indonesia (Indonesia)")',
      ];
      
      let clicked = false;
      for (const sel of indonesiaSelectors) {
        const option = document.querySelector(sel);
        if (option) {
          option.click();
          log('✅ Clicked Indonesia option:', sel);
          clicked = true;
          break;
        }
      }
      
      // Fallback: Search all LI options for text match
      if (!clicked) {
        log('Trying text match fallback...');
        const allOptions = document.querySelectorAll('li[role="option"]');
        for (const option of allOptions) {
          const text = option.textContent || '';
          const ariaLabel = option.getAttribute('aria-label') || '';
          if (text.includes('Indonesia (Indonesia)') || ariaLabel.includes('Indonesia (Indonesia)')) {
            option.click();
            log('✅ Clicked Indonesia option via text match');
            clicked = true;
            break;
          }
        }
      }
      
      if (!clicked) {
        log('⚠️ Could not find Indonesia option in dropdown');
        return false;
      }
      
      await randomDelay(1000, 1500);
      
      // Step 6: Close settings dialog with X button
      log('Step 6: Closing settings...');
      const closeBtn = document.querySelector('button[aria-label*="Tutup"]') ||
                       document.querySelector('button[aria-label*="Close"]') ||
                       document.querySelector('button[data-mdc-dialog-action="close"]');
      
      if (closeBtn) {
        closeBtn.click();
        log('✅ Closed settings dialog with X button');
      } else {
        // Fallback to Escape if X button not found
        for (let i = 0; i < 3; i++) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await randomDelay(300, 500);
        }
        log('✅ Closed settings with Escape (fallback)');
      }
      
      log('✅ Caption language set to Indonesian');
      return true;
      
    } catch (error) {
      log('❌ Error setting caption language:', error);
      return false;
    }
  }

  // ============ Caption Scraping ============
  function startCaptionScraping() {
    log('🎤 Starting caption scraping...');
    
    const badgeSelectors = '.NWpY1d, .xoMHSc';
    let lastSpeaker = null; // Changed from 'Unknown Speaker' to null
    
    const getSpeaker = (node) => {
      // Try to find speaker in current node AND parent nodes
      let currentNode = node;
      
      for (let depth = 0; depth < 5; depth++) { // Check up to 5 parent levels
        if (!currentNode) break;
        
        // Priority 1: Direct span.NWpY1d (user provided selector)
        const directSpan = currentNode.querySelector('span.NWpY1d');
        if (directSpan) {
          const name = directSpan.textContent?.trim();
          if (name && name.length > 0 && name !== 'Unknown Speaker') {
            lastSpeaker = name;
            return name;
          }
        }
        
        // Priority 2: Check if current node itself is the name element
        if (currentNode.classList?.contains('NWpY1d') || currentNode.classList?.contains('xoMHSc')) {
          const name = currentNode.textContent?.trim();
          if (name && name.length > 0 && name !== 'Unknown Speaker') {
            lastSpeaker = name;
            return name;
          }
        }
        
        // Priority 3: Standard Meet selectors within current node
        const nameSelectors = [
          'div.KcIKyf.jxFHg span.NWpY1d', // Full path selector
          '.xoMHSc', // Another common name class
          'img.K63Fr', // Avatar image (alt text)
          'div[jsname="tBTfMc"]', // Name container
          '.zs7s8d', // Tile name
          'div[data-participant-id]', // Participant container
        ];
  
        for (const sel of nameSelectors) {
           const el = currentNode.querySelector(sel);
           if (el) {
               const txt = el.textContent?.trim() || el.getAttribute('alt')?.trim() || el.getAttribute('aria-label')?.trim();
               if (txt && txt.length > 0 && txt !== 'Unknown Speaker' && !txt.match(/^\d+$/)) {
                   lastSpeaker = txt;
                   return txt;
               }
           }
        }
        
        currentNode = currentNode.parentElement;
      }
      
      // Return last valid speaker or a safe fallback
      return lastSpeaker || 'Speaker';
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
      
      // UI element filter
      const UI_PATTERNS = [
        /you left the meeting|return to home screen|leave call|feedback/i,
        /audio and video|learn more|anda telah keluar|You've left/i,
        /^Meeting details$/i,
        /^Share screen$/i,
        /^Send a reaction$/i,
        /^Turn on captions/i,
        /^Raise hand/i,
        /^Chat with everyone$/i,
        /^Meeting tools$/i,
        /^Call ends soon$/i,
        /^More options$/i,
        /^People\d*$/i,
        /^Meeting timer$/i,
        /^Hand raises$/i,
        /This call is open to anyone/i,
        /^(info|chat|apps|alarm|mood|meeting_room)$/i,
        /^(computer_arrow_up|computer_arrow_down)$/i,
        /^(back_hand|closed_caption|closed_caption_off)$/i,
        /^(arrow_drop_down|chat_bubble|epg-)$/i,
        /^[a-z_]+$/,
        /^Press Down Arrow/i,
        /hover tray|Escape to close/i,
        /^.{0,2}$/,
        /^Notu AI$/i,
        /Indonesian|English/i, // Filter language dialog text
      ];
      
      if (UI_PATTERNS.some(pattern => pattern.test(text))) {
        return;
      }
      
      if (speaker === 'Unknown Speaker' && text.length < 10) {
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
      
      // Calculate estimated duration based on word count (~150 words/min = 2.5 words/sec)
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
      const estimatedDuration = Math.max(1, wordCount / 2.5); // Minimum 1 second
      
      const currentTime = (Date.now() - botState.startTime) / 1000;
      
      const segment = {
        speaker,
        text,
        start: Math.max(0, currentTime - estimatedDuration), // Estimated start
        end: currentTime,
        index: botState.segmentCount,
        wordCount: wordCount,
      };
      
      log(`🎤 [Caption] ${speaker}: ${text} (${wordCount} words, ~${estimatedDuration.toFixed(1)}s)`);
      
      // Segment management - merge or create new
      const existing = botState.activeSegments.get(speaker);
      if (existing && text.startsWith(existing.text.substring(0, 20))) {
        // Update existing segment
        existing.text = text;
        existing.end = segment.end;
        existing.wordCount = wordCount;
      } else {
        // Push existing and create new
        if (existing) {
          botState.segments.push(existing);
        }
        botState.activeSegments.set(speaker, { ...segment });
      }
      
      sendMessage('caption', segment);
    };
    
    // MutationObserver
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
      '[data-tooltip*="Leave"]',
    ];
    
    let left = false;
    for (const sel of leaveSelectors) {
      if (await clickElement(sel, 'leave call')) {
        left = true;
        break;
      }
    }
    
    if (!left) {
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

  // ============ Audio Capture ============
  async function startAudioCapture() {
    try {
      log('🎵 Starting audio capture...');
      
      // Check if AudioCapture class is available
      if (typeof window.NotuAudioCapture === 'undefined') {
        log('⚠️ AudioCapture module not loaded, skipping');
        return false;
      }
      
      // Get meeting ID from URL
      const meetingId = window.location.pathname.slice(1);
      
      // Initialize and start
      botState.audioCapture = new window.NotuAudioCapture();
      const started = await botState.audioCapture.start(meetingId);
      
      if (started) {
        log('✅ Audio capture started');
      } else {
        log('⚠️ Audio capture failed (user may have denied permission)');
      }
      
      return started;
    } catch (error) {
      log('❌ Audio capture error:', error.message);
      return false;
    }
  }

  function stopAudioCapture() {
    if (botState.audioCapture) {
      log('🛑 Stopping audio capture...');
      try {
        botState.audioCapture.stop();
        botState.audioCapture = null;
        log('✅ Audio capture stopped');
      } catch (error) {
        log('⚠️ Error stopping audio:', error.message);
      }
    }
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
      
      
      // Step 2: Disable mic and camera FIRST
      sendMessage('status', { status: 'disabling_media' });
      await disableMedia();
      
      // Step 3: Dismiss popups
      await dismissOverlays();
      
      // Step 4: Click join button
      sendMessage('status', { status: 'joining' });
      await clickJoin();
      
      // Step 5: Wait until joined
      sendMessage('status', { status: 'waiting_admission', message: 'Waiting for host approval...' });
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
      
      // Step 7: Enable captions (with Indonesian)
      sendMessage('status', { status: 'enabling_captions' });
      await enableCaptions();
      
      // Step 6: Send chat message
      await sendChatMessage('📝 Notu.AI Bot sedang merekam meeting ini untuk transkripsi.');
      
      
      // Step 7.5: Set caption language to Indonesian via settings
      // await setCaptionLanguage();
      
      // Step 8: Start recording
      sendMessage('status', { status: 'recording' });
      startCaptionScraping();
      startFlushInterval();
      
      // Step 8.5: Start audio capture
      await startAudioCapture();
      
      // Step 9: Watch for meeting end
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
