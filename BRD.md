# Business Requirements Document (BRD)

**Document Version:** 1.0
**Date:** 2026-03-30
**Project Name:** SaaNs v2 — Sahamati Analytics & Answering System
**Prepared By:** Sahamati Engineering Team
**Reviewed By:** [Name, Role]
**Approved By:** [Name, Role]

---

## Executive Summary

SaaNs (Sahamati Analytics & Answering System) is a comprehensive analytics and intelligence platform for the Account Aggregator (AA) ecosystem in India. It enables Sahamati's internal teams and ecosystem stakeholders to monitor real-time performance metrics, query ecosystem health using natural language, and track data availability across Financial Information Providers (FIPs) and Account Aggregators (AAs).

SaaNs v1 was built as a monolithic Flask application with raw LLM-generated MongoDB queries, which introduced security risks, scalability limitations, and maintenance overhead. SaaNs v2 is a ground-up rewrite that modernizes the stack — FastAPI + React SPA — introduces deterministic query safety via structured LLM intent extraction, and delivers a production-grade analytics experience with proper authentication, rate limiting, audit logging, and separated deployment.

This document outlines the business requirements, scope, and success criteria for the SaaNs v2 initiative.

---

## 1. Business Objectives

### 1.1 Primary Objectives
- Provide real-time, actionable analytics for the AA ecosystem to support Sahamati's monitoring and governance mandate
- Enable non-technical stakeholders to query ecosystem performance data using natural language (e.g., "Which FIP had the highest success rate in January 2026?")
- Eliminate security risks from raw LLM-generated database queries by introducing deterministic, templated pipeline construction

### 1.2 Secondary Objectives
- Modernize the technology stack for maintainability, scalability, and developer productivity
- Separate frontend and backend deployment for independent scaling and faster release cycles
- Establish a foundation for future external-facing analytics (regulated entities, AAs, compliance officers)

### 1.3 Success Criteria
| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Query Safety | 0 raw LLM-generated DB queries | Code audit — all queries go through templated pipeline builder |
| Analytics Chat Response Time | < 5 seconds for 90% of queries | Application performance logs (timing middleware) |
| Dashboard Load Time | < 2 seconds for initial load | Frontend performance monitoring |
| System Uptime | 99.5% availability | GCP monitoring / uptime checks |
| User Adoption | 100% of internal Sahamati team onboarded | Auth logs — unique @sahamati.org.in logins |
| API Error Rate | < 1% of requests returning 5xx | Application logs and monitoring |

---

## 2. Stakeholders

### 2.1 Primary Stakeholders
| Name | Role | Responsibility | Contact |
|------|------|---------------|---------|
| Sahamati Leadership | Executive Sponsors | Strategic direction, approval | — |
| Sahamati Analytics Team | Primary Users | Daily ecosystem monitoring, reporting | — |
| Sahamati Engineering | Development Team | Build, deploy, maintain SaaNs v2 | — |

### 2.2 Secondary Stakeholders
| Name | Role | Interest | Contact |
|------|------|----------|---------|
| Account Aggregators (AAs) | Ecosystem Participants | Performance visibility of their integrations | — |
| Financial Information Providers (FIPs) | Ecosystem Participants | Understanding their success/failure rates | — |
| Regulated Entities (Banks, NBFCs) | Future Users | Compliance monitoring, ecosystem health | — |
| RBI / Regulators | Oversight | Ecosystem-wide health and compliance | — |

---

## 3. Problem Statement

### 3.1 Current Situation
SaaNs v1 is a monolithic Flask application that:
- Generates raw MongoDB aggregation pipelines via LLM (Gemini), creating injection and data exfiltration risks
- Uses synchronous Python (PyMongo) with limited concurrency under load
- Renders server-side HTML templates, limiting interactivity and UX
- Has a single deployment artifact (backend + frontend), making independent scaling impossible
- Lacks structured authentication (basic OAuth), rate limiting, and audit logging
- Contains an 800KB+ monolithic `api_endpoints.py` file that is difficult to maintain

### 3.2 Business Impact
- **Security Impact:** LLM-generated raw queries can produce unintended pipeline stages, potentially exposing or mutating data
- **Cost Impact:** Synchronous architecture wastes compute on I/O-bound operations; monolith requires full redeployment for any change
- **Customer Impact:** Slow query responses and limited interactivity reduce analytical productivity
- **Competitive Impact:** Modern analytics expectations (real-time dashboards, natural language querying) require a modern platform to maintain Sahamati's credibility as ecosystem operator

### 3.3 Opportunities
- Position SaaNs as the authoritative analytics platform for the entire AA ecosystem
- Enable future self-service analytics for external entities (AAs, FIPs, regulators)
- Leverage structured intent extraction to support new query types without LLM retraining
- Build a modular platform that can extend to new data sources (e.g., FIU metrics, consent analytics)

---

## 4. Proposed Solution

### 4.1 Solution Overview
A complete rewrite of SaaNs using a modern, decoupled architecture:
- **Backend:** FastAPI (async Python) with Motor (async MongoDB driver), structured LLM intent extraction via Google Gemini, and deterministic query pipeline construction
- **Frontend:** React 19 + TypeScript SPA with Vite, Tailwind CSS v4, Radix UI, Recharts, and Zustand state management
- **Deployment:** Docker container on GCP VM (backend) + Cloudflare Pages (frontend)

### 4.2 Key Features
1. **Analytics Chat (Natural Language Querying):** Users ask questions in plain English; Gemini extracts structured intent (QueryIntent JSON); a deterministic pipeline builder constructs safe MongoDB aggregation queries; results are returned with tabular data, summaries, and insights
2. **Real-Time Dashboard:** Per-entity performance analysis as the primary use case — comparative FIP summary table, top/bottom FIP rankings by success rate, per-FIP drill-down across events with p95/p99 latency, AA-pivoted views, and FIP↔AA pair analysis; supporting ecosystem KPI cards, time-series trend charts, rolling 24-hour views, AI-generated view summaries, and freely-composable filters by FIP, AA (Sahamati-only), event type, date range, granularity, and operating hours (see Section 4.4 for full specification)
3. **Entity Management:** Browse FIPs and AAs, view integration matrices (which AAs work with which FIPs), and check live operational status from Sahamati
4. **Data Availability & Gaps:** Monitor data freshness per AA, detect missing months for FIP-AA-event combinations, and trigger data refreshes
5. **Secure Authentication & Authorization:** Google OAuth 2.0 restricted to @sahamati.org.in domain, JWT tokens with httpOnly cookies, rate limiting, and comprehensive audit logging

### 4.3 Benefits
- **Business Benefits:**
  - Faster, more reliable ecosystem monitoring for governance decisions
  - Foundation for external stakeholder access (future revenue/value)
  - Reduced operational risk from eliminating raw LLM query generation
- **User Benefits:**
  - Sub-5-second natural language query responses
  - Interactive, modern dashboard with rich visualizations
  - Self-service analytics without SQL or MongoDB knowledge
- **Technical Benefits:**
  - Async architecture handles 10x more concurrent requests per instance
  - Independent frontend/backend deployments reduce release cycle time
  - Modular codebase (12+ backend modules vs. 1 monolithic file) improves maintainability

### 4.4 Real-Time Dashboard

The dashboard is the primary landing experience for SaaNs v2 and the highest-traffic surface in the product. Its core purpose is **per-entity performance analysis** — letting analysts see how each individual FIP and each individual AA is performing, and compare them against each other. Ecosystem-wide numbers exist only as a rough backdrop; they average away the very signal (which entity is underperforming, on which event, during which hours) that drives Sahamati's governance actions. Every view, filter, chart, and ranking on the dashboard is built to support that per-FIP and per-AA analytical grain first, with ecosystem aggregates as secondary context.

#### 4.4.1 Dashboard Views (Ordered by Analytical Priority)
1. **FIP Summary View (primary)** — Tabular snapshot of *every* FIP with success rate, failure rate, timeout rate, and avg latency for the selected window (rolling 24h, 7-day, or custom range). Sortable and filterable by AA. This is the first screen most analysts reach for because it exposes the comparative distribution of FIP performance at a glance — the fastest way to identify who is healthy and who is not.
2. **FIP Detail View** — Drill-down for a single FIP showing per-event metrics (avg / p95 / p99 / count) across all event categories (ConsentPost, FIFetch, FINotification, UserLinking, UserUnLinking, UserConfirmLinking, FIRequest, UserDiscovery). This is where root-cause analysis happens: is SBI's overall 80% success rate being dragged down by ConsentPost, or is it FIFetch? The view also supports pinning a specific AA to ask "how is this FIP performing *with this AA*."
3. **AA-Scoped Analysis (Sahamati-only)** — Any view can be filtered by a specific AA. With an `aa_id` filter applied, every KPI, ranking, and trend chart reflects only that AA's traffic — so an analyst can ask "how does FIP X perform when the consent flow originates from AA Y?" and see the per-FIP breakdown restricted to that AA's population.
4. **Ecosystem Overview (context)** — KPI cards, availability breakdown, and trend chart aggregated across all FIPs and AAs. Treated as a health backdrop, not the primary analytical unit — useful for regulatory reporting and spotting ecosystem-wide regressions, but the per-FIP/per-AA views are where real decisions happen.
5. **Market Dashboard** — Public-facing variant of the ecosystem overview, scoped to non-sensitive metrics.

#### 4.4.2 Key Performance Indicators (KPI Cards)

Every KPI card is **context-sensitive to the active filter** — the same card shows an individual FIP's numbers when a FIP filter is set, an individual AA's numbers when an AA filter is set, a specific FIP↔AA pair's numbers when both are set, and ecosystem numbers only when no entity filter is applied. The headline value and its min / max / median / data-point count are recomputed from the correct slice on every filter change.

| KPI | Description | Per-Entity Interpretation | Status Thresholds |
|-----|-------------|---------------------------|-------------------|
| Success % | Weighted success rate | % of this FIP's (or AA's, or pair's) events that succeeded | ≥95% green, ≥80% yellow, <80% red |
| Failure Response % | Business-layer failures | Failure rate attributable to the selected entity | ≤10% green, ≤20% yellow, >20% red |
| Server Error % | 5xx responses from the FIP | How often this specific FIP returned 5xx | Included in availability breakdown |
| Timeout % | Requests exceeding timeout | Per-FIP / per-AA timeout rate | Included in availability breakdown |
| Latency (avg / p50 / p95 / p99) | Four latency tiers | Per-entity response-time distribution | Tiered thresholds (e.g., avg ≤1s green, p99 ≤3s green) |
| Active FIPs | Count of distinct FIPs with data | When AA filter is set: how many FIPs serve this AA | — |
| Active AAs | Count of distinct AAs with data | When FIP filter is set: how many AAs integrate with this FIP | — |

Alongside the headline value, each card surfaces **min, max, median, and data-point count across the underlying buckets**. For a single FIP that's "best and worst day (or AA pair) inside this window" — directly exposing variance that a single ecosystem number would hide.

#### 4.4.3 How Metrics Are Calculated

All dashboard metrics derive from the raw `anveshan` collection, which stores one record per FIP↔AA interaction with fields: `time_unix` (epoch ms), `fip_id`, `aa_id`, `event_name`, `event_category`, and `value` (the measurement, e.g., 1/0 for success, milliseconds for latency). The dashboard never queries raw data for aggregates — it reads from pre-computed rollups for latency and safety.

**The primary aggregation grain is (fip_id, aa_id, event_name, event_category).** Every rollup collection stores its counts and averages at that grain; broader numbers (per-FIP, per-AA, per-event, or ecosystem) are computed by rolling up *from* this grain at query time using a count-weighted average. This design is deliberate — per-FIP and per-AA views are the product's primary use case, so the storage grain is kept fine enough to never require re-reading raw data to answer those questions.

##### 4.4.3.1 Pre-Computation Pipeline
Raw events are pre-aggregated into three rollup collections by a scheduled job that runs after each day's data is stable. Each collection preserves the per-FIP × per-AA × per-event grain:

| Collection | Grain | Source | Used By |
|-----------|-------|--------|---------|
| `saans_daily_stats` | (date, fip_id, aa_id, event_name, event_category) | `anveshan` | Custom date ranges, daily/weekly trends, FIP summary |
| `monthly_stats` | (year, month, fip_id, aa_id, event_name, event_category) | Rolled up from daily | Period mode (year + month), FIP detail, 12-month trend |
| `saans_last_24h_stats` | (fip_id, aa_id, event_name, event_category) for the rolling 24h window | `anveshan` | Rolling 24h mode, FIP summary |

Each pre-aggregated document stores `avg_value`, `min_value`, `max_value`, `sum_value`, and `count` (number of raw events contributing to the bucket), plus `p95_value` and `p99_value` for latency events. Day boundaries are IST-aligned (UTC+5:30 offset) so aggregations match how Indian analysts perceive a "day."

##### 4.4.3.2 Per-FIP Metric Calculation
When a FIP filter is active (or when building any FIP-level ranking or summary), the dashboard restricts the rollup query to that FIP's documents and applies the same count-weighted mean across the remaining dimensions (AAs, days/months, and — by default — all non-UserDiscovery events):

```
fip_metric = Σ (bucket.avg_value × bucket.count) / Σ bucket.count
             for all buckets where bucket.fip_id = <selected FIP>
             within the selected time window and event scope
```

This weights each AA↔FIP↔day slice by its actual traffic, so a FIP's headline number correctly reflects its real user-weighted experience rather than treating a low-traffic AA the same as a high-traffic one.

##### 4.4.3.3 Per-AA Metric Calculation (Sahamati-only)
AA-scoped analysis uses the same formula with `aa_id` as the filter. The AA filter is layered on top of the FIP filter when both are set, producing the metric for the specific FIP↔AA pair — the finest grain the UI exposes. This is the query path analysts use to answer "is the problem with this FIP in general, or only when this AA is the counterparty?"

##### 4.4.3.4 Ecosystem Roll-Up (Secondary)
With no entity filter active, the same weighted-mean formula runs across every bucket in the window:

```
ecosystem_avg = Σ (bucket.avg_value × bucket.count) / Σ bucket.count
```

This is mathematically equivalent to averaging the raw events directly. It is presented only as backdrop context — per-FIP rankings and per-AA breakdowns are where the decision-useful signal lives. A naive average-of-averages would over-weight low-traffic FIPs and is never used.

##### 4.4.3.5 KPI Event Scope (UserDiscovery Exclusion)
Ecosystem KPI cards and the availability breakdown intentionally **exclude the `UserDiscovery` event** from roll-ups. UserDiscovery call volume dwarfs every other event, so in a count-weighted average it dominates the headline number regardless of how well or poorly the rest of the ecosystem is performing — the user-critical flows (`ConsentPost`, `FIFetch`, etc.) become statistically invisible.

The problem cuts both ways: UserDiscovery often has a markedly different success profile from downstream events (it can be the *best*- or *worst*-performing event for a given FIP — e.g., the current dashboard shows UserDiscovery at 77.14% for SBI in Apr 2026 while other events sit much higher). Either way, blending it into a single ecosystem KPI produces headline numbers that contradict the per-event breakdown directly below them. Excluding it keeps the hero cards representative of the flows users and regulators actually care about.

When a user selects a specific event via the filter, that event is used as-is — the exclusion applies only when no event filter is set.

##### 4.4.3.6 Median, Min, Max, and Percentile Handling
- **Median** is computed server-side using MongoDB's `$median` operator with the `approximate` method (t-digest) across pre-aggregated `avg_value` entries.
- **Min / Max** on KPI cards refer to the minimum and maximum `avg_value` observed across pre-aggregated buckets. For a filtered FIP this exposes its best-performing and worst-performing AA-day slice — a direct view of intra-FIP variance that an ecosystem number would hide.
- **P95 / P99 latency** on FIP detail views are pre-computed at the raw layer and averaged across buckets (`$avg` of `aggregations.p95_value`). This is an approximation — exact percentiles across arbitrary slice combinations would require re-aggregating raw data and exceed the 15-second query budget.

##### 4.4.3.7 Trend Chart Data Source Selection
The trend chart transparently switches between collections based on the selected granularity and window so the user always gets the fastest accurate result:

| Condition | Source |
|-----------|--------|
| Monthly granularity, any window | `monthly_stats` |
| Daily or weekly granularity, operating_hours = "all" | `saans_daily_stats` |
| Any granularity, operating_hours ≠ "all", within last 6 months | `anveshan_ts` (MongoDB Time-Series collection) |
| Any granularity, operating_hours ≠ "all", older than 6 months | `anveshan` (original raw collection) |

Operating-hours filtering requires per-event timestamps, so it bypasses daily rollups. A 15s query timeout applies to rollup queries; raw queries are allowed up to 60s.

##### 4.4.3.8 Operating-Hours Filter Logic
Business hours are defined as **09:00 – 18:00 IST** (hours 9–17 inclusive). The filter computes the IST hour from each event's `time_unix` in MongoDB's aggregation expression language:

```
hour_IST = floor( ((time_unix + 19,800,000) / 3,600,000) mod 24 )
```

where 19,800,000 ms is the IST offset. `business` matches hours 9–17; `non-business` matches the complement.

##### 4.4.3.9 Ranking Calculations
Per-FIP rankings are the core comparative tool on the dashboard:
- **Top / Bottom FIPs** are ranked by the weighted-average `success_percent` of each FIP across the selected window and event scope. The ranking query `GROUP BY fip_id` on the filtered rollup collection, applies the weighted mean per FIP, then sorts — so each row represents one FIP's real, traffic-weighted performance across all its AA counterparties (or a single AA if an AA filter is set).
- **Rankings honour every active filter.** Selecting an AA reranks FIPs by their performance *with that AA*. Selecting an event reranks FIPs by success on *that event*. Selecting a custom date range reranks on that window. The ranking is always a live per-FIP recomputation, not a cached leaderboard.
- FIPs with no data in the selected slice are excluded rather than shown as zero, so the bottom of the list reflects actual poor performers instead of absent ones.
- **Active FIPs / Active AAs** counts use MongoDB `distinct` on the filtered rollup collection — they represent entities with at least one record in the selected window, not total registered entities.

##### 4.4.3.10 Availability Breakdown
The availability donut combines three separately-computed weighted averages — `success_percent`, `server_error_percent`, and `timeout_percent` — each aggregated across KPI events (excluding UserDiscovery). The three values are displayed as reported; they may not sum to exactly 100% because `failure_response_percent`, `client_error_percent`, `no_response_percent`, and `acc_notfound_percent` are tracked separately and are not part of the availability view.

##### 4.4.3.11 Freshness and Staleness Guarantees
Dashboard metrics are only as fresh as the last completed aggregation run. The freshness indicator in the header surfaces two timestamps: the latest `date` present in `saans_daily_stats` (data completeness) and the `completed_at` timestamp of the most recent aggregation run (pipeline liveness). The rolling 24h view is recomputed independently and may be fresher than the daily rollups during the ingestion gap.

#### 4.4.4 Filters and Time Controls
- **Entity filters:** FIP, AA (Sahamati-only), event name (UserDiscovery, ConsentPost, FIFetch, FINotification, FIRequest, UserLinking, UserUnLinking, UserConfirmLinking)
- **Time modes:**
  - Period mode (year + month) — reads from pre-computed `monthly_stats`
  - Custom date range (start_date, end_date, optional start_time / end_time in IST)
  - Rolling 24-hour window — reads from pre-computed `saans_last_24h_stats`
- **Granularity:** daily / weekly / monthly (for trend chart)
- **Operating hours:** all / business (9 AM – 6 PM IST) / non-business

#### 4.4.5 Interactive Trend Chart
- Time-series visualization of any selected KPI using Recharts
- Switches automatically between `monthly_stats`, `saans_daily_stats`, and raw `anveshan_ts` time-series collection depending on granularity and window
- Supports up to 12 months of history in monthly mode; full custom range in daily/weekly mode
- Overlays FIP count per bucket for context on data coverage

#### 4.4.6 Per-Entity Analysis: Rankings, Drill-Down, and Comparison
This is where the dashboard delivers its primary value. Every element is designed to move the analyst from "the ecosystem looks healthy / unhealthy" to "*this specific FIP* is the problem, *this specific AA* is the amplifier, *this specific event* is the failure mode."

- **Comparative FIP table (FIP Summary)** — All FIPs in one table with success, failure, timeout, and latency columns; sortable on any column. The default entry point for day-to-day monitoring, because it surfaces the relative ordering of every FIP in a single glance.
- **Top / Bottom FIP rankings by success rate** — Leaderboard on the overview. Rows are clickable and filter the rest of the dashboard to the chosen FIP in a single action, so the analyst can jump from "who's worst" to "why" without losing context.
- **FIP → AA drill-down** — Clicking a FIP reveals the AAs that send it traffic (Sahamati-only). Selecting an AA pins the filter so every KPI, trend, and ranking recomputes for the FIP↔AA pair — the finest grain the UI exposes.
- **FIP Detail view** — Per-event metrics (avg / p95 / p99 / count) for the selected FIP across every event category. Used to isolate which specific flow (ConsentPost, FIFetch, UserLinking, etc.) is dragging a FIP's headline number down.
- **AA-pivoted view** — The same filters work with AA as the anchor. An analyst can pin an AA and watch the per-FIP ranking reshuffle to show "with this AA as the counterparty, which FIPs perform best and worst." This is the dual of the FIP view and is used to investigate AA-specific integration issues.
- **Cross-filter behaviour** — FIP, AA, event, time window, operating hours, and granularity filters compose freely. A selection like "FIP = X, AA = Y, event = ConsentPost, last 7 days, business hours only" is a single URL-addressable state, making per-entity investigations shareable and reproducible.

#### 4.4.7 AI-Generated Summary
- One-click "Explain this view" action produces a plain-language summary of the current dashboard state
- Reuses the same filters and data the user is viewing; streams the Gemini response to the UI via Server-Sent Events (SSE) for sub-second first-token latency
- Non-blocking — the dashboard remains interactive while the summary streams

#### 4.4.8 Data Freshness and Auto-Refresh
- Header indicator shows the latest date present in `saans_daily_stats` and the timestamp of the last completed aggregation run
- Dashboard auto-refreshes every 10 minutes while the tab is active
- Freshness timestamp is timezone-aware so it renders correctly in the user's local time

#### 4.4.9 Performance Targets for the Dashboard
| Metric | Target | Rationale |
|--------|--------|-----------|
| Initial dashboard render | < 2 seconds | Pre-computed aggregations + parallel API calls |
| Filter change → data refresh | < 1.5 seconds | Indexed MongoDB queries, 15s server timeout |
| Trend chart re-render | < 500 ms | Client-side Recharts redraw on cached data |
| AI summary first token | < 2 seconds | Gemini streaming via SSE |
| Concurrent dashboard viewers | 50+ | Async FastAPI + Motor driver |

#### 4.4.10 Security and Access Controls Specific to the Dashboard
- All dashboard endpoints require a valid JWT and authenticated session
- AA-level filtering (`aa_id` parameter) is gated to users in the `sahamati.org.in` domain — non-Sahamati viewers cannot filter by individual AAs
- Data freshness and metadata endpoints are authenticated but do not expose sensitive entity relationships
- All dashboard API requests are written to the audit log with the full filter payload

---

## 5. Scope

### 5.1 In Scope
- Analytics chat with natural language query processing (structured intent extraction)
- Dashboard with per-entity performance analysis as the primary view (comparative FIP summary, per-FIP drill-down across events, AA-scoped and FIP↔AA pair views, top/bottom FIP rankings); supporting ecosystem KPI overview, interactive trend charts (daily / weekly / monthly), rolling 24-hour mode, operating-hours filter, AI-generated view summaries, and auto-refresh
- Entity management (FIPs, AAs, integration mapping, live status)
- Data availability monitoring and gap detection
- Google OAuth 2.0 authentication with domain restriction
- JWT-based API authorization with rate limiting
- Audit logging for all API requests and auth events
- Docker-based backend deployment on GCP
- Static SPA frontend deployment on Cloudflare Pages
- Pre-computed daily and monthly statistics pipeline

### 5.2 Out of Scope
- External user registration and self-service onboarding
- Multi-tenant access control (role-based permissions beyond auth/no-auth)
- Real-time streaming data ingestion (current model is batch/periodic)
- Mobile application
- Alerting and notification system (email/Slack alerts on threshold breaches)
- Historical data backfill tooling for pre-existing gaps

### 5.3 Future Considerations
- External entity portal for AAs and FIPs to view their own performance
- Role-based access control (admin, analyst, viewer, external)
- Webhook-based real-time data ingestion
- Automated alerting on SLA breaches or data gaps
- FIU (Financial Information User) metrics integration
- Consent lifecycle analytics
- Export and scheduled report generation (PDF/CSV)

---

## 6. Assumptions

- Sahamati team members have Google Workspace accounts under the @sahamati.org.in domain
- MongoDB 6.0+ is available and pre-populated with AA ecosystem metrics (monthly_stats, saans_daily_stats collections)
- Google Gemini API (2.0 Flash and 2.5 Pro) remains available and pricing is acceptable
- GCP infrastructure and Cloudflare Pages accounts are provisioned and managed by Sahamati
- Data continues to be ingested into MongoDB via existing ETL pipelines (out of scope for v2)
- The FIP-AA entity mapping data is maintained and updated periodically

---

## 7. Constraints

### 7.1 Business Constraints
- Access restricted to @sahamati.org.in domain users (no external access in v2)
- Must comply with Sahamati's data handling and privacy policies
- Analytics limited to data already available in MongoDB collections

### 7.2 Technical Constraints
- Backend hosted on a single GCP VM (1.5 CPU, 1GB RAM) — must optimize for limited resources
- LLM dependency (Google Gemini) introduces latency and cost per query
- MongoDB query timeout set to 30 seconds — complex aggregations must complete within this window
- Frontend must work across modern browsers (Chrome, Firefox, Safari, Edge)

### 7.3 Resource Constraints
- Small engineering team — must prioritize high-impact features
- Shared infrastructure with other Sahamati projects (anveshan, aikya)

---

## 8. Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|-------------------|
| Gemini API downtime or deprecation | Low | High | Implement fallback error handling; abstract LLM layer for provider swapability |
| Query intent misclassification by LLM | Medium | Medium | Structured output validation; fallback to "unknown" intent with user-friendly error; continuous prompt refinement |
| MongoDB performance degradation on large datasets | Medium | High | Pre-computed stats (daily/monthly aggregations); proper indexing; query timeout enforcement |
| Security vulnerability in auth flow | Low | High | JWT with httpOnly cookies; CORS restrictions; rate limiting; security headers; regular audit |
| Data freshness issues (stale metrics) | Medium | Medium | Data availability monitoring; last-update tracking; manual refresh trigger |
| GCP VM resource exhaustion | Medium | Medium | Resource limits in Docker; async architecture to maximize throughput; monitoring and alerting |
| Adoption resistance from users accustomed to v1 | Low | Low | Gradual rollout; training sessions; maintain feature parity with v1 |

---

## 9. Budget & Resources

### 9.1 Estimated Budget
| Category | Estimated Cost | Notes |
|----------|---------------|-------|
| GCP VM (Backend) | ~$50-100/month | e2-small or equivalent instance |
| Cloudflare Pages (Frontend) | Free tier | Static SPA hosting |
| Google Gemini API | ~$50-200/month | Based on query volume (Flash + Pro models) |
| MongoDB Atlas (if applicable) | ~$50-100/month | Or self-hosted on GCP VM |
| Domain & SSL | Minimal | Managed via Cloudflare |
| **Total** | **~$150-400/month** | Operational costs |

### 9.2 Resource Requirements
| Role | FTE | Duration | Notes |
|------|-----|----------|-------|
| Full-Stack Engineer | 1-2 | 3-4 months | Backend (FastAPI) + Frontend (React) development |
| DevOps / Infrastructure | 0.5 | 1-2 months | GCP setup, Docker, CI/CD, Cloudflare deployment |
| QA / Testing | 0.5 | 1-2 months | Integration testing, UAT |
| Product Owner | 0.25 | Ongoing | Requirements, prioritization, acceptance |

---

## 10. Timeline

### 10.1 Key Milestones
| Milestone | Target Date | Dependencies |
|-----------|------------|--------------|
| Requirements & BRD Finalized | 2026-04-07 | Stakeholder review |
| Architecture & Design Complete | 2026-04-14 | BRD approval |
| Backend Core (Auth, Dashboard, Entities) | 2026-05-15 | Design complete |
| Analytics Chat (Intent Extraction + Pipeline Builder) | 2026-06-15 | Backend core |
| Frontend SPA (Dashboard, Chat, Entities) | 2026-06-30 | Backend APIs available |
| Integration Testing & UAT | 2026-07-15 | Frontend + Backend complete |
| Production Deployment & Rollout | 2026-07-31 | Testing complete |

### 10.2 Project Phases
```
Phase 1: Discovery & Planning       2026-03-30 - 2026-04-14
Phase 2: Architecture & Design      2026-04-14 - 2026-04-28
Phase 3: Backend Development         2026-04-28 - 2026-06-15
Phase 4: Frontend Development        2026-05-15 - 2026-06-30
Phase 5: Integration & Testing       2026-07-01 - 2026-07-21
Phase 6: Launch & Rollout            2026-07-21 - 2026-07-31
```

---

## 11. Compliance & Regulatory Requirements

- **Data Privacy:** All AA ecosystem metrics are aggregated/anonymized — no end-user PII is stored or displayed
- **Access Control:** Authentication restricted to Sahamati domain; all API access requires valid JWT
- **Audit Trail:** All API requests logged with user identity, IP, timestamp, method, path, status, and duration
- **RBI Guidelines:** Platform supports Sahamati's role as AA ecosystem operator; analytics align with regulatory monitoring requirements
- **OWASP Top 10:** Application designed to mitigate common web vulnerabilities (XSS, injection, CSRF, broken auth)

---

## 12. Competitive Analysis

### 12.1 Market Landscape
SaaNs is a purpose-built internal tool for Sahamati's unique role as the AA ecosystem operator. There is no direct commercial competitor for this specific use case. However, comparable analytics platforms in adjacent domains inform design decisions.

### 12.2 Competitor Comparison
| Feature | SaaNs v2 | Generic BI Tools (Metabase/Superset) | Custom Internal Dashboards |
|---------|----------|--------------------------------------|---------------------------|
| Natural Language Querying | Yes (Gemini-powered) | Limited / Plugin-based | No |
| AA Ecosystem Domain Knowledge | Built-in (FIP/AA mappings, event types) | Requires configuration | Varies |
| Entity Status Integration | Live from Sahamati website | Not available | Custom build |
| Data Gap Detection | Automated | Manual query | Custom build |
| Deployment Simplicity | Docker + Cloudflare | Self-hosted / SaaS | Varies |
| Cost | Low (< $400/month) | Free-$500/month | Engineering time |

---

## 13. Dependencies

### 13.1 Internal Dependencies
- MongoDB collections (monthly_stats, saans_daily_stats, last_update_times) populated by existing ETL pipelines
- Google Workspace for OAuth authentication (@sahamati.org.in domain)
- GCP project with VM and networking configured
- Cloudflare account for frontend hosting
- FIP-AA entity mapping data maintained and current

### 13.2 External Dependencies
- Google Gemini API availability and pricing stability
- Sahamati website availability for live FIP/FIU status scraping
- MongoDB driver compatibility (Motor 3.6+ for async operations)
- NPM package ecosystem for frontend dependencies (React 19, Vite 8, etc.)

---

## 14. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Business Owner | | | |
| Product Manager | | | |
| Technical Lead | | | |
| Finance | | | |

---

## 15. Appendices

### Appendix A: Glossary
| Term | Definition |
|------|-----------|
| AA | Account Aggregator — RBI-licensed entity that facilitates consent-based data sharing |
| FIP | Financial Information Provider — entity that holds user financial data (banks, insurers, etc.) |
| FIU | Financial Information User — entity that consumes financial data with user consent |
| SaaNs | Sahamati Analytics & Answering System |
| QueryIntent | Structured JSON output from LLM representing the parsed user query (query type, entities, time range, metrics) |
| Pipeline Builder | Deterministic module that converts QueryIntent into safe MongoDB aggregation pipelines |
| Event Category | Types of AA-FIP interactions: UserDiscovery, ConsentPost, FIFetch, FINotification, FIRequest, UserLinking, UserUnLinking, UserConfirmLinking |

### Appendix B: References
- SaaNs v1 Application Workflow: `saans_prod/SAANS_APPLICATION_WORKFLOW.md`
- SaaNs v1 Data Availability Guide: `saans_prod/SAANS_DATA_AVAILABILITY_GUIDE.md`
- SaaNs v2 Setup Guide: `saans-v2/SETUP.md`
- Account Aggregator Ecosystem: Sahamati Foundation documentation

### Appendix C: Supporting Documents
- SaaNs v2 Architecture Document (to be created)
- SaaNs v2 Security Assessment (to be created)
- SaaNs All Metrics Dashboard Export: `SaaNs - Sahamati - All Metrics.html`
