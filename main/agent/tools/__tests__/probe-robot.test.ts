import { describe, it, expect, vi } from 'vitest';
const { robotMouseToggle } = vi.hoisted(() => ({ robotMouseToggle: vi.fn() }));
vi.mock('@jitsi/robotjs', () => ({ mouseToggle: robotMouseToggle, moveMouse: vi.fn(), setMouseDelay: vi.fn(), getMousePos: vi.fn(() => ({x:0,y:0})) }));
vi.mock('electron', () => ({ screen: { getAllDisplays: vi.fn(() => [{bounds:{x:0,y:0,width:1920,height:1080}}]), getPrimaryDisplay: vi.fn(() => ({bounds:{x:0,y:0,width:1920,height:1080}})) }, desktopCapturer: { getSources: vi.fn().mockResolvedValue([]) }, shell: { openExternal: vi.fn() }, dialog: { showMessageBox: vi.fn() }, BrowserWindow: { getAllWindows: vi.fn(() => []) } }));
it('probe', async () => {
  const m = require('@jitsi/robotjs');
  m.mouseToggle('down','left');
  expect(robotMouseToggle).toHaveBeenCalledWith('down','left');
});
