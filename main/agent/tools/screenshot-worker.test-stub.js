// Stub screenshot-worker.js for testing purposes
// The real implementation is in screenshot-worker.ts (compiled to dist-electron)
// This stub allows tests to run without the compiled JS file

const { parentPort, workerData } = require('worker_threads');

// Immediately respond with fake screenshot data for testing
if (parentPort) {
  parentPort.postMessage({
    success: true,
    data: {
      encoded: 'ZmFrZS1zY3JlZW5zaG90', // base64 of 'fake-screenshot'
      width: 1920,
      height: 1080,
      newW: 1280,
      newH: 720,
    }
  });
}
