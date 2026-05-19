const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Make sure build directory exists
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

const logoPath = path.join(PUBLIC_DIR, 'images', 'logos', 'everfern-withoutbg.png');

async function generateAssets() {
  console.log('Generating premium PNG installer assets...');

  // 1. Generate Sidebar PNG (164 x 314)
  const sidebarWidth = 164;
  const sidebarHeight = 314;

  const sidebarBgSvg = `
    <svg width="${sidebarWidth}" height="${sidebarHeight}" viewBox="0 0 ${sidebarWidth} ${sidebarHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sidebarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#07221e;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#0d3932;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#165248;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#sidebarGrad)" />
    </svg>
  `;

  const sidebarTextSvg = `
    <svg width="${sidebarWidth}" height="${sidebarHeight}" viewBox="0 0 ${sidebarWidth} ${sidebarHeight}" xmlns="http://www.w3.org/2000/svg">
      <!-- Title -->
      <text x="50%" y="165" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="600" font-size="20" fill="#ffffff" text-anchor="middle" letter-spacing="1">EverFern</text>
      <!-- Subtitle -->
      <text x="50%" y="188" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="400" font-size="11" fill="#8cbab3" text-anchor="middle">Workplace AI Agent</text>
      <!-- Divider -->
      <line x1="32" y1="210" x2="132" y2="210" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1" />
      <!-- Info text -->
      <text x="50%" y="235" font-family="'Segoe UI', -apple-system, sans-serif" font-size="9" fill="#ffffff" fill-opacity="0.5" text-anchor="middle">Autonomous Assistant</text>
      <!-- Footer branding -->
      <text x="50%" y="295" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="600" font-size="8" fill="#ffffff" fill-opacity="0.3" text-anchor="middle" letter-spacing="1.5">EVERFERN.COM</text>
    </svg>
  `;

  // Scale EverFern logo to 80x80
  const sidebarLogoBuffer = await sharp(logoPath)
    .resize(80, 80, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const sidebarPngPath = path.join(BUILD_DIR, 'installerSidebar.png');
  await sharp(Buffer.from(sidebarBgSvg))
    .composite([
      { input: sidebarLogoBuffer, top: 45, left: 42 },
      { input: Buffer.from(sidebarTextSvg), top: 0, left: 0 }
    ])
    .png()
    .toFile(sidebarPngPath);

  console.log('✓ Generated installerSidebar.png');

  // 2. Generate Header PNG (150 x 57)
  const headerWidth = 150;
  const headerHeight = 57;

  // Clean subtle light gray gradient background for the header to match the title bar
  const headerBgSvg = `
    <svg width="${headerWidth}" height="${headerHeight}" viewBox="0 0 ${headerWidth} ${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#ffffff;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#f3f4f6;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#headerGrad)" />
      <line x1="0" y1="56" x2="150" y2="56" stroke="#0d3932" stroke-opacity="0.1" stroke-width="1" />
    </svg>
  `;

  // Scale EverFern logo to 38x38
  const headerLogoBuffer = await sharp(logoPath)
    .resize(38, 38, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const headerPngPath = path.join(BUILD_DIR, 'installerHeader.png');
  await sharp(Buffer.from(headerBgSvg))
    .composite([
      { input: headerLogoBuffer, top: 9, left: 102 }
    ])
    .png()
    .toFile(headerPngPath);

  console.log('✓ Generated installerHeader.png');

  // 3. Convert PNGs to BMPs using native Windows PowerShell command
  console.log('Converting PNGs to BMPs using native .NET APIs...');
  
  const sidebarBmpPath = path.join(BUILD_DIR, 'installerSidebar.bmp');
  const uninstallerSidebarBmpPath = path.join(BUILD_DIR, 'uninstallerSidebar.bmp');
  const headerBmpPath = path.join(BUILD_DIR, 'installerHeader.bmp');

  try {
    const convertToBmp = (src, dest) => {
      const srcClean = src.replace(/\\/g, '/');
      const destClean = dest.replace(/\\/g, '/');
      
      const psCommand = `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${srcClean}'); $img.Save('${destClean}', [System.Drawing.Imaging.ImageFormat]::Bmp); $img.Dispose();`;
      execSync(`powershell -NoProfile -Command "${psCommand}"`);
    };

    convertToBmp(sidebarPngPath, sidebarBmpPath);
    convertToBmp(sidebarPngPath, uninstallerSidebarBmpPath);
    convertToBmp(headerPngPath, headerBmpPath);

    console.log('✓ Successfully converted all assets to .bmp format!');

    // Cleanup intermediate PNG files
    fs.unlinkSync(sidebarPngPath);
    fs.unlinkSync(headerPngPath);
    console.log('✓ Cleaned up temporary PNG assets.');

  } catch (error) {
    console.error('Failed to convert PNG to BMP via PowerShell:', error.message);
  }
}

generateAssets();
