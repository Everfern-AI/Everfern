#!/usr/bin/env python3
"""
EverFern automatic PDF OCR engine.

Runs OCR on a PDF file and prints the recognized text to stdout so the
Electron main process can capture and forward it to the LLM.

Usage:
    python ocr_pdf.py <pdf_path> <engine> <backend>
    python ocr_pdf.py render <pdf_path> <outDir> <maxPages>

engine:  ocrmypdf | tesseract | paddleocr | paddleocr-vl
backend: auto | openvino

Output contract (single line on stdout):
    [EVERFERN_OCR|<engine>|<backend>|1]  <all recognized text>
    [EVERFERN_OCR_NO_TEXT|<engine>|<backend>|1]   (no text found)
    [EVERFERN_OCR_ERROR|...]                     (any failure)

All progress/info goes to stderr.
"""
import os
import sys
import traceback
import warnings

# Filter noisy third-party deprecation warnings
warnings.filterwarnings("ignore")

# Ensure UTF-8 output encoding across platforms (especially Windows cp1252)
if hasattr(sys.stdout, "buffer"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    import io
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


def _log(*args):
    print(*args, file=sys.stderr, flush=True)


def _emit(text):
    print(text, flush=True)


def _error(msg):
    _emit("[EVERFERN_OCR_ERROR] " + str(msg))


def _find_tesseract_binary():
    """Locate tesseract executable across standard system directories."""
    import shutil
    found = shutil.which("tesseract")
    if found:
        return found

    if sys.platform == "win32":
        candidates = [
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            os.path.expanduser(r"~\.everfern\tesseract\tesseract.exe"),
            os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
            os.path.expanduser(r"~\AppData\Local\Tesseract-OCR\tesseract.exe"),
        ]
        for c in candidates:
            if os.path.exists(c):
                tess_dir = os.path.dirname(c)
                if tess_dir not in os.environ.get("PATH", ""):
                    os.environ["PATH"] = tess_dir + os.pathsep + os.environ.get("PATH", "")
                tessdata = os.path.join(tess_dir, "tessdata")
                if os.path.exists(tessdata):
                    os.environ["TESSDATA_PREFIX"] = tessdata
                return c
    return None


def _resolve_device(backend):
    """Pick device string."""
    return "cpu"


def _extract_lines(res):
    """Pull recognized line texts from any PaddleX / PaddleOCR result structure."""
    out = []
    if res is None:
        return out

    # Dict or OCRResult object from PaddleX
    if isinstance(res, dict) or hasattr(res, "get"):
        texts = res.get("rec_texts") if hasattr(res, "get") else None
        if texts:
            for t in texts:
                s = str(t).strip()
                if s:
                    out.append(s)
            return out

    # Object attribute (e.g. res.rec_texts)
    texts = getattr(res, "rec_texts", None)
    if texts:
        for t in texts:
            s = str(t).strip()
            if s:
                out.append(s)
        return out

    # List/tuple results
    if isinstance(res, (list, tuple)):
        for item in res:
            if item is None:
                continue
            if isinstance(item, str):
                s = item.strip()
                if s:
                    out.append(s)
            elif isinstance(item, dict) or hasattr(item, "get"):
                t = item.get("rec_texts") if hasattr(item, "get") else None
                if t:
                    for s in t:
                        if str(s).strip():
                            out.append(str(s).strip())
                elif "text" in item:
                    s = str(item["text"]).strip()
                    if s:
                        out.append(s)
            elif isinstance(item, (list, tuple)):
                # Legacy paddleocr format: item is [ [points], (text, confidence) ]
                if len(item) >= 2 and isinstance(item[1], (list, tuple)) and len(item[1]) > 0:
                    s = str(item[1][0]).strip()
                    if s:
                        out.append(s)
                elif len(item) == 2 and isinstance(item[0], (list, tuple)) and isinstance(item[1], str):
                    s = str(item[1]).strip()
                    if s:
                        out.append(s)
                else:
                    # Recursive unpack
                    out.extend(_extract_lines(item))
    return out


def run_ocrmypdf(pdf_path):
    """
    Run OCRmyPDF on a PDF file.
    Extracts text using sidecar export or PyMuPDF searchable text layer.
    """
    tess_bin = _find_tesseract_binary()

    import tempfile
    temp_dir = tempfile.mkdtemp(prefix="everfern_ocrmypdf_")
    out_pdf = os.path.join(temp_dir, "ocr_output.pdf")
    sidecar_txt = os.path.join(temp_dir, "ocr_sidecar.txt")

    try:
        _log(f"[OCR] Running OCRmyPDF on {os.path.basename(pdf_path)}...")
        ocr_success = False

        if tess_bin:
            try:
                import ocrmypdf
                ocrmypdf.ocr(
                    pdf_path,
                    out_pdf,
                    sidecar=sidecar_txt,
                    skip_text=True,
                    deskew=True,
                    optimize=0,
                    progress_bar=False,
                )
                ocr_success = True
            except Exception as ocr_err:
                _log(f"[OCR] OCRmyPDF notice: {ocr_err}")
        else:
            _log("[OCR] Tesseract binary not detected in PATH; falling back to direct extraction & PaddleOCR.")

        # 1. Read sidecar text if produced
        if os.path.exists(sidecar_txt):
            with open(sidecar_txt, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read().strip()
            if content:
                _log(f"[OCR] OCRmyPDF extracted {len(content)} characters via sidecar.")
                return content.splitlines(), None

        # 2. Extract text from output PDF (or original if already searchable) via PyMuPDF
        target_pdf = out_pdf if (ocr_success and os.path.exists(out_pdf)) else pdf_path
        try:
            import pymupdf as fitz
        except ImportError:
            import fitz
        doc = fitz.open(target_pdf)
        extracted = []
        for page in doc:
            t = page.get_text()
            if t and t.strip():
                extracted.append(t.strip())
        doc.close()

        if extracted:
            _log(f"[OCR] OCRmyPDF recovered {len(extracted)} pages of text.")
            return "\n\n".join(extracted).splitlines(), None

        return [], None
    except Exception as e:
        return None, f"OCRmyPDF error: {e}"
    finally:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


def run_tesseract(pages):
    """Run Tesseract OCR on rendered page images."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError as e:
        return None, f"pytesseract or PIL not installed in OCR environment: {e}"

    tess_bin = _find_tesseract_binary()
    if tess_bin:
        pytesseract.pytesseract.tesseract_cmd = tess_bin
    else:
        try:
            pytesseract.get_tesseract_version()
        except Exception:
            return None, "Tesseract binary not found on system. Install Tesseract OCR (e.g. winget install UB-Mannheim.TesseractOCR)."

    lines = []
    _log(f"[OCR] Starting Tesseract recognition on {len(pages)} pages...")
    for idx, img in enumerate(pages):
        if img is None:
            continue
        page_num = idx + 1
        _log(f"[OCR] Tesseract scanning page {page_num}/{len(pages)}...")
        try:
            pil_img = Image.fromarray(img)
            text = pytesseract.image_to_string(pil_img)
            page_lines = [l.strip() for l in text.splitlines() if l.strip()]
            _log(f"[OCR] Page {page_num}/{len(pages)} done -> {len(page_lines)} lines extracted")
            lines.extend(page_lines)
        except Exception as pe:
            _log(f"[OCR] Tesseract error on page {page_num}: {pe}")

    return lines, None


def run_paddleocr(pages, engine, device):
    """Robust OCR across PaddleOCR v3 (PaddleX) and legacy versions."""
    try:
        from paddleocr import PaddleOCR
    except Exception as e:
        return None, f"paddleocr is not installed in the OCR environment (~/.everfern/ocr-venv): {e}"

    ocr = None
    try:
        v3_kwargs = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": True,
            "lang": "en",
            "enable_mkldnn": False,
            "device": device,
        }
        ocr = PaddleOCR(**v3_kwargs)
    except Exception as e:
        _log(f"[OCR] PaddleOCR v3 init failed ({e}); attempting minimal init.")
        ocr = None

    if ocr is None:
        try:
            ocr = PaddleOCR(lang="en", enable_mkldnn=False)
        except Exception:
            try:
                ocr = PaddleOCR(lang="en")
            except Exception as e:
                return None, f"PaddleOCR initialization failed: {e}"

    lines = []
    imgs = [img for img in pages if img is not None]
    if not imgs:
        return [], None

    _log(f"[OCR] Starting PaddleOCR recognition on {len(imgs)} pages...")

    for idx, img in enumerate(imgs):
        page_lines = []
        page_num = idx + 1
        _log(f"[OCR] Scanning page {page_num}/{len(imgs)}...")

        if hasattr(ocr, "predict"):
            try:
                results = list(ocr.predict(img))
                for r in results:
                    page_lines.extend(_extract_lines(r))
            except Exception as pe:
                _log(f"[OCR] predict on page {page_num} failed ({pe}); falling back to .ocr()")

        if not page_lines and hasattr(ocr, "ocr"):
            try:
                result = None
                try:
                    result = ocr.ocr(img, cls=True)
                except Exception:
                    try:
                        result = ocr.ocr(img)
                    except Exception:
                        pass
                if result:
                    page_lines.extend(_extract_lines(result))
            except Exception as oe:
                _log(f"[OCR] ocr() on page {page_num} failed: {oe}")

        _log(f"[OCR] Page {page_num}/{len(imgs)} done -> {len(page_lines)} lines extracted")
        lines.extend(page_lines)

    return lines, None


def render_mode(pdf_path, out_dir, max_pages=30):
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz
    try:
        doc = fitz.open(pdf_path)
        total = len(doc)
        limit = min(total, max_pages)
        written = 0
        for i in range(limit):
            page = doc[i]
            zoom = 200.0 / 72.0
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            if pix.width > 2000 or pix.height > 2000:
                factor = min(2000.0 / pix.width, 2000.0 / pix.height)
                pix = page.get_pixmap(matrix=fitz.Matrix(zoom * factor, zoom * factor), alpha=False)
            fname = os.path.join(out_dir, f"page_{i + 1:04d}.png")
            pix.save(fname)
            written += 1
        doc.close()
        _emit(f"[EVERFERN_RENDER|{total}|{written}]")
    except Exception as e:
        _emit(f"[EVERFERN_RENDER_ERROR] {e}")


def main():
    if len(sys.argv) < 2:
        _error("usage: ocr_pdf.py render <pdf> <outDir> <maxPages> | <pdf> <engine> <backend>")
        return

    if sys.argv[1] == "render":
        if len(sys.argv) < 4:
            _error("render requires: render <pdf> <outDir> <maxPages>")
            return
        try:
            render_mode(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 30)
        except Exception as e:
            _error(f"render_mode: {e}")
        return

    pdf_path = sys.argv[1]
    engine = sys.argv[2] if len(sys.argv) > 2 else "ocrmypdf"
    backend = sys.argv[3] if len(sys.argv) > 3 else "auto"
    engine = (engine or "ocrmypdf").lower()
    backend = backend or "auto"

    _log(f"[OCR] Starting ocr_pdf.py for: {pdf_path} (engine={engine}, backend={backend})")
    device = _resolve_device(backend)

    if not os.path.exists(pdf_path):
        _error(f"pdf not found: {pdf_path}")
        return

    lines = []
    err = None

    is_image = pdf_path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'))
    if is_image:
        try:
            from PIL import Image
            import numpy as np
            img = Image.open(pdf_path).convert('RGB')
            pages = [np.array(img)]
            tess_lines, tess_err = run_tesseract(pages)
            if tess_lines:
                lines, err = tess_lines, None
            else:
                pad_lines, pad_err = run_paddleocr(pages, engine if engine.startswith("paddle") else "paddleocr", device)
                if pad_lines:
                    lines, err = pad_lines, None
                else:
                    err = tess_err or pad_err or "No text recognized in image."
        except Exception as ie:
            err = f"Failed to OCR image: {ie}"
    # 1. OCRmyPDF Engine (Primary Default)
    elif engine == "ocrmypdf":
        lines, err = run_ocrmypdf(pdf_path)
        # Fallback to Tesseract / PaddleOCR if OCRmyPDF returned empty or error
        if err or not lines:
            _log(f"[OCR] OCRmyPDF did not yield text ({err or 'empty'}), attempting Tesseract/PaddleOCR fallback...")
            # Render pages for fallback
            try:
                import pymupdf as fitz
                import numpy as np
                doc = fitz.open(pdf_path)
                pages = []
                for page in doc:
                    pix = page.get_pixmap(dpi=150)
                    samples = np.frombuffer(pix.samples, dtype=np.uint8).copy().reshape(pix.height, pix.width, pix.n)
                    if pix.n == 4:
                        samples = samples[:, :, :3]
                    elif pix.n == 1:
                        samples = np.repeat(samples, 3, axis=2)
                    pages.append(samples)
                doc.close()
                tess_lines, tess_err = run_tesseract(pages)
                if tess_lines:
                    lines, err = tess_lines, None
                else:
                    pad_lines, pad_err = run_paddleocr(pages, "paddleocr", device)
                    if pad_lines:
                        lines, err = pad_lines, None
            except Exception as fe:
                _log(f"[OCR] Fallback attempt error: {fe}")

    # 2. Tesseract Engine
    elif engine == "tesseract":
        try:
            import pymupdf as fitz
            import numpy as np
            doc = fitz.open(pdf_path)
            pages = []
            for page in doc:
                pix = page.get_pixmap(dpi=150)
                samples = np.frombuffer(pix.samples, dtype=np.uint8).copy().reshape(pix.height, pix.width, pix.n)
                if pix.n == 4:
                    samples = samples[:, :, :3]
                elif pix.n == 1:
                    samples = np.repeat(samples, 3, axis=2)
                pages.append(samples)
            doc.close()
            lines, err = run_tesseract(pages)
        except Exception as e:
            err = f"failed to process pdf for tesseract: {e}"

    # 3. PaddleOCR / PaddleOCR-VL Engines
    else:
        try:
            import pymupdf as fitz
            import numpy as np
            doc = fitz.open(pdf_path)
            pages = []
            for page in doc:
                pix = page.get_pixmap(dpi=150)
                samples = np.frombuffer(pix.samples, dtype=np.uint8).copy().reshape(pix.height, pix.width, pix.n)
                if pix.n == 4:
                    samples = samples[:, :, :3]
                elif pix.n == 1:
                    samples = np.repeat(samples, 3, axis=2)
                pages.append(samples)
            doc.close()
            lines, err = run_paddleocr(pages, engine, device)
        except Exception as e:
            err = f"failed to render pdf: {e}"

    if err:
        _error(err)
        return

    if not lines:
        _emit(f"[EVERFERN_OCR_NO_TEXT|{engine}|{backend}|1]")
        return

    text = "\n".join(str(l).strip() for l in lines if l and str(l).strip())
    text = text.strip()
    if not text:
        _emit(f"[EVERFERN_OCR_NO_TEXT|{engine}|{backend}|1]")
        return

    _log(f"[OCR] Finished OCR successfully ({engine}): {len(text)} total characters extracted.")
    _emit(f"[EVERFERN_OCR|{engine}|{backend}|1]  {text}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        _error(traceback.format_exc())