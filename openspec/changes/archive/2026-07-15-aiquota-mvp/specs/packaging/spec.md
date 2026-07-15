# Packaging Specification

## Purpose

Defines the build/installer targets and the test tooling bootstrap required before Strict TDD can be enforced on the greenfield repo.

## Requirements

### Requirement: Electron-Builder Installer Targets

The project MUST produce installable packages via electron-builder for AppImage and `.deb` on Linux, and NSIS `.exe` on Windows. macOS MUST NOT be targeted in this MVP.

#### Scenario: Linux installers built
- WHEN the Linux build target is run
- THEN an AppImage and a `.deb` package are produced

#### Scenario: Windows installer built
- WHEN the Windows build target is run
- THEN an NSIS `.exe` installer is produced

### Requirement: Launchable Build Output

Each produced installer MUST result in an application that launches successfully with the tray icon visible and responsive to its context menu.

#### Scenario: Fresh install launches
- GIVEN a user installs the AppImage/.deb or the NSIS `.exe`
- WHEN they launch the app
- THEN the tray icon appears and the context menu opens on click

### Requirement: Test Tooling Bootstrap

Since no test runner exists in the greenfield repo, this change MUST set up Vitest as the test runner before or alongside the first testable feature, satisfying Strict TDD for all subsequent implementation tasks.

#### Scenario: Test runner available before first feature test
- GIVEN the repo currently has no test runner
- WHEN the first testable unit (e.g., an adapter parser or the color-aggregation function) is implemented
- THEN a Vitest suite already exists and can run a RED test for it before the implementation lands
