/**
 * Audio Capture Module for Notu.AI Meet Bot
 * 
 * Captures meeting audio using background script's tabCapture API.
 * Sends chunks to backend for Whisper transcription via message relay.
 */

class AudioCapture {
  constructor() {
    this.isRecording = false;
    this.meetingId = null;
    this.chunkCount = 0;
    this.messageHandler = null;
  }

  /**
   * Start capturing audio from the current tab
   * This sends a message to background script to start tabCapture
   */
  async start(meetingId) {
    if (this.isRecording) {
      console.log('[AudioCapture] Already recording');
      return true;
    }

    this.meetingId = meetingId;
    console.log('[AudioCapture] Starting audio capture for meeting:', meetingId);

    try {
      // Set up listener for audio chunks from background script
      this.setupChunkListener();
      
      // Request background script to start tabCapture
      const result = await this.sendToBackground('start_audio_capture', { meetingId });
      
      if (result && result.success) {
        this.isRecording = true;
        console.log('[AudioCapture] Recording started via background tabCapture');
        return true;
      } else {
        console.error('[AudioCapture] Failed to start:', result?.error);
        return false;
      }
    } catch (error) {
      console.error('[AudioCapture] Failed to start:', error);
      return false;
    }
  }

  /**
   * Set up listener for audio chunks from background script
   */
  setupChunkListener() {
    // Remove existing listener if any
    if (this.messageHandler) {
      chrome.runtime.onMessage.removeListener(this.messageHandler);
    }
    
    this.messageHandler = (message, sender, sendResponse) => {
      if (message.type === 'audio_chunk_data') {
        this.handleChunkFromBackground(message);
        sendResponse({ received: true });
      }
      return true;
    };
    
    chrome.runtime.onMessage.addListener(this.messageHandler);
    console.log('[AudioCapture] Chunk listener set up');
  }

  /**
   * Handle audio chunk received from background script
   */
  handleChunkFromBackground(data) {
    this.chunkCount++;
    console.log('[AudioCapture] Received chunk', this.chunkCount, 'size:', data.size, 'bytes');
    
    const payload = {
      type: 'audio_chunk',
      meetingId: this.meetingId,
      audioData: data.audioData,
      timestamp: data.timestamp,
      duration: data.duration,
      mimeType: 'audio/webm',
    };

    // Send via postMessage to be picked up by the orchestrator (meetBot.ts)
    window.postMessage({
      source: 'notu-bot-extension',
      ...payload,
    }, '*');

    console.log('[AudioCapture] Chunk forwarded to orchestrator');
  }

  /**
   * Send message to background script and wait for response
   */
  sendToBackground(type, data = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...data }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[AudioCapture] sendMessage error:', chrome.runtime.lastError.message);
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        console.error('[AudioCapture] sendMessage exception:', error);
        resolve({ success: false, error: error.message });
      }
    });
  }

  /**
   * Stop audio capture
   */
  async stop() {
    console.log('[AudioCapture] Stopping...');
    
    if (this.messageHandler) {
      chrome.runtime.onMessage.removeListener(this.messageHandler);
      this.messageHandler = null;
    }
    
    if (this.isRecording) {
      await this.sendToBackground('stop_audio_capture');
    }
    
    this.isRecording = false;
    console.log('[AudioCapture] Stopped, total chunks:', this.chunkCount);
  }

  /**
   * Check if currently recording
   */
  getIsRecording() {
    return this.isRecording;
  }
}

// Export for use in content script
window.NotuAudioCapture = AudioCapture;
