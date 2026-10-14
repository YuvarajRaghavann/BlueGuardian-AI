# BlueGuardian Technical Architecture

## Overview
BlueGuardian is structured as a local-first security dashboard and policy engine for Bluetooth device trust, protection, and connection decisions.

## System layers

### 1. Device discovery layer
Responsible for collecting Bluetooth devices, metadata, and connection context. This includes:
- device name
- type and manufacturer
- trust score signal
- connection status
- proximity quality (RSSI)
- discovery source

### 2. Trust and risk engine
This is the decision layer that evaluates whether a device is safe to connect, trusted enough to approve, or should be blocked. It uses:
- known device status
- trust score
- risk level
- Fast Pair and quick-connect context
- signal strength checks
- wearable restrictions

### 3. Policy engine
The policy engine is a pure rule-based decision model with clear actions:
- ALLOW
- REQUIRE_APPROVAL
- BLOCK

This keeps the logic testable, explainable, and independent from UI concerns.

### 4. File transfer guard
The transfer guard inspects file names and transfer context before a file is accepted. It reuses the same trust and risk policy model to prevent known dangerous paths.

### 5. Threat and action layer
This layer records device actions, threat events, trust decisions, and user approvals. It persists locally using IndexedDB and exposes the security action history.

### 6. UI and controls layer
The frontend surfaces risk states and policy settings, enabling users to:
- review device trust
- approve or block a device
- adjust policy preferences
- review file transfer safety
- monitor wearable restrictions

## Key modules
- `src/context/DeviceContext.tsx` — active device state and device mutation flow
- `src/context/SecurityContext.tsx` — policy and action enforcement
- `src/context/ThreatContext.tsx` — threat lifecycle tracking
- `src/services/localDatabase.ts` — local persistence
- `src/services/localSettings.ts` — persisted policy settings
- `src/utils/connectionPolicy.ts` — Bluetooth trust and file security decisions
- `src/utils/trustScore.ts` — scoring logic
- `src/utils/threatDetection.ts` — threat heuristics

## Security principles
- fail safe rather than silently trust
- favor explicit user approval for unknown devices
- keep decisions local-first and privacy-preserving
- evaluate device state before connections and transfers
- separate risk calculation from action enforcement

## Data flow
1. Device discovered
2. Metadata is normalized into a device record
3. Trust and risk engine evaluates the device
4. Policy engine returns a connection or file-transfer decision
5. UI surfaces status and actions
6. Local persistence stores security actions and policy state

## Risks addressed
- malicious spoofed Bluetooth devices
- risky pairing events during Fast Pair flows
- abnormal RSSI spikes or proximity manipulations
- unauthorized file transfers
- over-trusted wearable access

## Deployment characteristics
BlueGuardian is designed for local-first usage on a user workstation or mobile environment, with optional integration into a broader endpoint security stack later. The current architecture is intentionally lightweight and transparent.
