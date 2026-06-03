# EverFern Multi-Agent Coding System - Quick Reference

## 🚀 Quick Start

Just request a coding task and the system automatically:

```
User: "Build a REST API for user authentication"
       ↓
System: Runs 5 specialized agents in sequence
       ↓
Output: Production-ready code with full audit trail
```

## 📁 File Structure

```
apps/desktop/main/agent/runner/
├── agents/
│   └── coding-specialist.ts              ← Main orchestrator
│       └── coding-assistant/
│           └── subagents/                ← 5 specialized agents
│               ├── exploration-agent.ts
│               ├── planning-agent.ts
│               ├── worker-agent.ts
│               ├── code-reviewer-agent.ts
│               ├── test-runner-agent.ts
│               └── README.md
└── state.ts                              ← Updated with coordination state
```

## 🔄 5-Phase Workflow

### Phase 1: 🔍 Exploration (30s - 2m)
**Goal**: Understand existing codebase
```
Scan → Analyze → Map Architecture → Output: CodebaseMap
```

### Phase 2: 📋 Planning (45s - 3m)
**Goal**: Develop implementation strategy
```
Decompose → Estimate → Assess Risks → Output: DevelopmentPlan
👤 [Approval Gate for complex plans]
```

### Phase 3: ⚡ Implementation (2-10m)
**Goal**: Write production code
```
Execute Plan → Write Files → Build Validate → Output: ImplementationResults
```

### Phase 4: 🔍 Code Review (45s - 2m)
**Goal**: Quality assurance
```
Security → Performance → Maintainability → Output: CodeReviewResult
🔄 [If critical issues found, return to Phase 3]
```

### Phase 5: 🧪 Testing (1-5m)
**Goal**: Comprehensive test coverage
```
🔴 Write Tests → 🟢 Implement Code → 🔵 Refactor → Output: TestResult
```

## 📊 Output At Each Phase

| Phase | Output | Use Case |
|-------|--------|----------|
| Exploration | CodebaseMap | Understand codebase structure |
| Planning | DevelopmentPlan | Review strategy before implementation |
| Implementation | ImplementationResults | Track created/modified files |
| Review | CodeReviewResult | Quality metrics and security analysis |
| Testing | TestResult | Coverage metrics and test results |

## ✅ Quick Features

- ✅ **Professional Quality**: Comparable to Claude Code
- ✅ **Transparent Process**: See each phase in action
- ✅ **User Control**: Approval gates for high-risk decisions
- ✅ **Quality Metrics**: Explicit scores and measurements
- ✅ **TDD Enforcement**: Red-green-refactor cycle
- ✅ **Feedback Loops**: Automatic fixes for issues
- ✅ **Error Recovery**: Smart fallback mechanisms

## 🎯 Common Scenarios

### Scenario 1: Quick MVP
```typescript
// Use lenient settings
config.review.strictnessLevel = 'lenient';
config.testing.coverageTarget = 60;
```
**Result**: 5-10 minutes to working code

### Scenario 2: Production Feature
```typescript
// Use strict settings
config.review.strictnessLevel = 'strict';
config.testing.coverageTarget = 90;
```
**Result**: 15-25 minutes of quality-assured code

### Scenario 3: Security-Critical
```typescript
// Maximum security
config.review.reviewCriteria.security = true;
config.review.reviewCriteria.performance = true;
```
**Result**: Comprehensive security audit

## 🔧 Configuration

### For Quick Iteration
```typescript
{
  exploration: { scanDepth: 2 },
  review: { strictnessLevel: 'lenient' },
  testing: { coverageTarget: 60 }
}
```

### For Production
```typescript
{
  exploration: { scanDepth: 3 },
  review: { strictnessLevel: 'standard' },
  testing: { coverageTarget: 85 }
}
```

### For Maximum Quality
```typescript
{
  exploration: { scanDepth: 4 },
  review: { strictnessLevel: 'strict' },
  testing: { coverageTarget: 95 }
}
```

## 📈 Performance

| Scenario | Time | Complexity |
|----------|------|-----------|
| Simple module | 5 minutes | Low |
| Standard API | 10-15 minutes | Medium |
| Complex system | 20-30 minutes | High |

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Phase hangs | Reduce `scanDepth` or `maxFileSize` |
| Review too strict | Change `strictnessLevel` to 'lenient' |
| Tests fail | Check build command and test framework |
| Memory issues | Break into smaller phases or reduce scope |

## 📚 Documentation

| Doc | Purpose |
|-----|---------|
| README.md (subagents) | Usage guide for each agent |
| IMPLEMENTATION_GUIDE.md | How to extend the system |
| MULTI_AGENT_ARCHITECTURE.md | Deep dive into architecture |
| CLAUDE_CODE_COMPARISON.md | Feature comparison |

## 🚦 State Management

### Accessing Coordination State
```typescript
const phase = state.subagentCoordination.phase;
const completed = state.subagentCoordination.completedPhases;
const context = state.subagentCoordination.sharedContext;
```

### Phase Progression
```
exploration → planning → implementation → review → testing → complete
```

## 💡 Pro Tips

1. **Enable Debug Logging** for troubleshooting
2. **Use Approval Gates** for high-risk changes
3. **Configure Coverage Target** based on project type
4. **Review Phase Results** before proceeding
5. **Use Fallback Mode** if you need quick results

## 🎓 Learning Path

1. **Start**: Use default configuration
2. **Explore**: Read each subagent's README
3. **Customize**: Adjust settings for your needs
4. **Extend**: Create custom subagents
5. **Optimize**: Profile and improve

## 📞 Support

- **Documentation**: See files in coding-assistant/ directory
- **Examples**: Check subagent files for patterns
- **Debugging**: Enable console logging
- **Team**: Contact EverFern development team

## 🌟 Key Innovations

1. **Explicit Phases**: Clear workflow visibility
2. **Approval Gates**: User control at critical points
3. **Quality Metrics**: Data-driven quality assurance
4. **Feedback Loops**: Automatic issue resolution
5. **TDD-First**: Red-green-refactor built-in

## ⚡ Summary

```
Traditional AI Coding Assistant:
User Request → Magic Black Box → Code Output

EverFern Multi-Agent System:
User Request
  → Exploration Phase (understand codebase)
  → Planning Phase (strategic plan) [approval gate]
  → Implementation Phase (write code)
  → Review Phase (quality check) [feedback loop]
  → Testing Phase (TDD cycle)
  → Production-Ready Code
```

**Result**: Professional-grade development with full transparency and control.

---

**Status**: Ready to Use
**Version**: 1.0.0
**Last Updated**: June 2, 2026
