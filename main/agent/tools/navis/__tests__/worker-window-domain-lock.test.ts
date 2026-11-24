import { describe, it, expect, vi } from 'vitest';
import { WorkerWindowAdapter, siteOf } from '../core/worker-window-adapter';

/** A page driver that only tracks its URL. */
function fakePage(start = 'https://www.amazon.com/') {
  let url = start;
  return {
    label: 'test window',
    alive: () => true,
    url: async () => url,
    navigate: vi.fn(async (u: string) => { url = u; }),
    goTo: (u: string) => { url = u; },
  } as any;
}
const logger = { browserLaunch: () => {}, pageNavigate: () => {} } as any;

describe('siteOf', () => {
  it('reduces hosts to their site', () => {
    expect(siteOf('https://mail.google.com/mail')).toBe('google.com');
    expect(siteOf('https://www.amazon.co.uk/x')).toBe('amazon.co.uk');
    expect(siteOf('notion.so')).toBe('notion.so');
  });
});

describe('WorkerWindowAdapter domain lock', () => {
  it("refuses an agent-typed URL on another site, keeps its own site", async () => {
    const page = fakePage();
    const a = new WorkerWindowAdapter(page, logger, { app: 'amazon', home: 'https://www.amazon.com' });
    const out = await a.executeAction('go_to_url', { url: 'https://ebay.com' }, 1, 10);
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/only opens pages on amazon\.com/);
    expect(page.navigate).not.toHaveBeenCalled();
    const ok = await a.executeAction('go_to_url', { url: 'https://smile.amazon.com/orders' }, 2, 10);
    expect(ok.success).toBe(true);
  });

  it('allows a site the page itself moved to (a sign-in redirect)', async () => {
    const page = fakePage('https://www.notion.so/');
    const a = new WorkerWindowAdapter(page, logger, { app: 'notion', home: 'https://www.notion.so' });
    page.goTo('https://accounts.google.com/signin'); // the site redirected
    await a.launch({});
    const ok = await a.executeAction('go_to_url', { url: 'https://accounts.google.com/o/oauth2' }, 1, 10);
    expect(ok.success).toBe(true);
  });

  it('does not lock the browser apps', async () => {
    const page = fakePage('https://google.com');
    const a = new WorkerWindowAdapter(page, logger, { app: 'browser', home: 'https://google.com' });
    const ok = await a.executeAction('go_to_url', { url: 'https://ebay.com' }, 1, 10);
    expect(ok.success).toBe(true);
  });
});
