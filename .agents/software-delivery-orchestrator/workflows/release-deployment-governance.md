# Workflow: Release & Deployment Governance (`release-deployment-governance`)

## Purpose
Govern the promotion of software from local implementation through staging, UAT, production deployment, and post-deployment verification.

## Inputs
- Verified build artifacts.
- Gate E Approval Dossier.

## Execution Steps
1. **Compile Gate Dossier**: Document exact action, target, expected effect, risk, and rollback method.
2. **Halt for Approval**: Await explicit human operator sign-off at Gates D and E.
3. **Execute Deployment**: Trigger authorized deployment pipeline.
4. **Run Live Smoke Tests**: Verify production endpoints return HTTP 200 and error logs remain clean.
5. **Verify Rollback & Handover**: Ensure rollback commit is ready; complete handover dossier.

## Outputs
- Verified production release report and archived release record.
