# Workflow: Adaptive Execution Mode Selection (`adaptive-execution`)

## Purpose
Autonomously evaluate task risk, blast radius, and external dependencies to select between Quick Mode, Standard Mode, and Controlled Release Mode.

## Inputs
- User prompt and issue description.
- Git working tree inspection.
- Target files and repository topology.

## Execution Steps
1. **Analyze Scope**: Count affected files and determine if architectural, database, or external APIs are touched.
2. **Evaluate Risk**:
   - If 1 isolated file, local logic, no external systems ➔ Select **Quick Mode**.
   - If multi-file, new feature, internal refactoring ➔ Select **Standard Mode**.
   - If touches authentication, customer data, cloud resources, or production deploy ➔ Select **Controlled Release Mode**.
3. **Declare Mode**: State selected mode and explicit rationale in initial response.

## Outputs
- Mode declaration statement and tailored delivery layer execution plan.
