if command -v python3 >/dev/null 2>&1; then
  echo "PY: $(python3 --version 2>&1)"
elif command -v python >/dev/null 2>&1; then
  echo "PY: $(python --version 2>&1)"
else
  echo "NO_PYTHON"
fi

if command -v node >/dev/null 2>&1; then
  echo "NODE: $(node --version 2>&1)"
elif command -v nodejs >/dev/null 2>&1; then
  echo "NODE: $(nodejs --version 2>&1)"
else
  echo "NO_NODE"
fi

if [ -d "$HOME/.everfern/venv" ]; then
  echo "VENV_EXISTS"
else
  echo "NO_VENV"
fi

PY_BIN=""
if [ -x "$HOME/.everfern/venv/bin/python3" ]; then
  PY_BIN="$HOME/.everfern/venv/bin/python3"
elif [ -x "$HOME/.everfern/venv/bin/python" ]; then
  PY_BIN="$HOME/.everfern/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PY_BIN="python"
fi

if [ -n "$PY_BIN" ]; then
  $PY_BIN -c "import pypdf, pdfplumber, openpyxl, pptx, pandas, docx, matplotlib, numpy, requests, bs4, reportlab, weasyprint" 2>/dev/null && echo "PY_PKGS_OK" || echo "NO_PY_PKGS"
  $PY_BIN -c "import pypdf; print('PDF_OK')" 2>/dev/null || $PY_BIN -c "import pdfplumber; print('PDF_OK')" 2>/dev/null || echo "NO_PDF"
  $PY_BIN -c "import pandas; print('EXCEL_OK')" 2>/dev/null || $PY_BIN -c "import openpyxl; print('EXCEL_OK')" 2>/dev/null || echo "NO_EXCEL"
  $PY_BIN -c "import pptx; print('PPTX_OK')" 2>/dev/null || echo "NO_PPTX"
  $PY_BIN -c "import docx; print('DOCX_OK')" 2>/dev/null || echo "NO_DOCX"
  $PY_BIN -c "import numpy; print('DATA_OK')" 2>/dev/null || $PY_BIN -c "import matplotlib; print('DATA_OK')" 2>/dev/null || echo "NO_DATA"
else
  echo "NO_PDF"
  echo "NO_EXCEL"
  echo "NO_PPTX"
  echo "NO_DOCX"
  echo "NO_DATA"
fi

if NODE_PATH="$HOME/.everfern/node_modules" node -e "for (const p of ['pptxgenjs','pdf-lib','exceljs','typescript','ts-node']) require.resolve(p)" >/dev/null 2>&1; then
  echo "NODE_PKGS_OK"
else
  echo "NO_NODE_PKGS"
fi
