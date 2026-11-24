/**
 * Image work done by the Tauri shell (src-tauri/src/image_ops.rs) in place of the `sharp`
 * addon. Each call runs `everfern --ef-image` once with a batch of operations.
 * Only used under the Tauri shell; Electron builds keep using sharp.
 */
import { spawn } from "child_process";

export function hasNativeImage(): boolean {
  return process.env.EVERFERN_SHELL === "tauri" && !!process.env.EF_NATIVE_EXE;
}

/** One operation; `data` is base64 (a data: URL is fine) and `path` a file to read instead. */
export type ImageOp =
  | { op: "meta"; data?: string; path?: string }
  | { op: "thumb"; data?: string; path?: string; width: number; height: number }
  | { op: "svg"; svg: string; fast?: boolean }
  | { op: "jpeg"; data?: string; path?: string; quality?: number };

export interface ImageResult {
  width?: number;
  height?: number;
  format?: string;
  /** Base64 PNG (thumb, svg). */
  png?: string;
  /** Base64 JPEG (jpeg). */
  jpeg?: string;
  /** Set when this one operation failed; the others in the batch still ran. */
  error?: string;
}

export function runImageOps(ops: ImageOp[]): Promise<ImageResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.EF_NATIVE_EXE!, ["--ef-image"], { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const reason = Buffer.concat(err).toString().trim() || `exit code ${code}`;
        return reject(new Error(`Native image failed: ${reason}`));
      }
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(ops));
  });
}

async function single(op: ImageOp): Promise<ImageResult> {
  const [result] = await runImageOps([op]);
  if (!result || result.error) throw new Error(result?.error || "Native image returned nothing");
  return result;
}

export async function nativeImageSize(base64: string): Promise<{ width: number; height: number }> {
  const { width, height } = await single({ op: "meta", data: base64 });
  return { width: width!, height: height! };
}

/** PNG of an SVG document, flattened onto white. */
export async function nativeSvgToPng(svg: string): Promise<Buffer> {
  return Buffer.from((await single({ op: "svg", svg })).png!, "base64");
}

/** JPEG of an image file. */
export async function nativeJpeg(path: string, quality: number): Promise<Buffer> {
  return Buffer.from((await single({ op: "jpeg", path, quality })).jpeg!, "base64");
}
