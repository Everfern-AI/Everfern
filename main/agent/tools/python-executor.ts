import { CommandRegistry } from './terminal/registry';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { getAnalysisSessionManager } from '../sessions/analysis-session';

/**
 * Python Execution Result
 * Contains execution output, errors, and metadata
 */
export interface PythonExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  returnValue?: any;
  plotPaths?: string[];
  executionTimeMs: number;
  error?: {
    type: 'syntax' | 'runtime' | 'timeout' | 'library_missing' | 'file_loading';
    message: string;
    traceback: string;
    line?: number;
    suggestions?: string[];
  };
}

/**
 * Python Executor
 * Executes Python code in isolated processes with comprehensive error handling
 */
export class PythonExecutor {
  private defaultTimeout: number = 60000; // 60 seconds
  private plotTempDir: string;

  constructor() {
    // Create temporary directory for plots
    this.plotTempDir = path.join(os.tmpdir(), 'kiro-plots');
    if (!fs.existsSync(this.plotTempDir)) {
      fs.mkdirSync(this.plotTempDir, { recursive: true });
    }
  }

  /**
   * Detect if Python code contains plot saving calls
   * @param code Python code to analyze
   * @returns True if code contains savefig calls
   */
  private detectPlotSaving(code: string): boolean {
    // Match plt.savefig() or fig.savefig() or any_var.savefig()
    const savefigPattern = /\w+\.savefig\s*\(/;
    return savefigPattern.test(code);
  }

  /**
   * Inject plot path capture into Python code
   * @param code Original Python code
   * @returns Modified code with plot path capture
   */
  private injectPlotCapture(code: string): string {
    const plotDir = this.plotTempDir.replace(/\\/g, '/'); // Normalize path for Python
    const timestamp = Date.now();

    // Inject code to capture plot paths
    const injectedCode = `
import sys
import os
_kiro_plot_paths = []
_kiro_plot_dir = r"${plotDir}"
_kiro_timestamp = ${timestamp}
_kiro_plot_counter = [0]

# Override savefig to capture paths
import matplotlib.pyplot as plt
_original_savefig = plt.savefig

def _kiro_savefig(fname, *args, **kwargs):
    # If fname is relative, make it absolute in our temp dir
    if not os.path.isabs(fname):
        fname = os.path.join(_kiro_plot_dir, f"plot_{_kiro_timestamp}_{_kiro_plot_counter[0]}_{os.path.basename(fname)}")
        _kiro_plot_counter[0] += 1
    _kiro_plot_paths.append(fname)
    return _original_savefig(fname, *args, **kwargs)

plt.savefig = _kiro_savefig

# Also patch Figure.savefig
from matplotlib.figure import Figure
_original_fig_savefig = Figure.savefig

def _kiro_fig_savefig(self, fname, *args, **kwargs):
    if not os.path.isabs(fname):
        fname = os.path.join(_kiro_plot_dir, f"plot_{_kiro_timestamp}_{_kiro_plot_counter[0]}_{os.path.basename(fname)}")
        _kiro_plot_counter[0] += 1
    _kiro_plot_paths.append(fname)
    return _original_fig_savefig(self, fname, *args, **kwargs)

Figure.savefig = _kiro_fig_savefig

# User code
${code}

# Print plot paths for capture
if _kiro_plot_paths:
    print("__KIRO_PLOT_PATHS__:" + "|".join(_kiro_plot_paths))
`;

    return injectedCode;
  }

  /**
   * Extract plot paths from Python output
   * @param output Python stdout
   * @returns Array of plot file paths
   */
  private extractPlotPaths(output: string): string[] {
    const marker = '__KIRO_PLOT_PATHS__:';
    const markerIndex = output.indexOf(marker);

    if (markerIndex === -1) {
      return [];
    }

    const pathsLine = output.substring(markerIndex + marker.length);
    const pathsEnd = pathsLine.indexOf('\n');
    const pathsStr = pathsEnd === -1 ? pathsLine : pathsLine.substring(0, pathsEnd);

    return pathsStr.split('|').filter(p => p.trim().length > 0);
  }

  /**
   * Remove plot path markers from output
   * @param output Python stdout
   * @returns Cleaned output
   */
  private cleanPlotMarkers(output: string): string {
    const marker = '__KIRO_PLOT_PATHS__:';
    const markerIndex = output.indexOf(marker);

    if (markerIndex === -1) {
      return output;
    }

    const beforeMarker = output.substring(0, markerIndex);
    const afterMarker = output.substring(markerIndex);
    const lineEnd = afterMarker.indexOf('\n');
    const afterLine = lineEnd === -1 ? '' : afterMarker.substring(lineEnd + 1);

    return (beforeMarker + afterLine).trim();
  }

  /**
   * Execute Python code with timeout handling
   * @param code Python code to execute
   * @param timeout Timeout in milliseconds (default 60s)
   * @returns Execution result with output and error information
   */
  async execute(code: string, timeout: number = this.defaultTimeout): Promise<PythonExecutionResult> {
    const startTime = Date.now();
    const registry = CommandRegistry.getInstance();
    const id = `python_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Detect and inject plot capture if needed
    const hasPlots = this.detectPlotSaving(code);
    const codeToExecute = hasPlots ? this.injectPlotCapture(code) : code;

    // Escape code for shell execution
    const escapedCode = this.escapeCodeForShell(codeToExecute);
    const isWin = process.platform === 'win32';
    const command = isWin ? `python ${escapedCode}` : `python -c ${escapedCode}`;
    const cwd = path.join(os.homedir(), '.everfern');

    // Start execution
    const executionPromise = registry.execute(id, command, cwd);

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        registry.terminate(id);
        reject(new Error('TIMEOUT'));
      }, timeout);
    });

    try {
      // Race between execution and timeout
      const info = await Promise.race([executionPromise, timeoutPromise]);
      const executionTimeMs = Date.now() - startTime;

      // Parse output
      const stdout = this.extractStdout(info.output);
      const stderr = this.extractStderr(info.output);

      // Extract plot paths if present
      const plotPaths = hasPlots ? this.extractPlotPaths(stdout) : undefined;
      const cleanedStdout = hasPlots ? this.cleanPlotMarkers(stdout) : stdout;

      // Check for errors
      if (info.status === 'failed' || info.exitCode !== 0) {
        const error = this.parseError(stderr || info.output);
        return {
          success: false,
          stdout: cleanedStdout,
          stderr,
          executionTimeMs,
          plotPaths,
          error
        };
      }

      // Success case
      return {
        success: true,
        stdout: cleanedStdout,
        stderr,
        executionTimeMs,
        plotPaths
      };
    } catch (err) {
      const executionTimeMs = Date.now() - startTime;

      // Handle timeout
      if (err instanceof Error && err.message === 'TIMEOUT') {
        return {
          success: false,
          stdout: '',
          stderr: '',
          executionTimeMs,
          error: {
            type: 'timeout',
            message: `Python execution exceeded timeout of ${timeout}ms`,
            traceback: '',
            suggestions: [
              'Optimize your code to run faster',
              'For large datasets, consider sampling: df.sample(n=100000)',
              'Use vectorized pandas operations instead of loops',
              'Break down complex operations into smaller steps',
              'Increase the timeout if the operation legitimately needs more time'
            ]
          }
        };
      }

      // Handle other errors
      return {
        success: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        executionTimeMs,
        error: {
          type: 'runtime',
          message: err instanceof Error ? err.message : String(err),
          traceback: ''
        }
      };
    }
  }

  /**
   * Execute Python code with progress callbacks
   * @param code Python code to execute
   * @param onProgress Callback for progress updates
   * @returns Execution result
   */
  async executeWithProgress(
    code: string,
    onProgress: (msg: string) => void
  ): Promise<PythonExecutionResult> {
    onProgress('Starting Python execution...');

    const startTime = Date.now();

    // Start execution in background
    const resultPromise = this.execute(code);

    // Emit progress updates every 2 seconds
    const progressInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      onProgress(`Python execution in progress... (${elapsed}s elapsed)`);
    }, 2000);

    try {
      const result = await resultPromise;
      clearInterval(progressInterval);

      if (result.success) {
        onProgress(`Python execution completed in ${result.executionTimeMs}ms`);
      } else {
        onProgress(`Python execution failed: ${result.error?.message || 'Unknown error'}`);
      }

      return result;
    } catch (err) {
      clearInterval(progressInterval);
      throw err;
    }
  }

  /**
   * Execute Python code within an analysis session, preserving partial results on failure.
   * Satisfies Requirement 7.4: WHEN analysis fails mid-execution, THE Analysis_Session SHALL preserve partial results.
   * @param code Python code to execute
   * @param sessionId Analysis session ID for partial result preservation
   * @param stepLabel Optional label for this execution step
   * @returns Execution result
   */
  async executeInSession(
    code: string,
    sessionId: string,
    stepLabel?: string
  ): Promise<PythonExecutionResult> {
    const result = await this.execute(code);
    const sessionManager = getAnalysisSessionManager() as any;

    // Always record execution in session history (success or failure)
    // This preserves partial results (stdout captured before failure)
    if (typeof sessionManager.addExecutionRecord === 'function') {
      sessionManager.addExecutionRecord(sessionId, {
        timestamp: Date.now(),
        code,
        result: {
          success: result.success,
          stdout: result.stdout,
          stderr: result.stderr,
          executionTimeMs: result.executionTimeMs
        }
      });
    }

    // On failure, store partial stdout as a variable in the session
    if (!result.success && result.stdout.trim().length > 0) {
      const partialKey = `partial_${stepLabel ?? 'result'}_${Date.now()}`;
      if (typeof sessionManager.storeVariable === 'function') {
        sessionManager.storeVariable(sessionId, partialKey, {
          stdout: result.stdout,
          capturedAt: Date.now(),
          errorType: result.error?.type,
          errorMessage: result.error?.message
        });
      }
    }

    return result;
  }

  /**
   * Escape Python code for shell execution
   * @param code Python code
   * @returns Escaped code string
   */
  private escapeCodeForShell(code: string): string {
    const isWin = process.platform === 'win32';

    if (isWin) {
      // On Windows, CommandRegistry routes through WSL (bash) or cmd.exe.
      // Write code to a temp file to avoid shell escaping issues entirely.
      const fs = require('fs') as typeof import('fs');
      const tmpFile = path.join(os.tmpdir(), `kiro_py_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`);
      fs.writeFileSync(tmpFile, code, 'utf8');
      return `"${tmpFile.replace(/\\/g, '/')}"`;
    } else {
      // Bash escaping: use single quotes and handle internal single quotes
      const escaped = code.replace(/'/g, "'\\''");
      return `'${escaped}'`;
    }
  }

  /**
   * Extract stdout from combined output
   * @param output Combined stdout/stderr
   * @returns Stdout content
   */
  private extractStdout(output: string): string {
    // For now, return full output as stdout
    // In future, could separate based on stream markers
    return output;
  }

  /**
   * Extract stderr from combined output
   * @param output Combined stdout/stderr
   * @returns Stderr content
   */
  private extractStderr(output: string): string {
    // Check if output contains error indicators
    if (output.includes('Traceback') || output.includes('Error:')) {
      return output;
    }
    return '';
  }

  /**
   * Parse Python error from stderr/output
   * @param errorOutput Error output from Python
   * @returns Parsed error object with suggestions
   */
  private parseError(errorOutput: string): PythonExecutionResult['error'] {
    // Check for library missing errors
    if (errorOutput.includes('ModuleNotFoundError') || errorOutput.includes('ImportError')) {
      const moduleMatch = errorOutput.match(/No module named ['"]([^'"]+)['"]/);
      const moduleName = moduleMatch ? moduleMatch[1] : 'unknown';

      return {
        type: 'library_missing',
        message: `Python library '${moduleName}' is not installed`,
        traceback: errorOutput,
        suggestions: this.generateLibraryMissingSuggestions(moduleName)
      };
    }

    // Check for syntax errors
    if (errorOutput.includes('SyntaxError')) {
      const lineMatch = errorOutput.match(/line (\d+)/);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

      return {
        type: 'syntax',
        message: 'Python syntax error',
        traceback: errorOutput,
        line,
        suggestions: this.generateSyntaxErrorSuggestions(errorOutput)
      };
    }

    // Check for common runtime error patterns
    const runtimeError = this.detectCommonRuntimeError(errorOutput);
    if (runtimeError) {
      return runtimeError;
    }

    // Generic runtime errors
    const lineMatch = errorOutput.match(/line (\d+)/);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

    // Extract error message from last line
    const lines = errorOutput.trim().split('\n');
    const lastLine = lines[lines.length - 1] || '';
    const errorMatch = lastLine.match(/^(\w+Error): (.+)$/);
    const message = errorMatch ? errorMatch[2] : lastLine;

    return {
      type: 'runtime',
      message,
      traceback: errorOutput,
      line,
      suggestions: ['Check the error traceback for details', 'Verify your data types and variable names']
    };
  }

  /**
   * Detect common runtime error patterns and provide specific suggestions
   * @param errorOutput Error output from Python
   * @returns Parsed error with specific suggestions, or null if not a common pattern
   */
  private detectCommonRuntimeError(errorOutput: string): PythonExecutionResult['error'] | null {
    const lineMatch = errorOutput.match(/line (\d+)/);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

    // KeyError - missing column or key
    if (errorOutput.includes('KeyError')) {
      const keyMatch = errorOutput.match(/KeyError: ['"]([^'"]+)['"]/);
      const key = keyMatch ? keyMatch[1] : 'unknown';

      return {
        type: 'runtime',
        message: `Column or key '${key}' does not exist`,
        traceback: errorOutput,
        line,
        suggestions: [
          `Check if column '${key}' exists in your DataFrame using df.columns`,
          'Verify the spelling and case of the column name',
          'Use df.head() to see available columns',
          'Consider using df.get() method for safe key access'
        ]
      };
    }

    // TypeError - type mismatch
    if (errorOutput.includes('TypeError')) {
      const suggestions = [
        'Check the data types of your variables using type() or df.dtypes',
        'Convert data types using astype(), int(), float(), or str()',
        'Verify that operations are compatible with the data types',
        'Use pd.to_numeric() or pd.to_datetime() for conversions'
      ];

      // Specific TypeError patterns
      if (errorOutput.includes('unsupported operand type')) {
        suggestions.unshift('You are trying to perform an operation on incompatible types');
      } else if (errorOutput.includes('not callable')) {
        suggestions.unshift('You are trying to call something that is not a function');
      }

      return {
        type: 'runtime',
        message: 'Type mismatch in operation',
        traceback: errorOutput,
        line,
        suggestions
      };
    }

    // ValueError - invalid value
    if (errorOutput.includes('ValueError')) {
      const suggestions = [
        'Check if the value is in the expected range or format',
        'Verify input data for unexpected values (NaN, infinity, negative numbers)',
        'Use df.describe() to see value distributions',
        'Consider using try-except to handle invalid values gracefully'
      ];

      // Specific ValueError patterns
      if (errorOutput.includes('invalid literal')) {
        suggestions.unshift('Cannot convert string to number - check for non-numeric characters');
      } else if (errorOutput.includes('could not convert')) {
        suggestions.unshift('Data conversion failed - verify the source data format');
      }

      return {
        type: 'runtime',
        message: 'Invalid value for operation',
        traceback: errorOutput,
        line,
        suggestions
      };
    }

    // FileNotFoundError - file loading error
    if (errorOutput.includes('FileNotFoundError') || errorOutput.includes('No such file')) {
      const fileMatch = errorOutput.match(/['"]([^'"]+\.(?:csv|xlsx?|json|parquet))['"]/i);
      const filename = fileMatch ? fileMatch[1] : 'file';

      return {
        type: 'file_loading',
        message: `File '${filename}' not found`,
        traceback: errorOutput,
        line,
        suggestions: [
          'Check if the file path is correct and the file exists',
          'Use absolute paths or verify the current working directory',
          'Check file permissions',
          'Verify the file extension matches the actual file format'
        ]
      };
    }

    // UnicodeDecodeError - encoding issue
    if (errorOutput.includes('UnicodeDecodeError')) {
      return {
        type: 'file_loading',
        message: 'File encoding error',
        traceback: errorOutput,
        line,
        suggestions: [
          'Try specifying encoding: pd.read_csv(file, encoding="utf-8")',
          'Try alternative encodings: "latin-1", "iso-8859-1", or "cp1252"',
          'Use encoding="utf-8-sig" for files with BOM',
          'Check the file encoding using a text editor'
        ]
      };
    }

    return null;
  }

  /**
   * Generate suggestions for library missing errors
   * @param moduleName Name of the missing module
   * @returns Array of actionable suggestions
   */
  private generateLibraryMissingSuggestions(moduleName: string): string[] {
    const suggestions = [
      `Install the library using: pip install ${moduleName}`,
      'Verify that Python and pip are properly installed',
      'Check if you are using the correct Python environment'
    ];

    // Add specific suggestions for common libraries
    const libraryMap: Record<string, string> = {
      'pandas': 'pip install pandas',
      'numpy': 'pip install numpy',
      'matplotlib': 'pip install matplotlib',
      'seaborn': 'pip install seaborn',
      'plotly': 'pip install plotly',
      'scipy': 'pip install scipy',
      'sklearn': 'pip install scikit-learn',
      'cv2': 'pip install opencv-python'
    };

    if (libraryMap[moduleName]) {
      suggestions[0] = `Install the library using: ${libraryMap[moduleName]}`;
    }

    return suggestions;
  }

  /**
   * Generate suggestions for syntax errors
   * @param errorOutput Error output from Python
   * @returns Array of actionable suggestions
   */
  private generateSyntaxErrorSuggestions(errorOutput: string): string[] {
    const suggestions: string[] = [];

    // Check for common syntax error patterns
    if (errorOutput.includes('unterminated string')) {
      suggestions.push('Add a closing quote to your string');
    }
    if (errorOutput.includes('invalid syntax') && errorOutput.includes('=')) {
      suggestions.push('Check for missing colons after if/for/while/def statements');
    }
    if (errorOutput.includes('unexpected indent') || errorOutput.includes('expected an indented block')) {
      suggestions.push('Check your indentation - Python requires consistent spacing');
      suggestions.push('Use 4 spaces for each indentation level');
    }
    if (errorOutput.includes('unmatched')) {
      suggestions.push('Check for matching parentheses, brackets, or braces');
    }

    // Generic suggestions
    if (suggestions.length === 0) {
      suggestions.push('Review the syntax error message and check the indicated line');
      suggestions.push('Verify parentheses, brackets, and quotes are properly matched');
      suggestions.push('Check for missing colons after control statements');
    }

    return suggestions;
  }
}
