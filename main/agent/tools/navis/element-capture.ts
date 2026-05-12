/**
 * Navis — Element Capture Engine
 * 
 * Uses Playwright's built-in ariaSnapshot() for AI-optimized accessibility tree.
 * Every interactive element gets a stable ref (e1, e2, ...) for precise interaction.
 * https://playwright.dev/docs/aria-snapshots
 */

import { Page } from 'playwright';

export interface AriaSnapshotResult {
  raw: string;
  refs: Map<string, { role: string; name: string }>;
}

// ── Fast Snapshot (Viewport-Aware) ─────────────────────────
export async function captureFastSnapshot(page: Page): Promise<AriaSnapshotResult | null> {
  try {
    const snapshot = await page.evaluate(() => {
      const vWidth = window.innerWidth;
      const vHeight = window.innerHeight;

      // Select interactive elements + semantic context
      const selector = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"], h1, h2, h3, h4, h5, h6, [role="heading"]';
      const elements = document.querySelectorAll(selector);
      
      let ref = 0;
      let result = '';
      
      elements.forEach((el: Element) => {
        const rect = el.getBoundingClientRect();
        
        // Viewport filtering: include elements in viewport + 500px buffer for context
        const isInViewport = (
          rect.top < vHeight + 500 &&
          rect.bottom > -500 &&
          rect.left < vWidth + 200 &&
          rect.right > -200
        );

        if (!isInViewport) return;

        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const isInteractive = ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) || 
                             ['button', 'link', 'textbox', 'combobox'].includes(el.getAttribute('role') || '');
        
        let name = el.getAttribute('aria-label') || 
                   (el as HTMLElement).innerText?.trim().slice(0, 100) || 
                   el.getAttribute('placeholder') || 
                   el.getAttribute('title') ||
                   '';

        // Clean up name (remove extra whitespace/newlines)
        name = name.replace(/\s+/g, ' ').trim();
        if (!name && !isInteractive) return; // Skip empty non-interactive elements

        if (isInteractive) {
          ref++;
          el.setAttribute('data-ref', `e${ref}`);
          result += `- ${role} "${name}" [ref=e${ref}]\n`;
        } else {
          // Contextual heading/text
          result += `- ${role} "${name}"\n`;
        }
      });
      return result;
    });
    
    if (!snapshot || snapshot.length === 0) return null;
    
    const refs = parseRefs(snapshot);
    return { raw: snapshot, refs };
  } catch (err) {
    console.warn('[Navis] Fast snapshot failed:', err);
    return null;
  }
}

export async function captureInteractiveElements(page: Page): Promise<AriaSnapshotResult> {
  // Try fast method first (in-browser DOM query, very fast)
  const fastResult = await captureFastSnapshot(page);
  
  // If fast method didn't find much, or we want high-fidelity reasoning
  // we fallback to Playwright's native AI-powered aria snapshot.
  try {
    const raw = await page.ariaSnapshot({ 
      timeout: 5000 
    });
    
    // Merge or pick the best. Usually, ariaSnapshot is much better for semantic roles.
    if (raw && raw.length > (fastResult?.raw.length || 0)) {
      const refs = parseRefs(raw);
      return { raw, refs };
    }
  } catch (err) {
    console.warn('[Navis] ariaSnapshot failed, using fast result or empty:', err);
  }

  return fastResult || { 
    raw: `- ${await page.title().catch(() => 'page')} "no interactive elements found" [ref=e1]`, 
    refs: new Map([['e1', { role: 'heading', name: 'no interactive elements found' }]]) 
  };
}

export function parseRefs(snapshot: string): Map<string, { role: string; name: string }> {
  const refs = new Map<string, { role: string; name: string }>();
  const refRegex = /\[ref=([^\]]+)\]/g;
  const lines = snapshot.split('\n');
  
  for (const line of lines) {
    const match = line.match(refRegex);
    if (!match) continue;
    
    for (const refMatch of match) {
      const ref = refMatch.slice(5, -1);
      const roleMatch = line.match(/^\s*-\s*(\w+)/);
      const nameMatch = line.match(/"([^"]*)"/);
      
      refs.set(ref, {
        role: roleMatch ? roleMatch[1] : 'unknown',
        name: nameMatch ? nameMatch[1] : '',
      });
    }
  }
  
  return refs;
}

export function formatElementsForPrompt(snapshot: string): string {
  return snapshot;
}
