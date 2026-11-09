const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:3001/chat', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(e => console.log('goto', e.message));
  await p.waitForTimeout(7000);
  const info = await p.evaluate(() => {
    const bubbles = [...document.querySelectorAll('[id^="user-msg-bubble-"]')];
    return bubbles.map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const parent = el.parentElement;
      const pr = parent.getBoundingClientRect();
      const pcs = getComputedStyle(parent);
      const gp = parent.parentElement;
      const gpr = gp.getBoundingClientRect();
      const gpcs = getComputedStyle(gp);
      return {
        text: (el.innerText||'').slice(0,40),
        rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
        vw: window.innerWidth,
        centerDelta: Math.round((r.x + r.width/2) - window.innerWidth/2),
        css: {background: cs.background.slice(0,140), backdropFilter: cs.backdropFilter, borderRadius: cs.borderRadius, maxWidth: cs.maxWidth, width: cs.width, margin: cs.margin},
        parent: {rect: {x: Math.round(pr.x), w: Math.round(pr.width)}, alignItems: pcs.alignItems, display: pcs.display, flexDirection: pcs.flexDirection},
        grandparent: {rect: {x: Math.round(gpr.x), w: Math.round(gpr.width)}, alignItems: gpcs.alignItems, display: gpcs.display, flexDirection: gpcs.flexDirection, padding: gpcs.padding},
        dark: !!el.closest('.dark'),
        htmlDark: document.documentElement.classList.contains('dark'),
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  await p.screenshot({ path: 'C:\\Users\\srini\\AppData\\Local\\Temp\\opencode\\chat-layout.png' }).catch(()=>{});
  await b.close();
})();
