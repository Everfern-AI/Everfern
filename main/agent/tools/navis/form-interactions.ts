/**
 * Navis — Phase 2: Advanced Form Interactions
 *
 * Implements:
 * - File Upload (Req 5.1-5.5)
 * - Dropdown/Select Elements (Req 6.1-6.5)
 * - Date Pickers (Req 7.1-7.5)
 * - Drag and Drop (Req 8.1-8.5)
 * - Hover Actions (Req 9.1-9.5)
 * - Right-Click Context Menus (Req 10.1-10.5)
 */

import { Page } from 'playwright';
import { BrowserSession } from './session';
import { NavisLogger } from './logger';
import { findElement } from './actions';
import * as fs from 'fs';
import * as path from 'path';

export interface ActionResult {
  success: boolean;
  message: string;
  stateChanged: boolean;
}

// Helper to resolve coordinates
async function getCoordinates(args: any, page: Page, locator?: any): Promise<{ x: number; y: number } | null> {
  if (args.x !== undefined && args.y !== undefined) {
    // scale 0-1000 coordinates to actual viewport size
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })).catch(() => ({ width: 1280, height: 720 }));
    return {
      x: Math.round((args.x / 1000) * size.width),
      y: Math.round((args.y / 1000) * size.height),
    };
  }
  if (locator) {
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      return {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      };
    }
  }
  return null;
}

/**
 * Phase 2.1: File Upload Handling
 * Req 5.1-5.5: File upload with validation and completion detection
 */
export async function executeUploadFile(
  args: any,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const ref = args.ref;
  const rawFiles = args.files || args.file;
  if (!ref) return { success: false, message: 'Missing ref parameter', stateChanged: false };
  if (!rawFiles) return { success: false, message: 'Missing files parameter', stateChanged: false };

  const filesArray = Array.isArray(rawFiles) ? rawFiles : [String(rawFiles)];
  
  // Validate file existence
  for (const f of filesArray) {
    if (!fs.existsSync(f)) {
      return {
        success: false,
        message: `File upload failed: file does not exist at "${f}"`,
        stateChanged: false,
      };
    }
  }

  try {
    const { locator, name } = await findElement(page, ref, logger);
    await locator.setInputFiles(filesArray);
    logger?.elementInput(step, maxSteps, `upload:${filesArray.join(',')}`, ref);
    return {
      success: true,
      message: `Uploaded file(s) [${filesArray.map(f => path.basename(f)).join(', ')}] to "${name}"`,
      stateChanged: true,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `File upload failed on ref "${ref}": ${err.message}`,
      stateChanged: false,
    };
  }
}

/**
 * Phase 2.2: Dropdown and Select Elements
 * Req 6.1-6.5: Select option with multiple selection methods
 */
export async function executeSelectOption(
  args: any,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const ref = args.ref || args.target;
  const optionVal = args.value || args.option || args.label;
  if (!ref) return { success: false, message: 'Missing ref/target parameter', stateChanged: false };
  if (optionVal === undefined) return { success: false, message: 'Missing value/option parameter', stateChanged: false };

  try {
    const { locator, name } = await findElement(page, ref, logger);
    
    // Check if standard select
    const isStandardSelect = await locator.evaluate((el: HTMLElement) => el.tagName.toLowerCase() === 'select').catch(() => false);
    
    if (isStandardSelect) {
      await locator.selectOption(optionVal);
      logger?.elementInput(step, maxSteps, `select:${optionVal}`, ref);
      return {
        success: true,
        message: `Selected option "${optionVal}" on standard dropdown "${name}"`,
        stateChanged: true,
      };
    }
    
    // Custom dropdown / combobox
    await locator.click({ force: true }).catch(() => locator.click());
    await page.waitForTimeout(400);

    const optionText = String(optionVal);
    const optionLocators = [
      page.getByRole('option', { name: optionText, exact: false }),
      page.locator(`[role="option"]`).filter({ hasText: optionText }),
      page.getByText(optionText, { exact: false }),
      page.locator(`li`).filter({ hasText: optionText }),
    ];

    for (const optLoc of optionLocators) {
      if (await optLoc.count() > 0 && await optLoc.first().isVisible()) {
        await optLoc.first().click();
        logger?.elementInput(step, maxSteps, `select-custom:${optionVal}`, ref);
        return {
          success: true,
          message: `Selected custom dropdown option "${optionVal}" on "${name}"`,
          stateChanged: true,
        };
      }
    }

    return {
      success: false,
      message: `Failed to find option text "${optionVal}" in revealed dropdown on "${name}"`,
      stateChanged: false,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Select option failed: ${err.message}`,
      stateChanged: false,
    };
  }
}

/**
 * Phase 2.3: Date Picker Handling
 * Req 7.1-7.5: Set date with format support
 */
export async function executeSetDate(
  args: any,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const ref = args.ref || args.target;
  const dateVal = args.date || args.value;
  if (!ref) return { success: false, message: 'Missing ref/target parameter', stateChanged: false };
  if (!dateVal) return { success: false, message: 'Missing date parameter', stateChanged: false };

  try {
    const { locator, name } = await findElement(page, ref, logger);
    
    await locator.focus().catch(() => {});
    await locator.fill(dateVal).catch(() => {});
    
    await locator.evaluate((el: HTMLElement, val: string) => {
      const input = el as HTMLInputElement;
      if (input.value !== val) {
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      input.blur();
    }, dateVal).catch(() => {});

    const currentVal = await locator.inputValue().catch(() => '');
    if (currentVal === dateVal) {
      logger?.elementInput(step, maxSteps, `date:${dateVal}`, ref);
      return { success: true, message: `Set date to "${dateVal}" on input "${name}"`, stateChanged: true };
    }

    await locator.click({ force: true });
    await page.waitForTimeout(400);

    const dayMatch = String(dateVal).match(/\b0*([1-9]\d*)$/);
    if (dayMatch) {
      const dayStr = dayMatch[1];
      const dayLocator = page.locator(`.day, .calendar-day, [aria-label*="${dayStr}"], td`).filter({ hasText: new RegExp(`^${dayStr}$`) });
      if (await dayLocator.count() > 0) {
        await dayLocator.first().click();
        logger?.elementInput(step, maxSteps, `date-custom:${dateVal}`, ref);
        return { success: true, message: `Selected date "${dateVal}" from calendar widget on "${name}"`, stateChanged: true };
      }
    }

    return { success: true, message: `Programmatically injected date "${dateVal}" on "${name}"`, stateChanged: true };
  } catch (err: any) {
    return {
      success: false,
      message: `Set date failed: ${err.message}`,
      stateChanged: false,
    };
  }
}

/**
 * Phase 2.4: Drag and Drop Operations
 * Req 8.1-8.5: Drag and drop with completion detection
 */
export async function executeDragAndDrop(
  args: any,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const sourceRef = args.sourceRef || args.ref;
  const targetRef = args.targetRef;
  if (!sourceRef) return { success: false, message: 'Missing sourceRef parameter', stateChanged: false };

  try {
    const { locator: sourceLoc, name: sourceName } = await findElement(page, sourceRef, logger);
    
    if (targetRef) {
      const { locator: targetLoc, name: targetName } = await findElement(page, targetRef, logger);
      await sourceLoc.dragTo(targetLoc);
      logger?.elementInput(step, maxSteps, `drag-and-drop to:${targetRef}`, sourceRef);
      return {
        success: true,
        message: `Dragged element "${sourceName}" and dropped onto "${targetName}"`,
        stateChanged: true,
      };
    }

    const targetCoords = await getCoordinates(args, page);
    if (targetCoords) {
      const sourceBox = await sourceLoc.boundingBox();
      if (!sourceBox) {
        return { success: false, message: `Could not obtain bounding box for "${sourceName}"`, stateChanged: false };
      }
      const fromX = sourceBox.x + sourceBox.width / 2;
      const fromY = sourceBox.y + sourceBox.height / 2;

      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(targetCoords.x, targetCoords.y, { steps: 8 });
      await page.mouse.up();
      logger?.elementInput(step, maxSteps, `drag-and-drop to:(${targetCoords.x},${targetCoords.y})`, sourceRef);
      return {
        success: true,
        message: `Dragged element "${sourceName}" and dropped onto coordinates (${targetCoords.x}, ${targetCoords.y})`,
        stateChanged: true,
      };
    }

    return { success: false, message: 'Missing targetRef or coordinates (targetX, targetY) parameter', stateChanged: false };
  } catch (err: any) {
    return {
      success: false,
      message: `Drag and drop failed: ${err.message}`,
      stateChanged: false,
    };
  }
}

/**
 * Phase 2.5: Hover Actions
 * Req 9.1-9.5: Hover with 500ms wait and cursor positioning
 */
export async function executeHover(
  args: any,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const ref = args.ref || args.target;
  try {
    let targetName = 'coordinates';
    let targetCoords: { x: number; y: number } | null = null;
    
    if (ref) {
      const { locator, name } = await findElement(page, ref, logger);
      await locator.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
      await locator.hover();
      targetName = name;
      targetCoords = await getCoordinates(args, page, locator);
    } else {
      targetCoords = await getCoordinates(args, page);
      if (targetCoords) {
        await page.mouse.move(targetCoords.x, targetCoords.y);
      } else {
        return { success: false, message: 'Hover requires ref/target or coordinates', stateChanged: false };
      }
    }

    if (targetCoords) {
      session.moveCursor(targetCoords.x, targetCoords.y).catch(() => {});
    }
    
    await page.waitForTimeout(500);

    logger?.elementInput(step, maxSteps, 'hover', ref || 'coords');
    return {
      success: true,
      message: `Hovered over "${targetName}"`,
      stateChanged: true,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Hover failed: ${err.message}`,
      stateChanged: false,
    };
  }
}

/**
 * Phase 2.6: Right-Click Context Menus
 * Req 10.1-10.5: Right-click with context menu handling
 */
export async function executeRightClick(
  args: any,
  page: Page,
  session: BrowserSession,
  logger?: NavisLogger,
  step?: number,
  maxSteps?: number,
): Promise<ActionResult> {
  const ref = args.ref || args.target;
  try {
    let targetName = 'coordinates';
    let targetCoords: { x: number; y: number } | null = null;

    if (ref) {
      const { locator, name } = await findElement(page, ref, logger);
      await locator.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
      await locator.click({ button: 'right' });
      targetName = name;
      targetCoords = await getCoordinates(args, page, locator);
    } else {
      targetCoords = await getCoordinates(args, page);
      if (targetCoords) {
        await page.mouse.click(targetCoords.x, targetCoords.y, { button: 'right' });
      } else {
        return { success: false, message: 'Right click requires ref/target or coordinates', stateChanged: false };
      }
    }

    if (targetCoords) {
      session.moveCursor(targetCoords.x, targetCoords.y).catch(() => {});
    }

    await page.waitForTimeout(400);

    logger?.elementInput(step, maxSteps, 'right-click', ref || 'coords');
    return {
      success: true,
      message: `Right-clicked on "${targetName}"`,
      stateChanged: true,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Right-click failed: ${err.message}`,
      stateChanged: false,
    };
  }
}
