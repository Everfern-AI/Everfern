# EverFern Multi-Agent Coding System - Complete Index

## Overview

This document provides a complete map of the multi-agent coding system and where to find information.

## 📚 Documentation Files

### Quick Reference
- **QUICK_REFERENCE.md** (root) - Start here! Quick start guide and common scenarios
- **README.md** (subagents) - How to use individual subagents

### Architecture & Design
- **MULTI_AGENT_ARCHITECTURE.md** (subagents) - Detailed architecture breakdown
- **CLAUDE_CODE_COMPARISON.md** - Feature comparison with Claude Code
- **IMPLEMENTATION_GUIDE.md** - How to extend and integrate

### Summary
- **MULTI_AGENT_IMPLEMENTATION_SUMMARY.md** (root) - Complete implementation summary

## 🔧 Source Code Files

### Main Orchestrator
```
agents/coding-specialist.ts
  └─ createCodingSpecialistNode()
     ├─ Phase 1: Exploration
     ├─ Phase 2: Planning
     ├─ Phase 3: Implementation
     ├─ Phase 4: Review
     ├─ Phase 5: Testing
     └─ Error Recovery
```

### Subagents
```
agents/coding-assistant/subagents/
├─ index.ts                       (Export all + types)
├─ exploration-agent.ts           (Read-only analyzer)
├─ planning-agent.ts              (Strategy developer)
├─ worker-agent.ts                (Code writer)
├─ code-reviewer-agent.ts         (Quality checker)
└─ test-runner-agent.ts           (TDD executor)
```

### State Management
```
runner/state.ts
  └─ GraphState additions:
     ├─ subagentCoordination
     ├─ pendingApproval
     └─ completionSummary
```

## 📖 Reading Guide

### For Users

**Start Here:**
1. Read QUICK_REFERENCE.md (5 min)
2. Read README.md in subagents folder (10 min)
3. Try a simple coding task

**Learn More:**
4. Read CLAUDE_CODE_COMPARISON.md (10 min)
5. Read MULTI_AGENT_ARCHITECTURE.md (15 min)

**Master It:**
6. Read IMPLEMENTATION_GUIDE.md (20 min)
7. Experiment with custom configurations

### For Developers

**Start Here:**
1. Read IMPLEMENTATION_GUIDE.md (20 min)
2. Read MULTI_AGENT_ARCHITECTURE.md (20 min)
3. Review coding-specialist.ts source (15 min)

**Implement:**
4. Review each subagent file (5 min each)
5. Create unit tests for modifications
6. Integration test the whole system

**Deploy:**
7. Run integration tests
8. Performance profiling
9. Staging deployment
10. Production rollout

### For DevOps

**Understand:**
1. QUICK_REFERENCE.md - Overview (5 min)
2. MULTI_AGENT_IMPLEMENTATION_SUMMARY.md - Integration (10 min)

**Configure:**
3. IMPLEMENTATION_GUIDE.md - Configuration section
4. Review state.ts for new annotations
5. Check error handling in coding-specialist.ts

**Monitor:**
6. Set up logging/telemetry (see IMPLEMENTATION_GUIDE.md)
7. Monitor phase durations
8. Track error rates per phase

## 🎯 Use Cases

### Quick Prototype
**Time**: 5-10 minutes
1. Use lenient review settings
2. Lower test coverage target
3. Skip documentation phase
4. See QUICK_REFERENCE.md for config

### Production Feature
**Time**: 15-25 minutes
1. Use standard review settings
2. High test coverage target (85%+)
3. Full documentation
4. See QUICK_REFERENCE.md for config

### Security-Critical
**Time**: 25-40 minutes
1. Use strict review settings
2. All review criteria enabled
3. Maximum test coverage
4. External security review

### Learning & Development
**Time**: Variable
1. Read MULTI_AGENT_ARCHITECTURE.md
2. Review source code files
3. Read IMPLEMENTATION_GUIDE.md
4. Create custom subagents

## 🔄 Phase Reference

### Phase 1: Exploration
- **File**: exploration-agent.ts
- **Purpose**: Understand codebase
- **Duration**: 30s - 2m
- **Output**: CodebaseMap
- **Docs**: MULTI_AGENT_ARCHITECTURE.md → Section 1

### Phase 2: Planning
- **File**: planning-agent.ts
- **Purpose**: Develop strategy
- **Duration**: 45s - 3m
- **Output**: DevelopmentPlan
- **Approval**: High-complexity plans require user approval
- **Docs**: MULTI_AGENT_ARCHITECTURE.md → Section 2

### Phase 3: Implementation
- **File**: worker-agent.ts
- **Purpose**: Write code
- **Duration**: 2-10m
- **Output**: ImplementationResults
- **Docs**: MULTI_AGENT_ARCHITECTURE.md → Section 3

### Phase 4: Review
- **File**: code-reviewer-agent.ts
- **Purpose**: Quality assurance
- **Duration**: 45s - 2m
- **Output**: CodeReviewResult
- **Feedback Loop**: Returns to Phase 3 if critical issues
- **Docs**: MULTI_AGENT_ARCHITECTURE.md → Section 4

### Phase 5: Testing
- **File**: test-runner-agent.ts
- **Purpose**: TDD & coverage
- **Duration**: 1-5m
- **Output**: TestResult
- **Docs**: MULTI_AGENT_ARCHITECTURE.md → Section 5

## 🎛️ Configuration

### Phase-Specific Settings

**Exploration Settings**: See exploration-agent.ts
- scanDepth: 1-4
- includeTests: true/false
- includeDocs: true/false
- focusAreas: string[]

**Planning Settings**: See planning-agent.ts
- constraints: { timeframe, compatibility, performance }
- preferences: { codingStyle, testingApproach, documentation }

**Review Settings**: See code-reviewer-agent.ts
- strictnessLevel: 'lenient' | 'standard' | 'strict'
- reviewCriteria: { security, performance, maintainability, ... }

**Testing Settings**: See test-runner-agent.ts
- testStrategy: 'tdd' | 'bdd' | 'unit' | ...
- testFramework: 'jest' | 'mocha' | 'pytest' | ...
- coverageTarget: 60-95%

## 🚨 Error Handling

**Reference**: IMPLEMENTATION_GUIDE.md → Troubleshooting section

| Error | Solution |
|-------|----------|
| Phase timeout | Reduce scanDepth, check disk/memory |
| Build fails | Check build command, verify dependencies |
| Review too strict | Change strictnessLevel to 'lenient' |
| Tests won't pass | Check test framework, verify test command |

## 📊 Monitoring

**Metrics to Track**: See IMPLEMENTATION_GUIDE.md → Monitoring section

- Phase duration trends
- Phase success rate
- Average plan complexity
- Code review issues found
- Test coverage achieved
- Fallback activation rate

## 🔗 Related Systems

### Brain Router
- Routes to: coding_specialist
- Integration: automatic via graph routing
- Docs: See IMPLEMENTATION_GUIDE.md → Integration section

### Tool Manager
- Provides tools to subagents
- All standard tools available
- Docs: See each subagent for tool definitions

### State Manager
- Tracks coordination state
- Manages phase transitions
- Persists context between phases

## 📝 Common Tasks

### "I need to add a new subagent"
1. Read: IMPLEMENTATION_GUIDE.md → Extending the System
2. Template: Use exploration-agent.ts as template
3. Export: Add to subagents/index.ts
4. Integrate: Add to coding-specialist.ts phase loop

### "I need to configure for faster execution"
1. Read: QUICK_REFERENCE.md → Configuration
2. Set: scanDepth = 2, strictnessLevel = 'lenient'
3. Reduce: testCoverageTarget = 60

### "I need to understand the architecture"
1. Read: MULTI_AGENT_ARCHITECTURE.md (complete)
2. Reference: CLAUDE_CODE_COMPARISON.md for context
3. Deep dive: IMPLEMENTATION_GUIDE.md for details

### "I'm hitting errors"
1. Check: IMPLEMENTATION_GUIDE.md → Troubleshooting
2. Enable: Debug logging in console
3. Review: Phase-specific tool output
4. Contact: Team for help

## 🏃 Quick Navigation

### By Role

**Product Manager**
1. QUICK_REFERENCE.md
2. CLAUDE_CODE_COMPARISON.md
3. MULTI_AGENT_IMPLEMENTATION_SUMMARY.md

**Developer**
1. IMPLEMENTATION_GUIDE.md
2. Source code files
3. MULTI_AGENT_ARCHITECTURE.md

**DevOps**
1. QUICK_REFERENCE.md (overview)
2. IMPLEMENTATION_GUIDE.md (configuration)
3. state.ts (for monitoring)

**QA/Tester**
1. README.md (subagents)
2. Integration test patterns
3. Phase-specific test cases

### By Time Available

**5 minutes**: QUICK_REFERENCE.md
**15 minutes**: QUICK_REFERENCE.md + README.md
**30 minutes**: QUICK_REFERENCE.md + README.md + CLAUDE_CODE_COMPARISON.md
**1 hour**: Add IMPLEMENTATION_GUIDE.md + MULTI_AGENT_ARCHITECTURE.md
**2 hours**: Add source code review + deep dive

## 📞 Getting Help

1. **Check Documentation First**
   - Search relevant .md files
   - Check source code comments
   - Review examples in files

2. **Enable Debug Mode**
   - Check console.log output
   - Enable verbose event logging
   - Trace execution with state snapshots

3. **Contact Team**
   - Slack: #everfern-coding-agents
   - Docs: See each file for FAQ
   - Issues: Report in GitHub

## ✅ Checklist

### Before Using

- [ ] Read QUICK_REFERENCE.md
- [ ] Understand 5-phase workflow
- [ ] Know your configuration needs
- [ ] Have a test project ready

### Before Extending

- [ ] Read IMPLEMENTATION_GUIDE.md
- [ ] Understand subagent pattern
- [ ] Review existing subagents
- [ ] Plan your extension

### Before Deploying

- [ ] Integration tests pass
- [ ] Performance acceptable
- [ ] Error handling robust
- [ ] Monitoring setup
- [ ] Team trained

---

## 📊 System at a Glance

```
┌─ Exploration Agent (Read-Only)
│  └─ Outputs: CodebaseMap
│
├─ Planning Agent (Strategic)
│  └─ Outputs: DevelopmentPlan [Approval Gate]
│
├─ Worker Agent (Code Writer)
│  └─ Outputs: ImplementationResults
│
├─ Code Reviewer Agent (Quality)
│  └─ Outputs: CodeReviewResult [Feedback Loop]
│
└─ Test Runner Agent (TDD)
   └─ Outputs: TestResult

All Agents Orchestrated by: createCodingSpecialistNode()
State Managed by: GraphState.subagentCoordination
```

---

**Last Updated**: June 2, 2026
**Version**: 1.0.0
**Status**: Complete & Ready for Use
