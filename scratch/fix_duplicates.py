import os

filepath = r"c:\Users\srini\Downloads\EverFern\everfern-desktop\apps\desktop\src\app\chat\page.tsx"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

original_content = content
content = content.replace('\r\n', '\n')

# 0. Define hasActiveSecurityQuestion helper before "// ── Render ──"
render_start = "// ── Render ───────────────────────────────────────────────────────────────"
definition = """    const hasActiveSecurityQuestion = activeUserQuestions.some(q =>
        q.question.includes('Security Check Required') ||
        q.question.includes('High-risk action requires your approval') ||
        q.question.includes('Actions to execute:')
    );

    """

if render_start in content and "hasActiveSecurityQuestion" not in content:
    content = content.replace(render_start, definition + render_start)
    print("Added helper definition successfully!")
else:
    print("WARNING: Render start not found or definition already exists!")

# 1. Target for empty state forms block
target_empty_block = """                                                {/* User Question Form (single or multiple questions) */}
                                                {activeUserQuestions.length > 0 && (
                                                    <UserQuestionForm
                                                        questions={activeUserQuestions}
                                                        onSubmit={handleQuestionSubmit}
                                                        previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                                    />
                                                )}

                                                {/* HITL Approval Form */}
                                                {showHitlApproval && hitlRequest && (
                                                    <HitlApprovalForm
                                                        request={hitlRequest}
                                                        onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                        onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                                    />
                                                )}"""

if target_empty_block in content:
    content = content.replace(target_empty_block, "")
    print("Successfully removed forms from empty state!")
else:
    print("WARNING: target_empty_block not found precisely!")

# 2. Target for non-empty composer forms block
target_nonempty_block = """                                             {/* User Question Form (single or multiple questions) */}
                                             {activeUserQuestions.length > 0 && (
                                                 <div style={{ padding: '16px 20px 0' }}>
                                                     <UserQuestionForm
                                                         questions={activeUserQuestions}
                                                         onSubmit={handleQuestionSubmit}
                                                         previewMarkdown={activeUserQuestions[0]?.previewMarkdown}
                                                     />
                                                 </div>
                                             )}

                                             {/* HITL Approval Form */}
                                             {showHitlApproval && hitlRequest && (
                                                 <div style={{ padding: '16px 20px 0' }}>
                                                     <HitlApprovalForm
                                                         request={hitlRequest}
                                                         onApprove={(sendMessage) => handleHitlApproval(true, sendMessage)}
                                                         onReject={(sendMessage) => handleHitlApproval(false, sendMessage)}
                                                     />
                                                 </div>
                                             )}"""

if target_nonempty_block in content:
    content = content.replace(target_nonempty_block, "")
    print("Successfully removed forms from non-empty composer!")
else:
    print("WARNING: target_nonempty_block not found precisely!")

# 3. Target for blue banner in streaming bubble
target_blue_banner = """                                                 {(activeUserQuestions.length > 0 || showHitlApproval) && (
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
    print("WARNING: target_blue_banner not found precisely!")

# 4. Target for inserting forms before messagesEndRef
target_end_anchor = "                                     <div ref={messagesEndRef} />"
replacement_end_anchor = """                                     {/* Inline Forms at the bottom of chat history */}
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

if target_end_anchor in content:
    content = content.replace(target_end_anchor, replacement_end_anchor)
    print("Successfully added forms inline before messagesEndRef!")
else:
    print("WARNING: target_end_anchor not found precisely!")

# Restore line endings
if '\r\n' in original_content:
    content = content.replace('\n', '\r\n')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Relocation completed!")
