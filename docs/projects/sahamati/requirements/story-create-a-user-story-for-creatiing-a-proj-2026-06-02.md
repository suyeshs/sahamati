**Story ID:** SAHAMATI-042 <!-- assumption: sequential ID following existing backlog -->
**Epic:** Project Management
**Sprint:** Backlog
**Priority:** Must Have
**Status:** Backlog

---

## User Story

**As a** Sahamati team member
**I want** to create a new project within the Sahamati desktop application
**So that** I can organise my development process artefacts (BRDs, FRDs, architecture docs, security assessments) under a dedicated workspace and run agents against a well-defined scope

---

## Business Value

Projects are the fundamental organising unit in Sahamati. Without the ability to create a project, users cannot generate, review, or manage any process artefacts. This story unlocks every downstream workflow — agent runs, document generation, settings configuration, and cloud sync — making it the critical entry point for all value the application delivers.

**Value Score:** 9

---

## Acceptance Criteria

### Scenario 1: Successful project creation with required fields
**Given** the user is authenticated and on the Projects page
**When** the user clicks "Create Project", fills in a project name and description, and submits the form
**Then** a new project record is persisted in the encrypted SQLite database
**And** the user is redirected to the newly created project's dashboard
**And** a success notification is displayed

### Scenario 2: Validation prevents creation with missing name
**Given** the user is on the Create Project form
**When** the user leaves the project name blank and attempts to submit
**Then** the form displays an inline validation error on the name field
**And** the project is not created

### Scenario 3: Duplicate project name warning
**Given** a project named "SaaNs v2" already exists for the user
**When** the user attempts to create another project with the name "SaaNs v2"
**Then** the system displays a warning that a project with this name already exists
**And** the user can choose to proceed or rename <!-- assumption: duplicates are allowed but warned, not blocked -->

### Scenario 4: Project creation with optional GitHub repository link
**Given** the user is on the Create Project form
**When** the user provides a GitHub repository URL in the optional repository field and submits
**Then** the project is created with the repository association stored
**And** the repository link is visible on the project dashboard

### Scenario 5: Unauthenticated user cannot create a project
**Given** the user is not authenticated
**When** the user attempts to access the Create Project page
**Then** the user is redirected to the login screen

---

## Technical Notes

### Implementation Approach
The Create Project flow spans the React frontend (`src/pages/CreateProject.tsx`) and the agent server (`agent-server/src/routes/projects.ts`). The frontend collects project metadata via a form, validates with Zod, and POSTs to the agent server API. The server validates the payload again at the boundary, persists to the encrypted SQLite database via the projects repository, and returns the created project record.

### API Endpoints
- `POST /api/projects` — Create a new project. Accepts JSON body with `name` (required), `description` (optional), `repositoryUrl` (optional).
- `GET /api/projects` — List existing projects (used for duplicate-name check on the client).

### Database Changes
- Uses the existing `projects` table in the encrypted SQLite database. No new migrations are expected unless additional metadata fields are required. <!-- assumption: a projects table already exists from prior work -->

### External Dependencies
- None for core creation. GitHub repository validation (if URL is provided) may call the GitHub API to confirm the repo exists.

---

## Design & UX

**Mockups:** Not yet available <!-- assumption: design to follow existing application patterns -->
**Prototype:** N/A

### UI Components Required
- `CreateProjectForm` — form with name, description, and optional repository URL fields
- `ProjectCard` — card component for the projects list showing the newly created project
- Inline validation error component (reuse existing form error pattern)
- Success toast notification

---

## Definition of Done

- [ ] Code implemented and follows coding standards
- [ ] Unit tests written (>80% coverage for new code)
- [ ] Integration tests written for the `POST /api/projects` endpoint
- [ ] Code reviewed and approved by 2+ engineers
- [ ] No critical/high security vulnerabilities
- [ ] Documentation updated (API docs, README, etc.)
- [ ] Deployed to staging environment
- [ ] QA tested and passed
- [ ] Acceptance criteria met
- [ ] Product Owner approved
- [ ] No known blocking bugs

---

## Testing Scenarios

### Test Case 1: Create project with valid inputs
**Steps:**
1. Log in to the application
2. Navigate to the Projects page
3. Click "Create Project"
4. Enter "AA Compliance Toolkit" as the project name
5. Enter a description
6. Click "Submit"

**Expected Result:** Project is created, user is redirected to the project dashboard, and the project appears in the projects list.

### Test Case 2: Attempt creation with empty name
**Steps:**
1. Navigate to the Create Project form
2. Leave the name field empty
3. Click "Submit"

**Expected Result:** Inline validation error appears on the name field. No API call is made.

### Test Case 3: Create project with GitHub repository URL
**Steps:**
1. Navigate to the Create Project form
2. Enter a project name
3. Enter a valid GitHub repository URL
4. Click "Submit"

**Expected Result:** Project is created with the repository association. The repository link is visible on the project dashboard.

### Test Case 4: Verify persistence after app restart
**Steps:**
1. Create a new project
2. Close and reopen the application
3. Navigate to the Projects page

**Expected Result:** The previously created project is listed.

---

## Dependencies

### Blocked By
- Authentication flow must be functional (login, session management)
- Encrypted SQLite database and migrations infrastructure must be in place

### Blocks
- Agent run workflows (agents require a project context)
- Document generation (artefacts are scoped to a project)
- Project settings and configuration
- Cloud sync (syncs project data)

### Related Stories
- Project listing and dashboard
- Project settings and editing
- Project deletion

---

## Estimation

**Story Points:** 5
**T-Shirt Size:** M

### Estimation Breakdown
- Design: 1 point
- Frontend: 2 points
- Backend: 1 point
- Testing: 1 point
- Documentation: 0.5 point <!-- assumption: included in development effort -->

---

## Security Considerations

- [x] Authentication required: Yes — user must be authenticated via session cookie/JWT
- [x] Authorization checks: User can only create projects under their own account; project ownership is set to the authenticated user
- [x] Data validation: Zod validation on both frontend and backend; project name sanitised to prevent XSS; repository URL validated as a well-formed URL
- [x] Sensitive data: No PII stored in project metadata; no regulated AA/FI data in project records
- [x] Encryption: At rest via encrypted SQLite (`better-sqlite3-multiple-ciphers`); in transit via HTTPS/localhost
- [x] Audit logging: Log project creation events (user ID, project ID, timestamp)

---

## Performance Requirements

- **Response Time:** < 300ms for the `POST /api/projects` call
- **Throughput:** Not a high-frequency operation; single-user desktop context
- **Scalability:** SQLite is sufficient; no horizontal scaling required for this feature

---

## Accessibility Requirements

- [x] WCAG 2.1 Level AA compliant
- [x] Screen reader compatible — form fields have associated labels
- [x] Keyboard navigation support — tab order through form fields, Enter to submit
- [x] Sufficient color contrast — follow existing application theme
- [x] Proper ARIA labels — error messages linked to fields via `aria-describedby`

---

## Analytics & Tracking

**Events to Track:**
- `project_created`: Fires when a project is successfully created (includes project ID, whether a repo URL was linked)
- `project_creation_failed`: Fires when server-side validation rejects the request

**Metrics to Monitor:**
- Projects created per user: Baseline adoption metric
- Creation error rate: < 1% target

---

## Rollout Strategy

**Deployment Type:** Standard
**Feature Flag:** N/A — core functionality, no phased rollout needed
**Rollout Percentage:** 100%

---

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Database encryption passphrase missing from env | High | Low | Fail fast with clear error message at server startup; document required env vars |
| Large project names causing UI overflow | Low | Medium | Enforce max length (200 chars) in Zod schema; truncate with ellipsis in UI |
| GitHub API rate limiting during repo URL validation | Low | Low | Make repo validation optional/async; cache results |

---

## Questions & Clarifications

- **Q1:** Should project names be globally unique or only unique per user? — <!-- assumption: unique per user, with a warning for duplicates rather than a hard block -->
- **Q2:** Are there additional metadata fields needed at creation time (e.g., team, tags, process type)? — To be confirmed with Product Owner
- **Q3:** Should the GitHub repository link be validated against the GitHub API at creation time? — <!-- assumption: yes, if the user has connected their GitHub account via OAuth -->

---

## Comments & Discussion

This story covers the minimum viable project creation flow. Future enhancements (project templates, bulk import, team sharing) should be separate stories. The existing `CreateProject.tsx` page and `projects.ts` route files already contain scaffolding that should be built upon rather than replaced.

---

## Attachments

- [Project routes](agent-server/src/routes/projects.ts)
- [Create Project page](src/pages/CreateProject.tsx)
- [Project API client](src/lib/project-api.ts)

---

## Change Log

| Date | Changed By | Changes |
|------|-----------|---------|
| 2026-06-02 | Sahamati Team | Initial story creation |
