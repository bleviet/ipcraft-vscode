---
trigger: always_on
---

## Architecture and modularity

1. Preserve a clear dependency direction:
   `types and pure utilities -> services/controllers/hooks -> components -> application roots`.
   Lower layers must not import React components or application roots. Do not
   introduce circular imports.
2. Keep application roots and large components as composition boundaries.
   They may wire state, lifecycle, and feature modules together, but must not
   also accumulate domain transformations, protocol construction, geometry,
   validation rules, or feature-specific state machines.
3. Give each module one cohesive reason to change. Before extending an existing
   module, identify its responsibility and the existing seam that owns the
   behavior. If the change adds a second responsibility, extract a focused
   module instead of growing the catch-all.
4. Make dependencies explicit with narrow typed props, arguments, and return
   values. Do not hide feature dependencies in mutable module-level state, a
   broad context object, or imports from a higher layer.
5. Keep domain transformations, geometry, validation, and message construction
   in named pure functions where practical. Hooks adapt React or browser
   lifecycle; components render and translate user intent into typed actions.
6. Maintain one source of truth for shared behavior. When the same interaction
   or calculation exists on multiple surfaces, extract the common mechanism
   and configure it through typed inputs. Do not copy fixes between parallel
   implementations or create slightly different formulas.
7. Keep abstractions feature-local until there is a second concrete consumer or
   a stable architectural boundary. Reuse is not a reason to create a broad
   global helper, context, or generic framework prematurely.
8. Treat production module size as a design signal, not a mechanical target.
   Aim for roughly 400 lines or fewer. At 500 lines, review the module for
   separable controls, transformations, state machines, or subfeatures before
   adding more. A larger module is acceptable only when it remains cohesive;
   record the reason in the relevant architecture document or module comment.
   Generated files, declarative data, and templates are excluded.
9. Preserve behavioral and transactional boundaries during extraction. One
   user gesture must retain its existing update, undo, validation, focus, and
   message semantics. Do not disguise behavior changes as refactoring.
10. For risky refactors, first add characterization tests at the current public
    boundary. Add direct unit tests for extracted pure logic and focused
    component or browser tests for keyboard, focus, drag, selection, and
    cross-process workflows.
