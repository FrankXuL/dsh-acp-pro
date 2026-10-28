# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Category roles

Every triaged issue also carries exactly one category role. This repo's tracker uses the standard category labels:

- `bug` — something is broken
- `enhancement` — new feature or improvement

## Wayfinder labels

Comments and maps created by `/wayfinder` use a separate label set (see [issue-tracker.md](./issue-tracker.md)):

- `wayfinder:map` — the map issue
- `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task` — its child tickets
