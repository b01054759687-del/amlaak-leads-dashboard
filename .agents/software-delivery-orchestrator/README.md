# Software Delivery Orchestrator Agent (`software-delivery-orchestrator`)

> **Role:** Official Software Engineering & Delivery Governance Agent  
> **Version:** 1.0.0  
> **Status:** TESTING  
> **Category:** Engineering  
> **Main Skill:** `ai-workspace-delivery-governor`  
> **Portability:** Antigravity, Claude Code, Cursor, Windsurf  

---

## 1. Overview
The **Software Delivery Orchestrator** governs the end-to-end software delivery lifecycle across projects within the Personal AI Operating System. It ensures that AI-assisted code generation satisfies rigorous software engineering standards, evidence-based testing, source-control safety, and defensive human approval gates.

---

## 2. Adaptive Execution Modes
- **Quick Mode**: For simple one-file fixes and minor refactors. Lightweight, non-intrusive.
- **Standard Mode**: For multi-file features and internal architectural changes. Enforces branching, testing, and double-builds.
- **Controlled Release Mode**: For production-facing changes, migrations, cloud infrastructure, and external integrations. Enforces full 14 layers and approval gates (Gates A through E).

---

## 3. Directory Structure
```text
02-AI-ASSETS/agents/engineering/software-delivery-orchestrator/
├── AGENT.md                 # Core agent prompt and instructions
├── README.md                # Architectural documentation
├── metadata.json            # Machine-readable manifest (PAI-OS schema v2.0.0)
├── CHANGELOG.md             # Version history
├── workflows/               # Operational capability workflows
├── policies/                # Governing security and safety policies
└── tests/                   # Package validation tests
```

---

## 4. Cross-Project Decoupling
This agent contains **zero client-specific or company-proprietary IDs, credentials, or links**. All repository-specific configurations (build commands, deployment targets, test suites) are loaded dynamically from project adapters or repository instructions.
