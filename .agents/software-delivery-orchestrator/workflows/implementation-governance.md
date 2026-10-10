# Workflow: Implementation Governance (`implementation-governance`)

## Purpose
Govern the execution of local code changes, branch isolation, and build reproducibility.

## Inputs
- Requirements specification.
- Clean git branch.

## Execution Steps
1. **Quarantine Dirty Worktree**: Verify clean git status; create isolated feature branch (`feat/<name>`).
2. **Apply Source-First Changes**: Modify only authoritative source files.
3. **Run Ordered Tests**: Execute stages 01 through 07 (Source inspection, static checks, unit tests, build verification).
4. **Deterministic Second Build**: Run build twice consecutively; verify zero unintended diff.

## Outputs
- Verified local implementation matching requirements with clean git history.
