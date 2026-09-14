# ExcaVision Admin Workflow Specification

Status: implemented and maintained as the admin workflow contract

This document defines the staff workflow before the dashboard is rebuilt. The
admin dashboard is an operations tool, not a generic CRUD console. Staff should
always understand what needs attention and what the next safe action is.

## Product principle

The dashboard should answer three questions immediately:

1. What needs my attention?
2. What is the next action?
3. What information do I need to complete it?

The interface must not expose database operations as the primary experience.
Requests authorize site, coverage, repair, and monitoring-unit work. Sites remain
a reference directory, Installations remains the delivery queue, and Inventory
remains the hardware registry. Delete remains an exceptional guarded action.

## Separate the two lifecycles

The current request status mixes customer communication, approval, site setup,
and hardware installation. That is why the dropdown feels confusing.

The rebuilt dashboard uses two related but separate lifecycles:

### Request stage

This describes the service conversation with the requester.

| Stage | Meaning | Staff action |
|---|---|---|
| New request | A request has just arrived | Review request |
| Contact needed | Staff has not completed the first follow-up | Contact requester |
| Clarifying details | More information is needed | Ask for details |
| Proposal sent | ExcaVision has sent the recommendation or estimate | Wait for response |
| Changes requested | The requester wants a revised proposal | Update proposal |
| Approved | The requester accepted the proposed service | Choose the delivery destination |
| Not proceeding | The request will not continue | Record reason |

The interface never shows all stages as a free-form dropdown. Each request shows
only valid next actions for its current stage.

### Installation stage

This describes internal delivery after approval.

| Stage | Meaning | Staff action |
|---|---|---|
| Site not created | Approval exists but the site record does not | Create site from request |
| Site created | Location exists in ExcaVision | Name and create the planned monitoring units |
| Planning installation | Coverage and hardware plan is being prepared | Build deployment |
| Ready for installation | Hardware and deployment manifest are ready | Start field work |
| Commissioning | Staff is checking readings and baseline | Complete commissioning |
| Monitoring active | The deployment passed commissioning | Invite customer |

Request stage and installation stage appear as separate labeled values. Neither
is called simply `Status` without context.

## Main navigation

### Work queue

The landing screen is a prioritized queue, not four equal metric cards.

Sections:

1. **Needs your action**
   - New requests
   - Requests needing contact
   - Requests needing clarification
   - Approved requests without a site
2. **Field work**
   - Deployments ready for installation
   - Deployments in commissioning
3. **Recently completed**
   - Recently activated monitoring units

Every queue row contains:

- customer or requester name;
- site or location name;
- request or installation stage;
- one sentence explaining the next action;
- one primary action.

### Requests

The request screen is an inbox. It does not expose edit and delete controls on
every row.

Selecting a request opens a focused detail view with:

- request summary;
- contact details with email and phone actions;
- map link;
- submitted location and notes;
- request stage;
- installation stage when approval has happened;
- activity timeline;
- primary next-action buttons;
- secondary actions in an overflow menu.

The detail view may be a route or a persistent side panel. It should not be a
long inline form that pushes the rest of the queue down.

## Request actions

The action bar is contextual.

| Current request stage | Primary action | Secondary action |
|---|---|---|
| New request | Start contact | Mark not proceeding |
| Contact needed | Mark clarifying details | Mark not proceeding |
| Clarifying details | Send proposal | Mark not proceeding |
| Proposal sent | Record approval | Record requested changes |
| Changes requested | Send revised proposal | Mark not proceeding |
| Approved new installation | Create site | View request details |
| Approved repair | Choose an existing monitoring unit | Reclassify if the request was incorrect |
| Approved more coverage | Expand a unit or add a unit at an existing site | Reclassify if the request was incorrect |
| Not proceeding | No primary action | View reason |

The actual communication may continue through the supplied email and phone in
the October admin scope. The dashboard records the stage and internal notes; it
does not pretend that changing a dropdown sent an email.

## Request closure and cancellation

Closing a request is a guarded action with a required reason. It is never a
free-form status change.

| Work reached | Available action | System effect |
|---|---|---|
| Before approval | Not proceeding | Close the request without changing operational records |
| Approved, no work created | Cancel request | Close fulfillment with no artifact cleanup |
| Draft site, unit, or hardware plan | Cancel work | Archive draft sites and units and return planning hardware to inventory |
| Installation or commissioning started | Stop remaining work | Archive unfinished request-created units while preserving field records and hardware history |
| Request completed | No closure action | Use the asset-specific maintenance or deactivation workflow instead |

Existing sites and monitoring units selected for repair or coverage are never
archived by request cancellation. Any node additions or replacements already
performed on them remain recorded. A request-created monitoring unit that has
reached active monitoring also remains active. Cancelled and archived draft
records stay linked to the request for audit history but disappear from active
Sites and Installations collections.

`Not proceeding` means approval never happened. `Cancelled` means approval
happened but some or all fulfillment was stopped. The request detail shows the
correct outcome and the recorded reason.

## Approved-request routing

An approved request is routed according to its type:

| Request type | Valid destination |
|---|---|
| New installation | A new site, followed by one or more new monitoring units |
| Repair or service | One existing monitoring unit |
| More coverage | One or more existing-unit expansions and/or new monitoring units at existing sites |

A repair request contains one or more existing monitoring-unit destinations. A
more-coverage request contains one or more destinations. Each coverage
destination either identifies an existing monitoring unit or creates a new
monitoring unit at a selected existing site. Request routing never asks for a
node quantity. Neither request type creates a site. If no existing site or unit
can be identified, staff contacts the requester or closes the request. The
request type is never reclassified during fulfillment.

After routing, technical quantities move into execution planning. A new unit
uses its installation Hardware setup panel. An existing-unit expansion requires
a separate coverage plan before hardware can be added. A repair identifies each
broken node during replacement rather than asking for an estimated count. Staff
may replace another node or explicitly finish that unit's repair before the
request can be completed.

A repair that replaces hardware keeps the monitoring unit, physical position,
and gateway role. The old hardware record is retired and the replacement is
recorded without deleting historical sensor readings.

A monitoring unit represents one monitored pipe or structural section. It can
contain multiple nodes, but exactly one node is its gateway.

## Site creation flow

The normal path is:

```text
Approved request → Create site → Confirm site name → Site created
```

The request is the source of truth for:

- requester and customer context;
- approximate location;
- latitude and longitude;
- map links;
- location notes.

The staff member does not re-enter coordinates or location details.

The create-site screen asks only:

- **Site name**: prefilled from the request, editable if needed.

It shows the copied location as read-only confirmation. The primary action is
`Create site from request`.

A standalone manual site action is hidden under an exception action such as
`More actions`. It is not part of the normal customer installation flow.

## Monitoring unit flow

After a site exists, staff selects `Name monitoring units` from the approved
installation request. The plan is a repeatable list: every row requires the
unit's operational name, and staff can add or remove rows before saving. Saving
the plan creates all named draft units atomically at the request-created site.
There is no later create-and-name step.

The same request may create multiple monitoring units at the site. Because the
units have no required priority, the request exposes every unfinished named unit
as an equal setup action, such as `Set up North wing` and `Set up South wing`.
Each unit must complete its own hardware setup, installation, and commissioning
lifecycle before the request can be completed.

The expected node count is not asked during unit naming. ExcaVision determines
coverage and hardware in one installation hardware setup panel. The panel keeps
the target count beside the live assigned count and node manifest, rather than
splitting target-setting, assignment, and manifest editing into separate dialogs.

## Installation planning flow

The installation hardware setup panel is the first place where technical
hardware concepts appear.

```text
Site → Monitoring unit → Hardware setup → Field work
```

The panel contains:

1. the planned target and a live `assigned of target` indicator;
2. all selected nodes in contiguous top-to-bottom chain order;
3. an inline available-node picker with a chain-order control;
4. node removal and manifest validation; and
5. one atomic `Save hardware setup` action.

The target cannot be lowered below the manifest's assigned count. Staff must
explicitly remove nodes first, so changing a planning number never silently
unassigns hardware. Assigned nodes always occupy the contiguous range from 1
through the assigned count. Position 1 is automatically the gateway and cannot
be configured independently. Staff reorders the chain with one-slot Move up and
Move down controls that work with mouse, touch, and keyboard. Adding hardware appends it to the
bottom of the chain, after which it can be moved. Every reorder immediately
renumbers the full chain. After the saved target is reached and the manifest is
valid, staff can mark the deployment ready for field work.

The screen should explain each technical term in plain language. It should not
ask the customer to make any of these decisions.

## Node registration flow

Node registration is an inventory task, not part of the customer request flow.
It should use a short form with the minimum required information.

### Default fields

| Label | Required | Helper text |
|---|---:|---|
| MAC address | yes | The unique hardware identity from the device label or commissioning screen. |

Staff do not enter a separate Node ID. The database keeps its legacy
`serial_number` column for compatibility, but generates it from the normalized MAC
address. The MAC address is the only hardware identity staff manages.

The registration form contains no optional metadata fields. Batch and notes
columns remain in the database only for compatibility with existing records and
future controlled inventory tooling.

## Form rules

Every form follows the same rules:

- labels appear above controls;
- required fields show a red `*` and the form includes a `* Required` legend;
- required controls use `required` and `aria-required` semantics;
- helper text explains technical fields before staff fills them in;
- validation appears below the relevant field in plain language;
- errors do not replace labels or rely on placeholder text;
- save buttons describe the operation, such as `Create site` or `Save node`;
- cancel buttons never look like primary actions;
- long forms use a page or side panel, not an oversized modal;
- confirmation dialogs are reserved for destructive actions.

## Button system

Use one visual hierarchy across the dashboard:

| Use | Style |
|---|---|
| One main action for the current screen | Orange primary button |
| Safe alternative | Neutral outlined button |
| Low-priority navigation | Text button |
| Destructive action | Red danger action inside overflow or confirmation context |
| Icon-only action | Only when the icon has an accessible label and tooltip |

A screen must not show multiple competing orange primary buttons. Icons support
labels and are not used as unexplained decoration.

## Edit and delete rules

Editing is contextual:

- perform approved site, unit, repair, and coverage work from request detail;
- use Sites as a read-oriented location directory;
- use Installations for planning and commissioning created request work;
- edit inventory metadata from the node inventory;
- do not duplicate normal site or monitoring-unit edits across tabs.

Delete is an exception action, not a standard row button. It requires a
confirmation step and remains blocked when historical or deployment records
would be affected.

## Large collection behavior

The request inbox, Sites, Installations, and Node inventory must query only one
server-side page at a time. Each provides search, relevant filters, result range,
total count, and Previous/Next controls. Searchable relationship pickers return a
small bounded result set rather than loading every site, unit, or node.

## Empty, loading, and error states

Every queue and detail screen needs a meaningful state:

- loading: preserve the final layout shape with skeleton rows;
- empty: explain what creates the first item and provide the relevant action;
- error: explain what failed and provide retry without losing form input;
- saved: show a short confirmation and return staff to the next useful context.

## Rebuild sequence

The dashboard rebuild should happen in this order:

1. Replace the current request dropdown with the request inbox and detail flow.
2. Implement contextual request actions and the two lifecycle labels.
3. Move site creation into the approved-request action.
4. Simplify monitoring-unit creation.
5. Simplify node registration and hide advanced fields.
6. Rework deployment and commissioning around installation stages.
7. Move edit and delete into contextual overflow actions.
8. Add the consistent form, required-field, and button rules.
9. Only then remove or migrate old database status values.

No UI implementation should begin until each screen has its queue state, detail
state, primary action, and empty/error behavior defined.
