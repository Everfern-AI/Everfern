"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const fs = __importStar(require("fs"));
const screenshot = require('screenshot-desktop');
let sharp = null;
try {
    sharp = require('sharp');
}
catch { }
/**
 * Worker to perform screenshot capture and image processing (resize/encode)
 * off the main thread to prevent UI freezing.
 */
async function run() {
    const { outPath, monitorIndex, imageQuality, imageMaxPixels, imageMinPixels, imageScaleFactor } = worker_threads_1.workerData;
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
        }
        else {
            // No sharp - just encode the raw PNG as base64 (no resize)
            encoded = imgBuffer.toString("base64");
        }
        worker_threads_1.parentPort?.postMessage({
            success: true,
            data: { encoded, width, height, newW, newH }
        });
    }
    catch (err) {
        worker_threads_1.parentPort?.postMessage({
            success: false,
            error: err instanceof Error ? err.message : String(err)
        });
    }
}
run();
