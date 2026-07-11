# Error Handling Centralization

**Status:** Implemented — `handleErrorWithUserNotification` is now used across the command/service files listed below; remaining direct `showErrorMessage` calls are the guard-clause validation messages this plan intentionally excluded.
**Branch:** `fix/error-handling-centralization`
**Description:** Route all catch-block error notifications through `handleErrorWithUserNotification` and add explanatory comments to empty catch blocks.

## Goal

The code review identified two gaps: (1) `ErrorHandler.ts` is almost entirely bypassed — catch blocks call `vscode.window.showErrorMessage` directly, so errors are not logged to the IPCraft output channel and users never see the "Show Logs" action button; (2) several empty `catch {}` blocks have no comment explaining the intent.

Guard-clause validation messages (e.g. "No .qpf file selected") are **not** in catch blocks and have no error to log — they are left as direct `showErrorMessage` calls.

## Implementation Steps

### Step 1: Route catch-block errors through ErrorHandler (issue 1.1)

**Files:**
- `src/commands/BuildCommands.ts`
- `src/commands/FileCreationCommands.ts`
- `src/commands/GenerateCommands.ts`
- `src/commands/ScaffoldPackCommands.ts`
- `src/commands/copyComponentInstance.ts`
- `src/commands/editInIpPackager.ts`
- `src/commands/scanVivadoInterfaces.ts`
- `src/commands/scanWorkspaceBusDefinitions.ts`
- `src/extension.ts`
- `src/services/WebviewRouter.ts`

**What:** In every `catch` block that currently calls `vscode.window.showErrorMessage` (and sometimes `logger.error`), replace with `void handleErrorWithUserNotification(error, 'context', 'user message')`. This logs the error via the centralized ErrorHandler logger AND shows the notification with a "Show Logs" action button. For files that had both `logger.error` + `showErrorMessage`, both calls are replaced by the single `handleErrorWithUserNotification` call.

**Testing:** Run `npm run lint` (zero warnings). Manually trigger an error in each command (e.g. open an IP core file with missing vlnv.name, run a Vivado scan with bad config) — verify the notification has "Show Logs" and clicking it opens the IPCraft output channel.

### Step 2: Add explanatory comments to empty catch blocks (issue 1.2)

**Files:**
- `src/commands/GenerateCommands.ts` (2 catches: file-not-found → 'new' status; description helper → return '')
- `src/providers/IpCoreEditorProvider.ts` (3 catches: existsAny dir read; file-stat existence check; readdirSync packs dir)
- `src/services/SubcoreResolver.ts` (1 catch: update minimal `// ignore` comment)

**What:** Add an inline comment inside each empty catch block that explains why the error is intentionally swallowed.

**Testing:** `npm run lint` (zero warnings). Visual inspection.
