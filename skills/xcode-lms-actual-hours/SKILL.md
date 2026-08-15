---
name: xcode-lms-actual-hours
description: Inspect, implement, refactor, or review Swift/Xcode projects that manage learner Attendance, Aptem Assignments, LMS Actual Hours, timestamps, manual overrides, auditor approvals, revision history, and analytics. Use when the user asks ChatGPT or Codex to add or verify Actual Hours rules in an iOS or macOS codebase, especially Europe/London working-hours validation, Reading/Quiz and Video/Audio duration classification, 23%/77% source analytics, 7.5% source exceptions, 9.3% long-tail analytics, and second-person approval. Preserve genuine submitted records; use ranges and percentages only for validation and reporting, never to fabricate timestamps or hours.
---

# Xcode LMS Actual Hours

Apply the LMS Actual Hours requirements consistently to an existing Swift/Xcode repository or produce a ready-to-paste VS Code Codex task prompt.

## Select the workflow

1. If the user asks for a Codex prompt, adapt and return `references/vscode-codex-prompt.md`.
2. If a repository is available, inspect it and implement the requirements.
3. If the user asks for a review, compare the repository against `references/product-requirements.md` and report concrete gaps with file and symbol references.

Read `references/product-requirements.md` before implementation or review. Read `references/vscode-codex-prompt.md` when generating a standalone Codex instruction file.

## Non-negotiable integrity rules

- Treat the data as real submitted learner records.
- Never fabricate, randomize, shift, or silently replace Actual Hours, timestamps, pauses, activity sources, Attendance values, or Aptem Assignment values.
- Keep existing Attendance logic unchanged.
- Keep existing Assignment and Aptem logic unchanged.
- Derive Time Stamped duration only from genuine timestamps and genuine pause data.
- Use percentages and duration ranges only for validation, classification, analytics, and review.
- Preserve source values and every approved or rejected revision.
- Flag invalid or unusual records instead of rewriting them.

If a requested change would violate these rules, implement the closest compliant validation or review workflow and state the difference clearly.

## Repository workflow

### 1. Discover the project

- Locate `.xcworkspace`, `.xcodeproj`, `Package.swift`, schemes, targets, and tests.
- Identify the persistence layer: SwiftData, Core Data, Realm, SQLite, CloudKit, server API, or another mechanism.
- Locate Attendance logic, Aptem integration, LMS activity models, Actual Hours fields, source enums, activity types, media duration, user roles, submissions, approvals, and audit history.
- Search for existing services and validators before creating new ones.
- Determine whether a data migration is required.

Provide a concise inspection summary, then continue unless the repository is genuinely missing a critical dependency.

### 2. Plan minimal changes

Prefer adapting existing architecture. Avoid duplicate models or parallel business-rule implementations.

Keep business rules out of SwiftUI views. Prefer focused components such as:

- `ActualHoursService`
- `LMSActualHoursValidator`
- `UKWorkingHoursValidator`
- `ActualHoursAuditService`
- `ActualHoursApprovalService`
- `LMSActualHoursAnalyticsService`

Use names that match the repository's conventions when equivalent types already exist.

### 3. Implement the rules

Implement the exact constants, classifications, permissions, audit behavior, analytics formulas, and edge cases in `references/product-requirements.md`.

Use integer seconds for stored durations. Use `TimeZone(identifier: "Europe/London")` and a calendar configured with that timezone. Do not use a fixed UTC offset.

Use a structured validation result rather than scattered booleans. Preserve raw source evidence alongside any approved manual override.

### 4. Implement authorization and approval

- Allow only Auditors to propose changes to submitted Actual Hours.
- Enforce authorization in the service or domain layer, not only in the UI.
- Require a second authorized Auditor to approve or reject a revision.
- Prevent self-approval.
- Keep proposed revisions separate from the approved live value until approval unless the existing architecture has an equally safe versioned approach.
- Keep reason and supporting evidence optional.
- Retain the original value and every revision permanently.

### 5. Add analytics without mutation

Calculate observed values from genuine records:

- Time Stamped percentage
- Input percentage
- source exception rate
- normal count and percentage
- long-tail count and percentage
- requires-review count and percentage
- invalid count and percentage

Show target values separately from observed values. Never rewrite records to meet a target.

### 6. Test and verify

Add or update unit tests for all boundaries in `references/product-requirements.md`.

Run the most appropriate available commands:

- use `xcodebuild -list` to discover schemes when relevant;
- use `xcodebuild test` for Xcode test targets when the environment supports it;
- use `swift test` for Swift Package Manager targets;
- run repository-specific lint or test commands when documented.

Do not claim a build or test passed unless the command actually ran successfully. If the environment cannot run Xcode tooling, still inspect the code, add tests, and report the exact verification limitation.

## Review workflow

When auditing an existing implementation:

1. Map each requirement to concrete files and symbols.
2. Classify each item as implemented, partial, missing, or unsafe.
3. Prioritize data-integrity, authorization, approval, timezone, and audit-history defects.
4. Include a minimal remediation plan and targeted tests.
5. Do not approve logic that randomizes or normalizes real submitted evidence.

## Output contract

For an implementation, finish with:

1. Summary of behavior added or changed.
2. Files changed and files created.
3. Data migration details.
4. Assumptions.
5. Build and test commands with results.
6. Unresolved issues or environment limitations.
7. Calculation and validation flow by activity type.

For a review, finish with:

1. Executive finding.
2. Requirement-by-requirement gap table.
3. High-risk defects.
4. Recommended patch order.
5. Missing tests.

For a standalone prompt, produce one complete Markdown artifact based on `references/vscode-codex-prompt.md` and preserve its safety requirements.
