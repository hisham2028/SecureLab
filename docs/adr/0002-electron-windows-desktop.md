# ADR 0002: Electron desktop client, Windows first

- Status: Accepted
- Date: 2026-11-17

## Context

The student client needs Monaco, local draft persistence, auto-update, OS focus events and,
later, integration with managed-lab kiosk policy. The roadmap suggested Electron or Tauri.

## Decision

- Electron, targeting Windows only for the MVP pilot. Installer built with electron-builder (NSIS,
  per-machine) so lab admins can deploy it.
- Renderer is sandboxed: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, all
  navigation and new windows blocked, all permission requests denied. The renderer reaches the
  OS only through a short typed preload bridge.
- Monaco is bundled locally; nothing loads from a CDN.
- Local drafts are written atomically and encrypted with Electron `safeStorage` (DPAPI on
  Windows). The server copy is authoritative.

## Consequences

- Larger installer and memory use than Tauri; accepted for less integration work.
- Full screen is not lockdown. Real lockdown is an OS / device-management capability (release 1.2).
- Sandboxed preloads cannot `require` local files, so channel names are duplicated in
  `preload.ts`; a unit test keeps them in sync.

## Verified

Linux smoke test under Xvfb: the bridge is exposed, Node is not, and a draft typed into Monaco
survives an app restart. Windows behaviour is covered by the CI packaging job only so far; a
manual install on a target lab machine is still needed.
