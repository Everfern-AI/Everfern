#!/usr/bin/env node
/**
 * electron-builder afterSign hook (macOS).
 *
 * Fixes grey-screen-at-launch crashes in ad-hoc signed builds (i.e. builds
 * produced without a Developer ID certificate — the default for OSS CI).
 *
 * Root cause:
 *   electron-builder re-signs the bundle ad-hoc but preserves the
 *   hardened-runtime (`--options runtime`) flag that ships on the stock
 *   Electron binaries. Hardened runtime turns on library validation, which
 *   requires the loading process and the mapped library to share a Team ID.
 *   Two independently ad-hoc-signed binaries never share one, so every
 *   helper process dies at dyld:
 *
 *     dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
 *       Reason: code signature ... not valid for use in process:
 *       mapping process and mapped file (non-platform) have different Team IDs
 *     FATAL:gpu_data_manager_impl_private.cc] GPU process isn't usable. Goodbye.
 *
 *   Result: window opens grey, then the app quits. Dev mode is unaffected
 *   because `electron .` runs the stock Developer-ID-signed binaries.
 *
 * Fix:
 *   After electron-builder signs, walk the bundle deepest-first and re-sign
 *   every ad-hoc component WITHOUT the hardened-runtime flag. Without the
 *   runtime flag, library validation is not enforced and helpers load the
 *   framework normally. If anything inside the bundle was repaired, the
 *   outermost bundle is re-signed last so its CodeResources seal stays
 *   consistent with the modified contents.
 *
 * Builds signed with a real certificate (CSC_LINK / CSC_NAME set, or the
 * resulting signature is not ad-hoc) are detected and left untouched.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Run a command and resolve with { err, out } instead of throwing.
 *
 * @param {string} cmd - Executable to run.
 * @param {string[]} args - Argument list for the executable.
 * @returns {Promise<{err: Error|null, out: string}>} Combined stdout/stderr
 *   and an error object when the command failed.
 */
function sh(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) =>
      resolve({ err, out: `${stdout || ''}${stderr || ''}` })
    );
  });
}

/**
 * Inspect a code-signed target's signature flags.
 *
 * @param {string} target - Path to a Mach-O binary, framework, or app bundle.
 * @returns {Promise<{adhoc: boolean, runtime: boolean}>} Whether the target
 *   is ad-hoc signed and whether the hardened-runtime flag is set.
 */
async function codesignDetails(target) {
  const { out } = await sh('codesign', ['-dv', target]);
  const flagsLine =
    (out.match(/^CodeDirectory.*?flags=0x[0-9a-fA-F]+\(([^)]*)\)/m) || [])[1] || '';
  return {
    adhoc: /\badhoc\b/.test(flagsLine) || /^Signature=adhoc$/m.test(out),
    runtime: /\bruntime\b/.test(flagsLine),
  };
}

/**
 * Collect every nested bundle inside an .app that may need re-signing.
 *
 * Walks Contents/Frameworks, Contents/Plugins and Contents (depth-limited),
 * gathering .framework and .app bundles without descending into them (each
 * nested bundle is re-signed as a unit).
 *
 * @param {string} appBundle - Path to the outer .app bundle.
 * @returns {Promise<string[]>} Bundle paths sorted deepest-first, so outer
 *   bundles are always (re-)sealed after their contents change.
 */
async function findTargets(appBundle) {
  const contents = path.join(appBundle, 'Contents');
  const roots = [path.join(contents, 'Frameworks'), path.join(contents, 'Plugins'), contents];
  const found = [];

  /**
   * Recurse into a directory collecting nested bundle paths.
   *
   * @param {string} dir - Directory to scan.
   * @param {number} depth - Current recursion depth (hard limit 6).
   * @returns {Promise<void>} Resolves when the directory has been scanned.
   */
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.framework') || entry.name.endsWith('.app')) {
          found.push(full);
          continue; // don't descend into nested bundles; they get re-signed whole
        }
        await walk(full, depth + 1);
      }
    }
  }

  for (const root of roots) await walk(root, 0);

  // Deepest paths first so outer bundles are sealed after their contents.
  return [...new Set(found)].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

/**
 * electron-builder afterSign hook entry point.
 *
 * Re-signs ad-hoc hardened-runtime components without the runtime flag and
 * re-seals the outer bundle if any nested component changed. Skips entirely
 * on non-macOS builds and whenever a real signing identity is configured.
 *
 * @param {object} context - electron-builder hook context (appOutDir,
 *   electronPlatformName, packager, etc.).
 * @returns {Promise<void>} Resolves once the bundle is consistent; rejects
 *   if a required re-sign fails.
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // Never touch builds signed with a real certificate.
  if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.MAC_CERTS_P12) {
    console.log('[after-sign-mac] Signing identity configured — skipping ad-hoc repair.');
    return;
  }

  const outDir = context.appOutDir;
  const productName = context.packager?.appInfo?.productFilename;
  let appBundle;
  try {
    const candidates = fs
      .readdirSync(outDir)
      .filter((f) => f.endsWith('.app'))
      .sort((a, b) => {
        // Prefer the bundle electron-builder just produced.
        if (productName) {
          const aMatch = a === `${productName}.app` ? -1 : 0;
          const bMatch = b === `${productName}.app` ? -1 : 0;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        return a.localeCompare(b);
      })
      .map((f) => path.join(outDir, f));
    appBundle = candidates[0];
    if (productName && candidates.length > 1) {
      console.warn(
        `[after-sign-mac] Multiple .app bundles in ${outDir}; repairing "${path.basename(appBundle)}".`
      );
    }
  } catch {
    appBundle = undefined;
  }
  if (!appBundle) {
    console.warn(`[after-sign-mac] No .app found in ${outDir} — nothing to do.`);
    return;
  }

  // Deepest-first, with the outermost bundle handled last (see below).
  const targets = [...(await findTargets(appBundle)), appBundle];

  let repaired = 0;
  for (const target of targets) {
    const { adhoc, runtime } = await codesignDetails(target);
    if (adhoc && runtime) {
      const rel = path.relative(outDir, target);
      // Plain ad-hoc re-sign drops the hardened-runtime flag (and its
      // entitlement requirements, which are meaningless without it).
      const { err } = await sh('codesign', ['--force', '--sign', '-', target]);
      if (err) {
        console.error(`[after-sign-mac] Failed to re-sign ${rel}: ${err.message}`);
        throw err;
      }
      repaired++;
      console.log(`[after-sign-mac] Stripped hardened runtime from ${rel}`);
    } else if (!adhoc) {
      console.log(
        `[after-sign-mac] ${path.relative(outDir, target)} is certificate-signed — leaving as-is.`
      );
    }
  }

  // Re-signing a nested bundle invalidates the outer bundle's CodeResources
  // seal, so the outermost bundle must always be re-sealed after any nested
  // repair — even when its own signature didn't need the runtime flag
  // stripped. Plain ad-hoc signing is idempotent, so this is safe to run
  // unconditionally after a repair.
  if (repaired > 0) {
    const { err } = await sh('codesign', ['--force', '--sign', '-', appBundle]);
    if (err) {
      console.error(`[after-sign-mac] Failed to re-seal outer bundle: ${err.message}`);
      throw err;
    }
    console.log('[after-sign-mac] Re-sealed outer app bundle signature.');
  }

  if (repaired === 0) console.log('[after-sign-mac] No ad-hoc hardened-runtime binaries found.');
  else console.log(`[after-sign-mac] Repaired ${repaired} component(s); library validation off.`);
};
