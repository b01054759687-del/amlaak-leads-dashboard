# Changelog — Software Delivery Orchestrator Agent

All notable changes to the Software Delivery Orchestrator Agent framework will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-10

### Added
- Initialized official Software Delivery Orchestrator Agent (`software-delivery-orchestrator`).
- Integrated main skill: `ai-workspace-delivery-governor`.
- Implemented 3 adaptive execution modes: Quick Mode, Standard Mode, and Controlled Release Mode.
- Established 4 operational capability workflows in `workflows/`.
- Codified 3 core governance policies in `policies/` (Approval Gates, Git Safety, Testing Order).
- Created local validation test suites in `tests/`.
- Registered agent in `04-REGISTRY/agents-registry.json` and `04-REGISTRY/assets-registry.json`.
- Configured cross-tool adapter projections for Antigravity, Claude Code, Cursor, and Windsurf.
