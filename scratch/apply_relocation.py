import os

filepath = r"c:\Users\srini\Downloads\EverFern\everfern-desktop\apps\desktop\src\app\chat\page.tsx"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

original_content = content
content = content.replace('\r\n', '\n')

# 1. Helper definition
render_start = "// ── Render ───────────────────────────────────────────────────────────────"
if render_start in content:
    definition = """    const hasActiveSecurityQuestion = activeUserQuestions.some(q =>
        q.question.includes('Security Check Required') ||
        q.question.includes('High-risk action requires your approval') ||
        q.question.includes('Actions to execute:')
    );

"""
    content = content.replace(render_start, definition + render_start)
    print("Added helper definition successfully!")
else:
    print("ERROR: Render start not found!")

# Let's define the exact blocks to remove:
# Empty state UQ block:
empty_uq_block = """                                                {/* User Question Form (single or multiple questions) */}
                                                {activeUserQuestions.length > 0 && (
                                                    <UserQuestionForm
                                                        questions={activeUserQuestions}
                                                        onSubmit={handleQuestionSubmit}
                                                        previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                                    />
                                                )}"""

# Empty state HITL block:
empty_hitl_block = """                                                {/* HITL Approval Form */}
                                                {showHitlApproval && hitlRequest && (
                                                    <HitlApprovalForm
                                                        request={hitlRequest}
                                                        onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                        onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                                    />
                                                )}"""

# Active state UQ block:
active_uq_block = """                                             {/* User Question Form (single or multiple questions) */}
                                             {activeUserQuestions.length > 0 && (
                                                 <div style={{ padding: '16px 20px 0' }}>
                                                     <UserQuestionForm
                                                         questions={activeUserQuestions}
                                                         onSubmit={handleQuestionSubmit}
                                                         previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                                     />
                                                 </div>
                                             )}"""

# Active state HITL block:
active_hitl_block = """                                             {/* HITL Approval Form */}
                                             {showHitlApproval && hitlRequest && (
                                                 <div style={{ padding: '16px 20px 0' }}>
                                                     <HitlApprovalForm
                                                         request={hitlRequest}
                                                         onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                         onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                                     />
                                                 </div>
                                             )}"""

# Apply replacements:
if empty_uq_block in content:
    content = content.replace(empty_uq_block, "")
    print("Removed empty state UQ block")
else:
    print("WARNING: empty_uq_block not found!")

if empty_hitl_block in content:
    content = content.replace(empty_hitl_block, "")
    print("Removed empty state HITL block")
else:
    print("WARNING: empty_hitl_block not found!")

if active_uq_block in content:
    content = content.replace(active_uq_block, "")
    print("Removed active state UQ block")
else:
    print("WARNING: active_uq_block not found!")

if active_hitl_block in content:
    content = content.replace(active_hitl_block, "")
    print("Removed active state HITL block")
else:
    print("WARNING: active_hitl_block not found!")

# Remove blue "Waiting for your input" banner
target_blue_banner = """                                                {(activeUserQuestions.length > 0 || showHitlApproval) && (
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        padding: '16px 20px',
                                                        backgroundColor: '#f0f9ff',
                                                        border: '1px solid #bfdbfe',
                                                        borderRadius: 8,
                                                        margin: '16px 20px',
                                                        color: '#1e40af',
                                                        fontSize: 14,
                                                        fontWeight: 600
                                                    }}>
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <circle cx="12" cy="12" r="10"/>
                                                            <path d="M9,9h6v6H9z"/>
                                                        </svg>
                                                        Waiting for your input
                                                    </div>
                                                )}"""

if target_blue_banner in content:
    content = content.replace(target_blue_banner, "")
    print("Successfully removed blue status banner!")
else:
    print("WARNING: target_blue_banner not found!")

# Insert inline forms before messagesEndRef
ref_idx = content.find("<div ref={messagesEndRef} />")
if ref_idx != -1:
    replacement_end_anchor = """{/* Inline Forms at the bottom of chat history */}
                                     {activeUserQuestions.length > 0 && (
                                         <div style={{ margin: '16px auto', maxWidth: 800, padding: '0 20px', width: '100%' }}>
                                             <UserQuestionForm
                                                 questions={activeUserQuestions}
                                                 onSubmit={handleQuestionSubmit}
                                                 previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                             />
                                         </div>
                                     )}

                                     {showHitlApproval && hitlRequest && !hasActiveSecurityQuestion && (
                                         <div style={{ margin: '16px auto', maxWidth: 800, padding: '0 20px', width: '100%' }}>
                                             <HitlApprovalForm
                                                 request={hitlRequest}
                                                 onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                 onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                             />
                                         </div>
                                     )}

                                     <div ref={messagesEndRef} />"""
    
    line_start = content.rfind("\n", 0, ref_idx) + 1
    indentation = content[line_start:ref_idx]
    print(f"Found messagesEndRef with indentation length: {len(indentation)}")
    
    replacement_lines = []
    for line in replacement_end_anchor.split("\n"):
        stripped = line.strip()
        if stripped:
            replacement_lines.append(indentation + stripped)
        else:
            replacement_lines.append("")
            
    final_replacement = "\n".join(replacement_lines)
    content = content[:line_start] + final_replacement + content[ref_idx + len("<div ref={messagesEndRef} />"):]
    print("Successfully added inline forms before messagesEndRef!")
else:
    print("ERROR: Could not find messagesEndRef")

# Restore line endings
if '\r\n' in original_content:
    content = content.replace('\n', '\r\n')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Relocation completed!")
