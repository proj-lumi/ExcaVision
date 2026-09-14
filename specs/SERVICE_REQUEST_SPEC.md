# ExcaVision Service Request and Quote Spec

## Intentional product decision

Customers request **monitoring coverage**, not individual nodes.

The customer app must not ask customers to choose node count, MAC addresses,
positions, gateway roles, or physical chain order. ExcaVision determines the
technical deployment after reviewing the coverage request.

Use these terms:

| Term | Meaning |
|---|---|
| Site | A customer location that can contain one or more monitored pipes or structural sections |
| Monitoring unit | One monitored pipe or structural section, containing multiple nodes and exactly one gateway node |
| Coverage request | Customer request for a new monitoring unit or more coverage |
| Deployment manifest | Internal ordered node/gateway plan created by ExcaVision staff |
| Installer job | Field checklist generated from the deployment manifest |

Do not use **Register a site** to mean immediate activation. Use **Request a new
monitoring unit**. A submitted request is not yet an active site.

## Customer flow

```text
Public installation intake → Staff accepts into work queue → Deployment and commissioning
                           → Staff invites one customer account to the site
                           → Customer PWA monitors the site and requests repair or more coverage
```

Public intake records are quarantined in `service_request_intakes`. Only an
explicit Admin acceptance creates a canonical `service_requests` row. Reject as
spam, reject as a legitimate lead, pre-approval **Not proceeding**, and
post-approval cancellation remain separate audited decisions.

### My Sites screen

Show:

- Active monitoring units;
- each unit's health and latest update;
- request status cards;
- **Request repair** for the assigned site;
- **Request more coverage**, which may result in another monitoring unit.

### Request types

1. **New monitoring unit** — a new site or asset that is not yet monitored.
2. **More coverage** — additional monitoring for an existing site/asset.
3. **Replacement or service** — damaged, missing, or moved hardware.

After approval, staff routes each request before delivery:

- a new monitoring installation creates a new site, then atomically creates every monitoring unit named in the installation plan;
- replacement or service targets an existing monitoring unit;
- more coverage can contain multiple destinations, each expanding an existing
  monitoring unit or creating another monitoring unit at an existing site;
- request routing records destinations only; staff chooses node quantities in
  the installation or coverage plan after routing;
- replacing a broken node preserves its physical position and gateway role,
  retires the old hardware record, and preserves historical sensor readings;
- a repair or more-coverage request with no identifiable existing site must
  be clarified with the requester or closed; its request type is not changed
  during fulfillment.

### Coverage request form

Ask for information the customer can reasonably know. Do not ask for technical
node configuration.

#### Required

- Request type;
- site/asset name;
- general location or map pin;
- what they want monitored, in plain language;
- approximate size or length of the monitored area;
- sections, zones, or points of concern;
- desired installation timeframe;
- contact person and preferred contact method.

#### Optional but useful

- photos or site plan;
- approximate number of areas needing separate visibility;
- known movement, settlement, vibration, or tilt concerns;
- outdoor/indoor environment;
- power availability;
- WiFi/cellular availability at the gateway location;
- access restrictions, safety requirements, or escort requirements;
- additional notes.

The form should explain: “You do not need to know how many sensors are needed.
ExcaVision will recommend the coverage.”

### After submission

Show a request detail page with:

- request number;
- submitted information;
- current status;
- ExcaVision Service conversation;
- attachments;
- estimate/quote when available;
- approve or request-changes actions after a proposal is issued.

## Estimate and approval decision

Do not show an instant automated price in the one-week MVP. Coverage pricing
depends on node quantity, installation complexity, travel, power/network needs,
and site conditions.

Use this sequence:

```text
Submitted → Under review → Clarification needed → Proposal ready → Approved
                                                 → Changes requested
```

ExcaVision staff enters the proposal after reviewing the request. It may contain:

- recommended monitoring-unit coverage;
- estimated node count;
- installation/service fee;
- travel or site-specific fee;
- recurring service fee, if applicable;
- taxes or exclusions;
- estimate validity period;
- assumptions and notes.

The first version may present an **estimate range** rather than a final price.
Do not implement payment, invoicing, or automatic pricing rules yet.

## ExcaVision Service conversation

Implement a simple human-supported message thread attached to each request. It
is not an AI chatbot in the one-week MVP.

Staff can:

- ask clarifying questions;
- recommend coverage;
- attach a proposal;
- request photos or a site plan;
- schedule a call or site visit;
- record internal notes separately from customer messages.

Customers can reply, attach photos, and approve or request changes. Label the
thread **ExcaVision Service** so it feels intentional and branded.

Future AI may help staff draft replies, but it must not independently promise a
price, node count, installation date, or technical design.

## Admin workflow

1. Request appears in the Service Requests queue.
2. Staff reviews the coverage information and attachments.
3. Staff asks questions in the ExcaVision Service thread if needed.
4. Staff proposes coverage and enters an estimate range or quote.
5. Customer approves or requests changes.
6. Staff creates the active monitoring unit and deployment manifest.
7. Staff assigns manufactured nodes and physical positions internally.
8. Staff creates a limited field commissioning link and emails it to the installer.
9. Installer commissions the deployment through the admin dashboard.
10. Staff marks the monitoring unit active and invites the customer.

## Scope boundary

The request flow is a **sales/service intake flow**, not ecommerce and not
self-service deployment. The customer asks for coverage; ExcaVision designs the
node deployment.

## Public landing intake for the October MVP

The public landing page accepts new installation requests only. It asks for
only enough information to start a human service conversation:

1. The request type is locked to new installation.
2. Personal details: name, email, and phone, with company optional.
3. Required approximate site location: a selected map search result or a
   manually placed map pin.
4. Optional site notes.
5. A clear statement that submitting the request asks ExcaVision Service to
   contact the requester.

Authenticated customers request repairs and more coverage from the customer
app. The server derives their identity and single assigned site from the session;
the client does not submit customer or site identifiers. New-site installation
onboarding remains on the public landing page for the MVP.

The October MVP serves Philippine locations only. Search suggestions, map bounds,
manual pins, and request validation must reject locations outside the Philippines.
The location is required because ExcaVision needs to understand the site before
contacting the requester. An exact address, technical coverage plan, survey date,
node count, gateway details, and budget are not required at intake. A site survey
is arranged separately only after the requester gives permission. The landing
form does not use a separate survey-permission checkbox.

The landing page should not include an “I’ll share it later” path. If the exact
address is unknown, the requester can search for a nearby city or landmark and
adjust the approximate pin.

The submission payload must include the selected latitude and longitude plus an
OpenStreetMap link generated from those coordinates. It may also include a
Google Maps URL generated from the same coordinates. These are ordinary map
links and do not require Google Maps API usage or billing.

## Bounds for the one-week MVP

### Build now

- quarantined public installation intake and Admin triage;
- one invited customer account linked to one commissioned site;
- site monitoring, latest-reading freshness, and alert acknowledgement;
- authenticated repair and more-coverage requests;
- customer request status tracking;
- handoff into the existing Admin planning and commissioning workflow.

### Defer

- automatic node-count recommendation;
- instant automated pricing;
- online payment and invoicing;
- AI chatbot that negotiates or promises estimates;
- customer proposal conversation, attachments, and approval controls;
- customer node selection or physical ordering;
- customer-side site activation;
- installer scheduling/dispatch optimization;
- public ecommerce catalog.
