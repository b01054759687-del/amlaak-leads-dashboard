# Workflow: Code Review Governance (`code-review-governance`)

## Purpose
Inspect and audit AI-generated code or pull requests for adherence to evidence integrity, secret isolation, and architectural bounds.

## Inputs
- Diff or pull request contents.
- Existing codebase source files.

## Execution Steps
1. **Inspect Raw Code**: Review actual lines modified; check for syntax and type safety.
2. **Audit Evidence**: Verify that claimed test results represent real test executions, not mocks or static analysis.
3. **Scan Secrets**: Execute regex check for hardcoded credentials.
4. **Enforce Source First**: Ensure modifications were made to source files (`src/`), not generated bundles (`dist/`).

## Outputs
- Objective, evidence-backed code review report with line-specific findings.
