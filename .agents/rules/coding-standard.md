---
trigger: always_on
---

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity, readability, maintainability, performance, security, and conciseness.
3. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause and prove that the issues are fixed.
4. Review the code and fix all errors and warnings so it completely passes `npm run lint` before committing to git.

## CRITICAL NAMING CONVENTION RULE:

1. TypeScript, React, & JSON Schema: STRICTLY enforce camelCase for all properties, interfaces, and state (e.g., allowedValues, uiGroup, dataType). NEVER use, define, or read snake_case fields in these domains.
2. No Fallbacks / Dual-State: Do not write duplicate fallback logic to handle mixed casings (e.g., NEVER write param.uiGroup ?? param.ui_group). The data model must remain strictly camelCase.
3. Jinja2 Templates ONLY: snake_case is strictly reserved for variables used inside Jinja2 template contexts.
4. If generating or modifying TS/JS code, verify that no snake_case properties are leaking into the AST, React props, or Schema.