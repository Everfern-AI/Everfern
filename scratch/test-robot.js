try {
  const robot = require('@jitsi/robotjs');
  console.log('robotjs loaded successfully!');
  console.log('Screen size:', robot.getScreenSize());
} catch (e) {
  console.error('Failed to load robotjs:', e);
}

try {
  const sharp = require('sharp');
  console.log('sharp loaded successfully!');
} catch (e) {
  console.error('Failed to load sharp:', e);
}
