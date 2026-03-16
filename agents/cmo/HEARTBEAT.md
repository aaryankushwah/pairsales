# CMO Heartbeat Checklist

Run this procedure every time you are woken up. Follow each step in order. Do not skip steps.

---

## Step 1 — Check for new directives from the human

```
GET /api/issues?assignee=cmo&status=todo
```

- If the list is empty, skip to Step 3.
- For each new directive, continue to Step 2.

---

## Step 2 — Break each directive into subtasks and assign

For each `todo` task assigned to you:

1. Read the task body carefully. Identify the goal, constraints, and any deadlines mentioned.
2. Use `web_search` if you need context (competitor analysis, industry benchmarks) before writing a brief.
3. Determine which subordinate agent(s) should own the work:
   - **Content Manager** — blog posts, social copy, newsletters, editorial planning
   - **Growth Manager** — paid acquisition, SEO strategy, conversion experiments
   - **Analytics Manager** — performance reports, attribution, data pulls
4. For each subtask, POST to the task API:
   ```
   POST /api/issues
   Body: { title, body, assigneeAgentId, status: "todo", priority }
   ```
   The `body` field must include: objective, acceptance criteria, deadline (if any), and any context the agent needs to execute without asking follow-up questions.
5. After creating all subtasks, move the parent directive to `in_progress`:
   ```
   PATCH /api/issues/:id
   Body: { status: "in_progress" }
   ```
6. Post a comment summarising your assignments:
   ```
   POST /api/issues/:id/comments
   Body: { body: "Subtasks created: [list with task IDs and owners]" }
   ```

---

## Step 3 — Check status of in-progress work

```
GET /api/issues?assignee=content-manager&status=in_progress
GET /api/issues?assignee=growth-manager&status=in_progress
GET /api/issues?assignee=analytics-manager&status=in_progress
```

- For each task, check if it has been stuck in `in_progress` for longer than expected (use the `updatedAt` field).
- If a task appears stalled (no updates in >24h), post a comment asking for a status update:
  ```
  POST /api/issues/:id/comments
  Body: { body: "Status check — any blockers on this? Please update or flag." }
  ```

---

## Step 4 — Review outputs in `in_review`

```
GET /api/issues?assignee=cmo&status=in_review
```

For each task in `in_review`:

1. Read the task body and all comments to find the deliverable.
2. Evaluate against the original acceptance criteria.
3. **If approved:**
   ```
   POST /api/issues/:id/comments
   Body: { body: "APPROVED — [one sentence rationale]" }

   PATCH /api/issues/:id
   Body: { status: "done" }
   ```
4. **If revision required:**
   ```
   POST /api/issues/:id/comments
   Body: { body: "REVISION REQUIRED\n\n1. [specific change]\n2. [specific change]" }

   PATCH /api/issues/:id
   Body: { status: "in_progress" }
   ```
   Be specific. Do not move back to `in_progress` without a numbered list of exact changes needed.

---

## Step 5 — Report blockers

If at any point you encountered:
- A task you cannot assign (no suitable subordinate agent exists)
- A subordinate agent that is unresponsive
- A directive that is ambiguous and cannot be executed without human clarification

Post a comment on the relevant task flagging the blocker:
```
POST /api/issues/:id/comments
Body: { body: "BLOCKER: [clear description of what is blocked and what is needed to unblock]" }
```

Then respond to the human with a brief summary of any blockers that require their attention.

---

## Completion

If all steps are complete and there is nothing pending, respond with:

```
HEARTBEAT_OK — No pending actions. [brief status: N tasks in_progress, N in_review, N done today]
```
