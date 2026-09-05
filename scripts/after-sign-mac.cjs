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
 *   After electron-builder signs, walk the bundle and re-sign every ad-hoc
 *   component WITHOUT the hardened-runtime flag, deepest bundle first
 *   (Apple TN2206 inside-out order). Nested .app, .framework, .xpc and
 *   .appex containers are all discovered, including inside other bundles.
 *   If anything inside changed, every enclosing bundle — innermost first —
 *   plus the outermost bundle is re-signed last, so each CodeResources seal
 *   stays consistent with the modified contents.
 *
 * Builds signed with a real certificate are never modified: if the outer
 * bundle is certificate-signed, the hook exits without touching anything
 * (repairing ad-hoc nested code would invalidate the certificate seal in a
 * way we cannot repair without the certificate).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Directory suffixes treated as signable nested bundles. */
const BUNDLE_SUFFIXES = ['.app', '.framework', '.xpc', '.appex'];

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
 * Inspect a code-signed target's signature.
 *
 * @param {string} target - Path to a Mach-O binary, framework, or bundle.
 * @returns {Promise<{signed: boolean, adhoc: boolean, runtime: boolean}>}
 *   `signed` is false when the target has no signature at all; `adhoc` is
 *   true for ad-hoc signatures; `runtime` reflects the hardened-runtime flag.
 */
async function codesignDetails(target) {
  const { out } = await sh('codesign', ['-dv', target]);
  const flagsLine =
    (out.match(/^CodeDirectory.*?flags=0x[0-9a-fA-F]+\(([^)]*)\)/m) || [])[1] || '';
  const signed = /^Signature=/m.test(out);
  return {
    signed,
    adhoc: /\badhoc\b/.test(flagsLine) || /^Signature=adhoc$/m.test(out),
    runtime: /\bruntime\b/.test(flagsLine),
  };
}

/**
 * Collect every nested signable bundle inside an .app.
 *
 * Recurses through the bundle tree — including inside discovered bundles —
 * gathering .app, .framework, .xpc and .appex containers, so nested XPC
 * services or app extensions inside helper apps/frameworks are found too.
 * Symlinked directories are not followed.
 *
 * @param {string} appBundle - Path to the outer .app bundle.
 * @returns {Promise<string[]>} Bundle paths sorted deepest-first, so every
 *   bundle is re-signed after its own contents (TN2206 inside-out order).
 */
async function findTargets(appBundle) {
  const found = new Set();

  /**
   * Recurse into a directory collecting nested bundle paths.
   *
   * @param {string} dir - Directory to scan.
   * @param {number} depth - Current recursion depth (hard limit 12).
   * @returns {Promise<void>} Resolves when the directory has been scanned.
   */
  async function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (BUNDLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.add(full);
      }
      // Keep recursing inside bundles too: helpers/XPC services can nest
      // arbitrarily deep (e.g. Helper.app/Contents/Frameworks/*.framework).
      await walk(full, depth + 1);
    }
  }

  await walk(path.join(appBundle, 'Contents'), 0);

  // Deepest paths first so outer bundles are sealed after their contents.
  return [...found].sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

/**
 * electron-builder afterSign hook entry point.
 *
 * Re-signs ad-hoc hardened-runtime components without the runtime flag and
 * re-seals the outer bundle if any nested component changed. Skips entirely
 * on non-macOS builds, when a signing identity is configured via CSC
 * environment variables, or when the outer bundle carries a real
 * certificate signature (modifying nested code would invalidate that
 * certificate's seal beyond repair).
 *
 * @param {object} context - electron-builder hook context (appOutDir,
 *   electronPlatformName, packager, etc.).
 * @returns {Promise<void>} Resolves once the bundle is consistent; rejects
 *   if a required re-sign fails.
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // Never touch builds signed with a real certificate. (Note: electron-builder
  // can also auto-discover a keychain identity when these are unset — the
  // outer-bundle signature check below covers that case.)
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

  const targets = await findTargets(appBundle);

  // Inspect the outer bundle BEFORE modifying anything: if it carries a real
  // certificate signature we must not change nested code (the certificate
  // seal would break and we cannot re-seal without the certificate).
  const outer = await codesignDetails(appBundle);
  if (outer.signed && !outer.adhoc) {
    console.log(
      '[after-sign-mac] Outer bundle is certificate-signed — leaving bundle untouched.'
    );
    return;
  }

  // Outermost last: it is part of the repair set when it needs flag-stripping,
  // and is re-sealed again below if any nested bundle changed.
  targets.push(appBundle);

  let repaired = 0;
  const repairedTargets = [];
  for (const target of targets) {
    const { signed, adhoc, runtime } = await codesignDetails(target);
    if (signed && adhoc && runtime) {
      const rel = path.relative(outDir, target);
      // Plain ad-hoc re-sign drops the hardened-runtime flag (and its
      // entitlement requirements, which are meaningless without it).
      const { err } = await sh('codesign', ['--force', '--sign', '-', target]);
      if (err) {
        console.error(`[after-sign-mac] Failed to re-sign ${rel}: ${err.message}`);
        throw err;
      }
      repaired++;
      repairedTargets.push(target);
      console.log(`[after-sign-mac] Stripped hardened runtime from ${rel}`);
    } else if (signed && !adhoc) {
      console.log(
        `[after-sign-mac] ${path.relative(outDir, target)} is certificate-signed — leaving as-is.`
      );
    }
  }

  // Re-signing any nested bundle invalidates the CodeResources seal of every
  // bundle that encloses it — not just the outermost app. Re-seal all
  // ancestor bundles of repaired targets, innermost first, then the outer
  // app bundle itself. Plain ad-hoc signing is idempotent, so re-sealing a
  // bundle that was already repaired in the loop above is safe.
  if (repaired > 0) {
    const toReseal = new Set();
    for (const target of repairedTargets) {
      let dir = path.dirname(target);
      while (dir.length >= appBundle.length && dir !== appBundle) {
        if (BUNDLE_SUFFIXES.some((suffix) => path.basename(dir).endsWith(suffix))) {
          toReseal.add(dir);
        }
        dir = path.dirname(dir);
      }
    }
    const ancestors = [...toReseal].sort(
      (a, b) => b.split(path.sep).length - a.split(path.sep).length
    );
    for (const bundle of ancestors) {
      const { signed, adhoc } = await codesignDetails(bundle);
      if (signed && !adhoc) {
        console.warn(
          `[after-sign-mac] ⚠️  ${path.relative(outDir, bundle)} is certificate-signed but its ` +
            'contents changed — it cannot be re-sealed without the certificate.'
        );
        continue;
      }
      const rel = path.relative(outDir, bundle);
      const { err } = await sh('codesign', ['--force', '--sign', '-', bundle]);
      if (err) {
        console.error(`[after-sign-mac] Failed to re-seal ${rel}: ${err.message}`);
        throw err;
      }
      console.log(`[after-sign-mac] Re-sealed ${rel}`);
    }

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
