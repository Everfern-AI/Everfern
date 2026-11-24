import { describe, expect, it } from "vitest";
import { pillSide, shortLabel } from "../native-cursor";
import { screenFrame, pageFrame, VIEW } from "../../../../main/agent/tools/navis/core/page-driver";

// The cloud Browser window shows the VM's whole screen: a click in the page sits below Chrome's
// tabs, address bar and warning bar, so it must be placed on the screen, not the page.
describe("AI cursor placement", () => {
  it("puts a page point below the browser toolbars on the VM screen", () => {
    const p = { x: 200, y: 300, w: 1280, h: 600 };
    const s = { left: 0, top: 120, sw: 1280, sh: 720 };
    const onScreen = screenFrame(p, s);
    expect(onScreen.y / VIEW.h).toBeCloseTo((120 + 300) / 720, 2);
    expect(onScreen.aspect).toBeCloseTo(1280 / 720);
    // The page-only frame would put it well above the real spot.
    expect(pageFrame(p).y).toBeLessThan(onScreen.y);
  });

  it("keeps the pill inside the window", () => {
    expect(pillSide(100, 800)).toEqual({ flip: false, room: 668 });
    const nearRight = pillSide(700, 800);
    expect(nearRight.flip).toBe(true);
    expect(nearRight.room).toBe(668);
  });

  it("shortens URLs in the pill to the site", () => {
    expect(shortLabel("Navigating to https://www.google.com/travel/flights?hl=en")).toBe("Navigating to google.com");
    expect(shortLabel('Clicked "Round trip"')).toBe('Clicked "Round trip"');
  });
});
