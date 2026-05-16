import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
const screenshot = require('screenshot-desktop');
let sharp: any = null;
try { sharp = require('sharp'); } catch {}

/**
 * Worker to perform screenshot capture and image processing (resize/encode)
 * off the main thread to prevent UI freezing.
 */
async function run() {
  const { outPath, monitorIndex, imageQuality, imageMaxPixels, imageMinPixels, imageScaleFactor } = workerData;

  try {
    // 1. Capture
    const displays = await screenshot.listDisplays();
    const display = displays[monitorIndex - 1] || displays[0];
    await screenshot({ filename: outPath, screen: display.id });

    // 2. Read
    const imgBuffer = fs.readFileSync(outPath);

    // Get dimensions from PNG header (faster than sharp)
    let width = 1920, height = 1080;
    if (imgBuffer.length > 24 && imgBuffer.toString("ascii", 1, 4) === "PNG") {
       width = imgBuffer.readUInt32BE(16);
       height = imgBuffer.readUInt32BE(20);
    }

    // 3. Resize and Encode
    let encoded = "";
    let newW = width;
    let newH = height;

    if (sharp) {
      // Fast resize calculation
      const area = width * height;
      if (area > imageMinPixels) {
        const scale = Math.sqrt(Math.min(area, imageMaxPixels) / area);
        newW = Math.max(imageScaleFactor, Math.floor(width * scale / imageScaleFactor) * imageScaleFactor);
        newH = Math.max(imageScaleFactor, Math.floor(height * scale / imageScaleFactor) * imageScaleFactor);
      }

      const jpegBuffer = await sharp(imgBuffer)
        .resize(newW, newH, { fit: 'fill' })
        .jpeg({ quality: imageQuality })
        .toBuffer();
      encoded = jpegBuffer.toString("base64");
    } else {
      // No sharp - just encode the raw PNG as base64 (no resize)
      encoded = imgBuffer.toString("base64");
    }

    parentPort?.postMessage({
      success: true,
      data: { encoded, width, height, newW, newH }
    });
  } catch (err) {
    parentPort?.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

run();
