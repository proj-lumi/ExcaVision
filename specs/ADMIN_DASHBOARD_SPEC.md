# ExcaVision Admin Dashboard Spec

> Workflow source of truth: see [`ADMIN_WORKFLOW_SPEC.md`](./ADMIN_WORKFLOW_SPEC.md).
> This document describes backend capabilities; the workflow spec defines what
> staff sees and which action is available at each stage.

The admin dashboard is a separate web interface for ExcaVision staff. It is not
part of the customer mobile app. The admin may use physical deployment terms
such as pipe; customers see the friendlier term **monitoring unit**.

```text
Admin dashboard → authenticated admin session + RLS/RPCs → Supabase
```

The browser must never contain the Supabase service-role key. Privileged
operations use authenticated admin permissions and secured server-side RPCs.

## Purpose

The dashboard handles manufactured-node inventory, customer-site assignment,
ordered pipe manifests, and field commissioning. Customers cannot perform these
operations. ExcaVision staff uses the responsive dashboard during installation;
there is no separate installer app.

## Final screens

| Screen | Minimum content |
|---|---|
| Admin login | Staff authentication and session persistence |
| Overview | Live counts for requests, sites, available nodes, and active deployments |
| Service requests | Searchable and paginated request inbox, customer contacts, map link, contextual workflow actions, and guarded deletion |
| Node inventory | Searchable and paginated hardware registry with MAC, assignment, state filters, and guarded deletion |
| Sites | Searchable and paginated location directory with monitoring-unit counts and links to matching installations |
| Deployments | Searchable and paginated planning and field-work queue with lifecycle filters, manifest summary, commissioning, and notes |

The responsive dashboard is also the field interface used by ExcaVision staff
during installation. The final product does not require a separate installer app.
Request fulfillment, inventory maintenance, guarded deletion, assignment, and
commissioning forms open in focused modals so the underlying records do not move
while staff works. Site and monitoring-unit creation or expansion begins from an
approved service request, not from duplicate CRUD controls in directory screens.

## Service Requests

Show incoming requests for new monitoring units, additional coverage, and
replacement/service work as an inbox. Each request shows customer, site, request
type, submitted date, request stage, installation stage when applicable, and the
next action. Do not expose the full lifecycle as an unrestricted status dropdown.

The request inbox and contextual action rules are defined in
[`ADMIN_WORKFLOW_SPEC.md`](./ADMIN_WORKFLOW_SPEC.md).

Request detail includes the submitted contact information, site notes, and map
link. Staff follows up using the supplied email and phone number, then records
the request status in the dashboard. The final product does not duplicate email
or quoting tools inside the admin app.

Request stage and installation stage are separate. The old database status
values are retained temporarily for compatibility, but the rebuilt interface
uses the plain-language stage model in `ADMIN_WORKFLOW_SPEC.md`. A later
migration will map old values and add the stage transitions required by the
workflow.

After approval, staff creates the site directly from the request. The request's
map coordinates are copied automatically; staff never enters latitude or
longitude. Staff then adds one or more monitoring units under the request and
assigns registered nodes in physical order for each unit. Every unit must reach
active monitoring before the installation request can be completed. Do not
automatically choose nodes or promise a price before staff review.

## Linear admin workflow

1. Register each manufactured node using its factory MAC. The legacy serial field is generated automatically.
2. Approve a service request and create or select its customer site from that request.
3. Create the monitoring unit from the approved request.
4. Select nodes from inventory and assign them to the site/pipe.
5. Set the exact physical order:

   ```text
   UPSTREAM / GATEWAY → Node 2 → Node 3 → DOWNSTREAM
   ```

6. Mark exactly one node as the gateway.
7. Use the responsive deployment screen during field installation.
8. Record installation, WiFi, reading, and baseline notes.
9. Mark the deployment ready only after commissioning is complete.

## Manifest validation

The dashboard must reject:

- duplicate nodes;
- duplicate positions in one pipe;
- nodes assigned to another site or pipe;
- more than one gateway in a pipe;
- a deployment with no gateway;
- deployment of an unregistered MAC;
- assigning nodes after a deployment is marked ready;
- marking a deployment ready before its expected node count and single gateway
  are satisfied.

ExcaVision staff attaches the pre-registered nodes to the assigned site and
records where they were placed after the on-site conversation. Placement is
recorded from the agreed field layout; RS-485 cannot infer physical position.

## Ownership boundary

Ownership is per manufactured node. A pipe groups deployed nodes but is not the
product sold. Customers cannot claim, assign, reorder, or transfer nodes. The
October final product does not include resale or ownership-transfer workflows.

## Admin edit and deletion rules

Ordinary site and monitoring-unit changes are performed through the service
request that authorizes the work. The Sites screen is a reference directory and
the Installations screen executes planning and commissioning; neither duplicates
normal site or unit CRUD controls. Admins can maintain manufactured-node metadata.
Serial numbers and MAC addresses become locked after deployment because they are
hardware identity fields.

Deletion is explicit and always requires confirmation. The database rejects:

- deleting a site that still has monitoring units;
- deleting a monitoring unit that still has assigned nodes;
- deleting a manufactured node that is assigned or deployed.

These guards prevent ordinary cleanup from cascading into historical readings.

## Collection scaling

Requests, sites, monitoring units, and manufactured nodes use one server-side
free-text search field per surface, structured filters, exact result counts, and
bounded page sizes. Request search matches location, customer, company, or email.
Inventory search matches serial or MAC, with separate state and assignment
filters. Installation search matches unit or site. The browser loads only the
current page. Modal reference pickers use one clearly labeled search key, return
at most 8 matching destinations or nodes, and preserve already selected options.
Trigram indexes support partial-text search as these collections grow.

## Permissions

| Operation | Admin | Customer Engineer | Crew/Inspector |
|---|---:|---:|---:|
| Register manufactured node | yes | no | no |
| Edit or safely delete deployment records | yes | no | no |
| Assign node/site/pipe | yes | no | no |
| Define chain order/gateway | yes | no | no |
| Commission assigned deployment | yes | optional read-only | no |
| Edit alert threshold | yes | yes | no |
| View assigned readings | yes | yes | assigned site only |

## Field commissioning

ExcaVision staff uses the responsive deployment screen on site. It shows the
site, monitoring unit, ordered node list, gateway designation, status, and
commissioning notes. Staff configures gateway WiFi, confirms readings, captures
the baseline, records the result, and marks the deployment ready.

## Permanently excluded from the October final product

- Customer-side node assignment;
- customer-side ownership claiming;
- inventory purchasing/work orders;
- automatic physical-order detection from RS-485;
- public resale marketplace;
- full installer scheduling and dispatch;
- separate installer accounts or application;
- in-app email conversations and proposal generation;
- ownership transfer or resale workflows.
