export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  message?: string;
  custom?: (value: any, fullOutput: any) => string | null;
}

export interface ToolOutputSchema {
  toolName: string;
  rules: ValidationRule[];
  isSuccess?: (output: any) => boolean;
  isTransientError?: (output: any) => boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  isTransient: boolean;
}

const builtinSchemas: Map<string, ToolOutputSchema> = new Map();

export function registerOutputSchema(schema: ToolOutputSchema): void {
  builtinSchemas.set(schema.toolName, schema);
}

export function getOutputSchema(toolName: string): ToolOutputSchema | undefined {
  return builtinSchemas.get(toolName);
}

function parseOutput(output: any): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    if (output.output) return String(output.output);
    if (output.content) return String(output.content);
    return JSON.stringify(output);
  }
  return String(output || '');
}

function checkRule(value: any, rule: ValidationRule, fullOutput: any): string | null {
  if (value === undefined || value === null) {
    if (rule.required) return rule.message || `Missing required field: ${rule.field}`;
    return null;
  }

  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== rule.type) {
    return rule.message || `Field "${rule.field}" expected ${rule.type}, got ${actualType}`;
  }

  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      return rule.message || `Field "${rule.field}" too short (${value.length} < ${rule.minLength})`;
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      return rule.message || `Field "${rule.field}" too long (${value.length} > ${rule.maxLength})`;
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      return rule.message || `Field "${rule.field}" does not match required pattern`;
    }
  }

  if (rule.custom) {
    return rule.custom(value, fullOutput);
  }

  return null;
}

export function validateToolOutput(
  toolName: string,
  output: any,
  schema?: ToolOutputSchema
): ValidationResult {
  const resolvedSchema = schema || builtinSchemas.get(toolName);
  if (!resolvedSchema || resolvedSchema.rules.length === 0) {
    return { valid: true, errors: [], warnings: [], isTransient: false };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = parseOutput(output);

  let parsedObj: any;
  try {
    parsedObj = JSON.parse(parsed);
  } catch {
    parsedObj = { output: parsed };
  }

  for (const rule of resolvedSchema.rules) {
    const value = rule.field === '__root__' ? parsed : getNestedValue(parsedObj, rule.field);
    const error = checkRule(value, rule, parsedObj);
    if (error) {
      if (error.startsWith('WARN:')) {
        warnings.push(error.slice(5));
      } else {
        errors.push(error);
      }
    }
  }

  const isTransient = resolvedSchema.isTransientError
    ? resolvedSchema.isTransientError(output)
    : errors.some(e => /network|timeout|rate limit|429|5\d{2}/i.test(e));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    isTransient
  };
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

export function registerDefaultSchemas(): void {
  registerOutputSchema({
    toolName: 'terminal_execute',
    rules: [
      { field: '__root__', type: 'string', required: true, message: 'Terminal command produced no output' },
    ],
    isSuccess: (output: any) => {
      const text = typeof output === 'string' ? output : output?.output || '';
      return !text.includes('Error:') && !text.includes('failed') && !text.includes('npm ERR!') && !text.includes('Command failed');
    },
    isTransientError: (output: any) => {
      const text = typeof output === 'string' ? output : output?.output || '';
      return /network|timeout|connect ETIMEDOUT|socket hang up|ECONNREFUSED|rate limit/i.test(text);
    }
  });

  registerOutputSchema({
    toolName: 'terminal_status',
    rules: [
      { field: '__root__', type: 'string', required: true },
    ],
  });

  registerOutputSchema({
    toolName: 'read',
    rules: [
      { field: 'output', type: 'string', required: true },
    ],
    isSuccess: (output: any) => {
      const text = typeof output === 'string' ? output : output?.output || '';
      return !text.includes('Error:') && !text.includes('ENOENT');
    }
  });

  registerOutputSchema({
    toolName: 'write',
    rules: [],
    isSuccess: (output: any) => {
      const text = typeof output === 'string' ? output : output?.output || '';
      return !text.includes('Error:');
    }
  });

  registerOutputSchema({
    toolName: 'web_search',
    rules: [
      { field: '__root__', type: 'string', required: true },
    ],
    isTransientError: (output: any) => {
      const text = typeof output === 'string' ? output : output?.output || '';
      return /rate limit|timeout|5\d{2}/i.test(text);
    }
  });
}
