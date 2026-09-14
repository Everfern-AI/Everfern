import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Electron Blank Window Bug Condition', () => {
  it('Property 1: Bug Condition - createWindow NOT called in app.whenReady() on unfixed code', () => {
    // Static analysis test: verify that createWindow() is NOT called inside app.whenReady() in main/main.ts
    // This test MUST FAIL on unfixed code (proving the bug exists)
    // After the fix, this test will PASS

    const mainFilePath = path.join(__dirname, '../../../../main.ts');
    const mainContent = fs.readFileSync(mainFilePath, 'utf-8');

    // Extract the app.whenReady().then(...) block
    const whenReadyMatch = mainContent.match(
      /app\.whenReady\(\)\.then\(\(\)\s*=>\s*\{[\s\S]*?\n\}\);/
    );

    expect(
      whenReadyMatch,
      'app.whenReady().then(...) block should exist in main.ts'
    ).toBeTruthy();

    if (!whenReadyMatch) return;

    const whenReadyBlock = whenReadyMatch[0];

    // Check if createWindow() is called inside the whenReady block
    // Look for patterns like:
    // - createWindow();
    // - createWindow( );
    // - await createWindow();
    const createWindowCalled = /createWindow\s*\(\s*\)/.test(whenReadyBlock);

    // EXPECTED OUTCOME: This assertion FAILS on unfixed code
    // Counterexample: "createWindow() is not called inside app.whenReady() in main/main.ts"
    expect(
      createWindowCalled,
      'COUNTEREXAMPLE: createWindow() is NOT called inside app.whenReady() — mainWindow will remain null in production mode'
    ).toBe(true);
  });

  it('Property 1: Bug Condition - mainWindow initialization check', () => {
    // Verify that mainWindow is created inside createWindow() which is called from whenReady
    const mainFilePath = path.join(__dirname, '../../../../main.ts');
    const mainContent = fs.readFileSync(mainFilePath, 'utf-8');

    // Check that mainWindow is declared as null
    const mainWindowDeclared = /let\s+mainWindow:\s*BrowserWindow\s*\|\s*null\s*=\s*null/.test(
      mainContent
    );
    expect(mainWindowDeclared, 'mainWindow should be declared as null').toBe(true);

    // Extract the whenReady block
    const whenReadyMatch = mainContent.match(
      /app\.whenReady\(\)\.then\(\(\)\s*=>\s*\{[\s\S]*?\n\}\);/
    );

    if (!whenReadyMatch) return;

    const whenReadyBlock = whenReadyMatch[0];

    // Check that createWindow() IS called inside whenReady (the fix)
    const createWindowCalledInWhenReady = /createWindow\s*\(\s*\)/.test(
      whenReadyBlock
    );

    expect(
      createWindowCalledInWhenReady,
      'createWindow() MUST be called inside app.whenReady() after the fix'
    ).toBe(true);
  });
});
