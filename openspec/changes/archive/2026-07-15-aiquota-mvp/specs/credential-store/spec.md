# Credential Store Specification

## Purpose

Provider credentials (cookies, tokens) are stored encrypted at rest via Electron `safeStorage`, keyed by instance, never in plaintext or logs, and only ever transmitted to each provider's official domain.

## Requirements

### Requirement: Encrypted-at-Rest Storage Keyed by Instance

All credentials MUST be encrypted using Electron `safeStorage` (backed by the OS keychain: Secret Service/kwallet on Linux, DPAPI/Credential Manager on Windows) and stored keyed by `instanceId`. Credentials MUST NOT be persisted in plaintext in any config file or on disk in any recoverable unencrypted form.

#### Scenario: Credential stored via safeStorage
- GIVEN a user completes login for a provider instance
- WHEN the resulting credential is persisted
- THEN it is encrypted through `safeStorage` and stored under that instance's `instanceId`, with no plaintext copy written anywhere

#### Scenario: Config file contains no secrets
- GIVEN the app's settings/config file is inspected
- WHEN searched for credential values
- THEN no plaintext token or cookie value is found

### Requirement: No Plaintext Credentials in Logs

Application logs (including debug/diagnostic output) MUST NOT contain plaintext credential values. Any diagnostic representation of a credential SHOULD be masked.

#### Scenario: Masked value in diagnostic output
- GIVEN a credential-related error occurs and is logged
- WHEN the log entry is inspected
- THEN the credential value is absent or masked, not printed in full

### Requirement: Domain-Restricted Credential Transmission

Credentials MUST only be sent in requests to the corresponding provider's official domain (e.g., `claude.ai`, `chatgpt.com`). They MUST NOT be transmitted to any third-party or analytics domain.

#### Scenario: Credential scoped to official domain
- GIVEN a Claude instance's session cookie is used for a fetch
- WHEN the request is made
- THEN it targets only `claude.ai` endpoints and the cookie is not attached to any other domain's requests

### Requirement: Per-Instance Credential Isolation

Credentials for one instance MUST NOT be readable or usable by another instance, matching each instance's isolated session partition.

#### Scenario: Isolation between two instances of the same provider
- GIVEN two Codex instances each have their own stored credential
- WHEN one instance's adapter runs
- THEN it retrieves only its own credential, never the other instance's

### Requirement: Secure Credential Deletion

Removing or resetting a provider instance MUST securely delete its stored credential from the encrypted store.

#### Scenario: Deleting an instance removes its credential
- GIVEN a provider instance is removed by the user
- WHEN the removal completes
- THEN no encrypted credential entry remains for that instance's `instanceId`
