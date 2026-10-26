# BlueGuardian Feature Backlog

## P0 — must have
- secure connection policy before pairing
- trust score and risk evaluation for every device
- block or approval decisions for unknown or risky devices
- file transfer safety checks for suspicious payload types
- wearable restriction rules for audio-only or restricted access
- local-first persistence of policy and action history

## P1 — high value
- Fast Pair approval flow
- RSSI anomaly detection and warnings
- device trust workflow with manual review
- device blocking and unblocking controls
- security action timeline and reason logging
- improved threat severity model and confidence scoring

## P2 — important enhancements
- alert thresholds and notification summaries
- device history and trust timeline
- cross-device correlation for repeated malicious behavior
- richer policy controls for advanced users
- exportable security reports

## P3 — future platform expansion
- mobile companion app integration
- OS-level Bluetooth policy bridge
- enterprise policy templates
- centralized compliance dashboards
- remote policy sync for managed fleets

## Story map
### Discovery
- scan and identify Bluetooth devices
- classify manufacturer, type, and risk context

### Assessment
- compute trust score
- detect proximity anomalies
- compare device state against policy thresholds

### Enforcement
- block unsafe devices
- require approval for unknown or medium-risk devices
- restrict file transfer and wearable access

### Visibility
- display risk summaries in the dashboard
- store action history for audit and review
- explain risk with clear reasoning

## Definition of done
A feature is complete when it is:
- enforced by the codified security policy
- covered by a test or validation scenario
- visible in the dashboard or settings flow
- persisted locally when policy or action impacts user trust
- aligned with secure-by-default behavior
