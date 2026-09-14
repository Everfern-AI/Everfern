'use client';
import { motion } from 'framer-motion';
import { SectionTitle, SectionSubtitle, Card, Label } from './ui';

/** Static "Architecture & Help" panel — renders a LangGraph DAG diagram and
 *  explains the Swarm architecture. No props or state. */
export function HelpSection() {
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <SectionTitle>Architecture & Help</SectionTitle>
            <SectionSubtitle>Understand how the EverFern AI Brain and Swarm Architecture works.</SectionSubtitle>

            <Card>
                <Label>System Architecture (LangGraph)</Label>
                <div style={{
                    marginTop: 20,
                    padding: 24,
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 16,
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 16
                }}>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', maxWidth: 500, marginBottom: 20 }}>
                        EverFern uses a state-of-the-art Directed Acyclic Graph (DAG) powered by LangGraph to orchestrate complex reasoning and autonomous actions.
                    </div>

                    {/* Visual Graph Representation */}
                    <div style={{ position: 'relative', width: '100%', maxWidth: 600, height: 450, display: 'flex', justifyContent: 'center' }}>
                        <svg width="100%" height="100%" viewBox="0 0 400 450">
                            {/* Lines/Edges */}
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orientation="auto">
                                    <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-text-tertiary)" />
                                </marker>
                            </defs>

                            {/* START -> Triage */}
                            <path d="M 200 20 L 200 50" stroke="var(--color-text-tertiary)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Triage -> Decomposer */}
                            <path d="M 200 90 L 200 120" stroke="var(--color-text-tertiary)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Decomposer -> Swarm/Planner */}
                            <path d="M 200 160 L 100 200" stroke="var(--color-text-tertiary)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            <path d="M 200 160 L 300 200" stroke="var(--color-text-tertiary)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Swarm/Planner -> Brain */}
                            <path d="M 100 240 L 190 280" stroke="var(--color-text-tertiary)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            <path d="M 300 240 L 210 280" stroke="var(--color-text-tertiary)" strokeWidth="2" markerEnd="url(#arrowhead)" />
                            {/* Brain -> Specialists */}
                            <path d="M 200 320 L 100 360" stroke="var(--color-navis-active-border)" strokeWidth="2" strokeDasharray="4,4" markerEnd="url(#arrowhead)" />
                            <path d="M 200 320 L 300 360" stroke="var(--color-navis-active-border)" strokeWidth="2" strokeDasharray="4,4" markerEnd="url(#arrowhead)" />
                            {/* Specialists -> Brain */}
                            <path d="M 80 380 Q 20 380 20 300 Q 20 220 180 290" stroke="var(--color-navis-active-border)" strokeWidth="1" opacity="0.4" fill="none" markerEnd="url(#arrowhead)" />

                            {/* Nodes */}
                            <circle cx="200" cy="20" r="10" fill="var(--color-success)" />
                            <text x="200" y="20" fontSize="8" fontWeight="700" textAnchor="middle" dy=".3em" fill="white">START</text>

                            <rect x="150" y="50" width="100" height="40" rx="8" fill="var(--color-bg-surface)" stroke="var(--color-border)" strokeWidth="2" />
                            <text x="200" y="70" fontSize="11" fontWeight="600" textAnchor="middle" dy=".3em" fill="var(--color-text-primary)">Triage</text>

                            <rect x="150" y="120" width="100" height="40" rx="8" fill="var(--color-bg-surface)" stroke="var(--color-border)" strokeWidth="2" />
                            <text x="200" y="140" fontSize="11" fontWeight="600" textAnchor="middle" dy=".3em" fill="var(--color-text-primary)">Decomposer</text>

                            <rect x="50" y="200" width="100" height="40" rx="8" fill="var(--color-warning-dim)" stroke="var(--color-warning)" strokeWidth="2" />
                            <text x="100" y="220" fontSize="11" fontWeight="700" textAnchor="middle" dy=".3em" fill="var(--color-warning)">🐝 Swarm</text>

                            <rect x="250" y="200" width="100" height="40" rx="8" fill="var(--color-bg-surface)" stroke="var(--color-border)" strokeWidth="2" />
                            <text x="300" y="220" fontSize="11" fontWeight="600" textAnchor="middle" dy=".3em" fill="var(--color-text-primary)">Planner</text>

                            <rect x="150" y="280" width="100" height="40" rx="8" fill="var(--color-text-primary)" stroke="var(--color-text-primary)" strokeWidth="2" />
                            <text x="200" y="300" fontSize="11" fontWeight="700" textAnchor="middle" dy=".3em" fill="var(--color-text-inverse)">🧠 Brain</text>

                            <rect x="50" y="360" width="100" height="40" rx="8" fill="var(--color-navis-active-bg)" stroke="var(--color-navis-active-border)" strokeWidth="2" />
                            <text x="100" y="380" fontSize="10" fontWeight="600" textAnchor="middle" dy=".3em" fill="var(--color-navis-active-text)">Specialists</text>

                            <rect x="250" y="360" width="100" height="40" rx="8" fill="var(--color-bg-surface)" stroke="var(--color-border)" strokeWidth="2" />
                            <text x="300" y="380" fontSize="10" fontWeight="600" textAnchor="middle" dy=".3em" fill="var(--color-text-primary)">Tool Orchestrator</text>
                        </svg>
                    </div>
                </div>
            </Card>

            <Card>
                <Label>What is a Swarm?</Label>
                <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    A <strong>Swarm</strong> is a collective of specialized agents working in parallel to solve a complex task.
                    Unlike traditional agents that work one-by-one, EverFern's Swarm Architecture allows multiple "bees" to
                    investigate different sources or perform different tasks simultaneously, while sharing a
                    <strong> synchronized memory bus</strong> so they never repeat work.
                </div>
            </Card>
        </motion.div>
    );
}
