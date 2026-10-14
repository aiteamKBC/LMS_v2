# Synthetic payload comparison

These are actual serialized Django response bytes using synthetic test data and mocked gate helpers, not production endpoint measurements. Before executes the unchanged main view. Gzip body bytes exclude HTTP/TLS headers and are not browser transfer size.

### Before synthetic response

```json
{
  "id": "265",
  "name": "Synthetic Learner",
  "email": "learner@example.invalid",
  "phone": "",
  "programme": "Example Programme",
  "programmeStatus": "Active",
  "onboardingStatus": "",
  "firstSessionUnlocked": false,
  "cohort": "",
  "group": "",
  "employer": "",
  "employerId": null,
  "organization": "",
  "learnerType": "commercial",
  "isActive": true,
  "programmeStartDate": "",
  "learnerStartDate": "",
  "learnerEndDate": "",
  "programmeEndDate": "",
  "accessGate": {
    "blocked": true,
    "reasons": [
      "plan"
    ],
    "startDate": "",
    "outstandingDocuments": []
  },
  "learningAccess": {
    "blocked": true,
    "startDate": ""
  },
  "studentActivityAvailable": false
}
```

JSON bytes: 623. Top-level fields: 22. Deterministic gzip level 9 body bytes: 311.

### After synthetic response

```json
{
  "id": "265",
  "name": "Synthetic Learner",
  "email": "learner@example.invalid",
  "programme": "Example Programme",
  "programmeStatus": "Active",
  "onboardingStatus": "",
  "firstSessionUnlocked": false,
  "cohort": "",
  "group": "",
  "employer": "",
  "organization": "",
  "learnerType": "commercial",
  "programmeStartDate": "",
  "learnerStartDate": "",
  "learnerEndDate": "",
  "programmeEndDate": "",
  "accessGate": {
    "blocked": true,
    "reasons": [
      "plan"
    ],
    "startDate": "",
    "outstandingDocuments": []
  },
  "learningAccess": {
    "blocked": true,
    "startDate": ""
  },
  "studentActivityAvailable": false
}
```

JSON bytes: 572. Top-level fields: 19. Deterministic gzip level 9 body bytes: 291.
