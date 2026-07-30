# People P0 demo script (Cycle 2)

## Setup
1. Ensure `ff_people_module` is enabled (default).
2. Open app with seeded org / employees.

## Flow A — Directory (REQ-082, REQ-083)
1. Nav → **People**.
2. Confirm Directory tab lists employees; search and filter work.
3. Add or edit an employee; save succeeds.

## Flow B — Profile lifecycle (REQ-084, REQ-085, REQ-087, REQ-088)
1. Open a person from Directory chips → Profile.
2. Attempt invalid transition (Onboarding → Start notice) → error toast.
3. Complete onboarding → Active.
4. Add salary revision → CTC updates and history row appears.
5. If employee has payroll history, Hard delete → rejected message.

## Flow C — Attendance (REQ-086)
1. Attendance tab → select employee/month → set a day to Present.
2. Reload month → status persists.

## Flow D — Leaves (REQ-089)
1. Leaves tab → create leave request → approve.

## Flow E — Flag off (REQ-090)
1. `localStorage.setItem('suez_ff_ff_people_module','false')` → reload.
2. People nav hidden; Payroll remains.
