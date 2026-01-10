/**
 * Caption Scraper Utilities
 * 
 * These functions are injected into the browser context via page.evaluate()
 * to scrape captions from Google Meet's DOM using MutationObserver.
 */

import { CaptionEvent, Segment } from './types';

/**
 * Caption matching pattern to filter out system messages
 */
const SYSTEM_MESSAGE_PATTERNS = [
    /you left the meeting/i,
    /return to home screen/i,
    /leave call/i,
    /feedback/i,
    /audio and video/i,
    /learn more/i,
    /you're the only one here/i,
    /waiting for others/i,
    /someone has already admitted/i,
    /presenting now/i,
];

/**
 * Check if text is a system message (not a real caption)
 */
export function isSystemMessage(text: string): boolean {
    return SYSTEM_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Parse caption element to extract speaker and text
 * Google Meet caption structure:
 * - Caption container has role="region" and aria-live="polite"
 * - Speaker name is typically in an element with specific styling
 * - Caption text follows the speaker name
 */
export function parseCaptionElement(element: Element): CaptionEvent | null {
    const text = element.textContent?.trim();
    if (!text || isSystemMessage(text)) {
        return null;
    }

    // Try to extract speaker name
    // Google Meet typically structures captions as "Speaker Name\nCaption Text"
    const lines = text.split('\n').filter((line) => line.trim());

    if (lines.length >= 2) {
        return {
            speaker: lines[0].trim(),
            text: lines.slice(1).join(' ').trim(),
        };
    }

    // If no clear speaker separation, use "Unknown" as speaker
    if (lines.length === 1) {
        return {
            speaker: 'Unknown',
            text: lines[0].trim(),
        };
    }

    return null;
}

/**
 * Script to inject into browser for caption observation
 * This is executed in the browser context, not Node.js
 */
export function getInjectionScript(): string {
    return `
    (function() {
      // Dedupe tracking
      let lastCaption = '';
      let lastSpeaker = '';
      let lastCaptionTime = 0;
      const DEDUPE_THRESHOLD_MS = 500;

      // System message patterns to filter
      const systemPatterns = [
        /you left the meeting/i,
        /return to home screen/i,
        /leave call/i,
        /feedback/i,
        /audio and video/i,
        /learn more/i,
        /you're the only one here/i,
        /waiting for others/i,
        /someone has already admitted/i,
        /presenting now/i,
      ];

      function isSystemMessage(text) {
        return systemPatterns.some(p => p.test(text));
      }

      function parseCaption(element) {
        const text = element.textContent?.trim();
        if (!text || isSystemMessage(text)) return null;

        const lines = text.split('\\n').filter(l => l.trim());
        if (lines.length >= 2) {
          return {
            speaker: lines[0].trim(),
            text: lines.slice(1).join(' ').trim()
          };
        }
        if (lines.length === 1) {
          return { speaker: 'Unknown', text: lines[0].trim() };
        }
        return null;
      }

      // Find caption container
      const captionContainer = document.querySelector('[role="region"][aria-live="polite"]') 
        || document.querySelector('[aria-live="polite"]')
        || document.querySelector('[jsname="dsyhDe"]');

      if (!captionContainer) {
        console.error('[CaptionScraper] Caption container not found');
        return;
      }

      console.log('[CaptionScraper] Found caption container, setting up observer');

      // Create mutation observer
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' || mutation.type === 'characterData') {
            const caption = parseCaption(captionContainer);
            if (!caption) continue;

            const now = Date.now();
            
            // Dedupe logic - don't send identical captions within threshold
            if (caption.text === lastCaption && 
                caption.speaker === lastSpeaker && 
                (now - lastCaptionTime) < DEDUPE_THRESHOLD_MS) {
              continue;
            }

            // Update tracking
            lastCaption = caption.text;
            lastSpeaker = caption.speaker;
            lastCaptionTime = now;

            // Send to Node.js via exposed function
            if (typeof window.onCaption === 'function') {
              window.onCaption(caption.speaker, caption.text);
            }
          }
        }
      });

      observer.observe(captionContainer, {
        childList: true,
        subtree: true,
        characterData: true
      });

      console.log('[CaptionScraper] MutationObserver started');
    })();
  `;
}

/**
 * Segment manager for buffering and managing caption segments
 */
export class SegmentManager {
    private segments: Segment[] = [];
    private activeSegments: Map<string, Segment> = new Map();
    private segmentIndex = 0;
    private startTime: number;
    private flushedCount = 0;

    constructor() {
        this.startTime = Date.now();
    }

    /**
     * Process incoming caption and update segments
     */
    addCaption(speaker: string, text: string): void {
        const now = Date.now();
        const elapsed = (now - this.startTime) / 1000; // seconds

        const activeSegment = this.activeSegments.get(speaker);

        if (activeSegment) {
            // Update existing segment for this speaker
            activeSegment.text = text;
            activeSegment.end = elapsed;
        } else {
            // Create new segment for this speaker
            const segment: Segment = {
                speaker,
                text,
                start: elapsed,
                end: elapsed,
            };
            this.activeSegments.set(speaker, segment);
        }
    }

    /**
     * Finalize active segment for a speaker (when they stop talking)
     */
    finalizeSegment(speaker: string): Segment | null {
        const segment = this.activeSegments.get(speaker);
        if (segment) {
            this.segments.push({ ...segment });
            this.activeSegments.delete(speaker);
            return segment;
        }
        return null;
    }

    /**
     * Get segments ready for flushing (finalized + active snapshots)
     */
    getSegmentsForFlush(): Segment[] {
        const toFlush = [
            ...this.segments.slice(this.flushedCount),
            ...Array.from(this.activeSegments.values()),
        ];
        return toFlush;
    }

    /**
     * Mark segments as flushed
     */
    markFlushed(): void {
        // Move active segments to finalized
        for (const [speaker, segment] of this.activeSegments.entries()) {
            this.segments.push({ ...segment });
        }
        this.flushedCount = this.segments.length;
        this.activeSegments.clear();
    }

    /**
     * Get all segments (finalized + active)
     */
    getAllSegments(): Segment[] {
        return [
            ...this.segments,
            ...Array.from(this.activeSegments.values()),
        ];
    }

    /**
     * Get total segment count
     */
    getCount(): number {
        return this.segments.length + this.activeSegments.size;
    }

    /**
     * Get duration in seconds
     */
    getDuration(): number {
        return (Date.now() - this.startTime) / 1000;
    }
}
