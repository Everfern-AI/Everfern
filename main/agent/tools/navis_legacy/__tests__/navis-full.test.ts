import { describe, it, expect } from 'vitest';

describe('Navis - JSON Schema', { timeout: 30000 }, () => {
  it('should enforce strict validation with additionalProperties: false', async () => {
    const { NAVIS_DECISION_SCHEMA } = await import('../orchestrator');
    
    expect(NAVIS_DECISION_SCHEMA).toBeDefined();
    expect(NAVIS_DECISION_SCHEMA.$name).toBe('navis_decision');
    expect(NAVIS_DECISION_SCHEMA.type).toBe('object');
    expect(NAVIS_DECISION_SCHEMA.required).toContain('current_state');
    expect(NAVIS_DECISION_SCHEMA.required).toContain('action');
    expect(NAVIS_DECISION_SCHEMA.additionalProperties).toBe(false);
  });

  it('should define all required action types', async () => {
    const { NAVIS_DECISION_SCHEMA } = await import('../orchestrator');
    
    const actions = NAVIS_DECISION_SCHEMA.properties.action.items.oneOf;
    const actionNames = actions.map((a: any) => Object.keys(a.properties)[0]);
    
    expect(actionNames).toContain('go_to_url');
    expect(actionNames).toContain('go_back');
    expect(actionNames).toContain('click_element');
    expect(actionNames).toContain('click_text');
    expect(actionNames).toContain('smart_click');
    expect(actionNames).toContain('input_text');
    expect(actionNames).toContain('smart_type');
    expect(actionNames).toContain('press_key');
    expect(actionNames).toContain('scroll_down');
    expect(actionNames).toContain('scroll_up');
    expect(actionNames).toContain('wait');
    expect(actionNames).toContain('extract_content');
    expect(actionNames).toContain('open_tab');
    expect(actionNames).toContain('switch_tab');
    expect(actionNames).toContain('close_tab');
    expect(actionNames).toContain('wait_for_navigation');
    expect(actionNames).toContain('solve_captcha');
    expect(actionNames).toContain('done');
    expect(actionNames.length).toBeGreaterThanOrEqual(18);
  });
});

describe('Navis - Tool Registration', () => {
  it('should create navis tool with correct metadata', async () => {
    const { createNavisTool } = await import('../tool');
    const mockClient = {} as any;
    
    const tool = createNavisTool(mockClient);
    
    expect(tool.name).toBe('navis');
    expect(tool.description).toContain('browser automation');
    expect(tool.parameters.required).toContain('task');
    expect(typeof tool.execute).toBe('function');
  });

  it('should accept optional parameters', async () => {
    const { createNavisTool } = await import('../tool');
    const mockClient = {} as any;
    
    const tool = createNavisTool(mockClient);
    const props = tool.parameters.properties;
    
    expect(props.task.type).toBe('string');
    expect(props.maxSteps.type).toBe('number');
    expect(props.headless.type).toBe('boolean');
    expect(props.startUrl.type).toBe('string');
  });
});

describe('Navis - BrowserSession', () => {
  it('should export BrowserSession class', async () => {
    const { BrowserSession } = await import('../session');
    expect(BrowserSession).toBeDefined();
  });

  it('should have required methods', async () => {
    const { BrowserSession } = await import('../session');
    const session = new BrowserSession();
    
    expect(typeof session.launch).toBe('function');
    expect(typeof session.openTab).toBe('function');
    expect(typeof session.closeTab).toBe('function');
    expect(typeof session.switchToTab).toBe('function');
    expect(typeof session.getTabs).toBe('function');
    expect(typeof session.close).toBe('function');
  });
});

describe('Navis - ElementCapture', () => {
  it('should export capture functions', async () => {
    const { captureInteractiveElements, formatElementsForPrompt, parseRefs } = await import('../element-capture');
    
    expect(captureInteractiveElements).toBeDefined();
    expect(formatElementsForPrompt).toBeDefined();
    expect(parseRefs).toBeDefined();
  });

  it('should format aria snapshot as-is for prompt', async () => {
    const { formatElementsForPrompt } = await import('../element-capture');
    
    const snapshot = '- button "Submit" [ref=e1]\n- textbox "Email" [ref=e2]\n- heading "Welcome" [level=1]';
    const formatted = formatElementsForPrompt(snapshot);
    expect(formatted).toBe(snapshot);
  });

  it('should parse refs from aria snapshot', async () => {
    const { parseRefs } = await import('../element-capture');
    
    const snapshot = '- button "Submit" [ref=e1]\n- textbox "Email" [ref=e2]\n- heading "Welcome" [level=1]';
    const refs = parseRefs(snapshot);
    
    expect(refs.size).toBe(2);
    expect(refs.get('e1')).toEqual({ role: 'button', name: 'Submit' });
    expect(refs.get('e2')).toEqual({ role: 'textbox', name: 'Email' });
    expect(refs.has('e1')).toBe(true);
  });
});

describe('Navis - ActionExecutor', () => {
  it('should export executeAction function', async () => {
    const { executeAction } = await import('../actions');
    expect(executeAction).toBeDefined();
  });

  it('should handle unknown action gracefully', async () => {
    const { executeAction } = await import('../actions');
    
    const result = await executeAction(
      'unknown_action' as any,
      {},
      null as any,
      null as any,
    );
    
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown action');
  });
});
