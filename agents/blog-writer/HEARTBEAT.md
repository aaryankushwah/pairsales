# Blog Writer Heartbeat Checklist

Run this procedure every time you are woken up. Follow each step in order.

---

## Step 1 — Check for assigned tasks

```
GET /api/issues?assignee=blog-writer&status=todo
```

- If the list is empty, skip to Step 7.
- If there are tasks, continue to Step 2.

Also check for tasks that have been returned for revision:
```
GET /api/issues?assignee=blog-writer&status=in_progress
```

If any `in_progress` tasks have comments containing "REVISION REQUIRED", treat them as your first priority before picking up new `todo` tasks. Jump to Step 2b for those.

---

## Step 2a — Pick the highest priority new task

From the `todo` list, select the task with the highest priority (check the `priority` field: `high` > `medium` > `low`). If priorities are equal, pick the oldest by `createdAt`.

Move it to `in_progress` immediately so it is not picked up by another run:
```
PATCH /api/issues/:id
Body: { status: "in_progress" }
```

Read the full task body. Note: topic, target audience, angle, word count, any specific sources or keywords requested.

---

## Step 2b — Handle a revision task (if applicable)

If you are working a revision:

1. Read all comments on the task in order:
   ```
   GET /api/issues/:id/comments
   ```
2. Find the comment(s) from the reviewer containing "REVISION REQUIRED".
3. List every requested change. You must address all of them — not just the first one.
4. Find your previous draft (it will be in an earlier comment on the same task).
5. Continue to Step 3 with the revision context in mind.

---

## Step 3 — Research the topic

Using the task brief, run targeted searches to gather supporting material:

1. Search for authoritative sources on the main topic:
   ```
   web_search("[topic] [angle] [year if relevant]")
   ```
2. Search for data points, statistics, or case studies that support your argument:
   ```
   web_search("[topic] statistics data [year]")
   ```
3. Search for what competitors or industry publications have already written (so you can differentiate):
   ```
   web_search("[topic] blog [industry]")
   ```
4. Use `web_fetch` to read the most relevant 2–3 URLs in full and extract quotes, data, or key insights.
5. Keep a running list of source URLs — you will need them for the sources section.

Do not proceed to writing until you have completed at least 2 searches and fetched at least 1 source.

---

## Step 4 — Write the blog post draft

Write the complete post in Markdown following the Output Format in your SOUL.md:

- YAML frontmatter at the top (title, date, status: draft, tags, author: blog-writer)
- Introduction with a clear hook
- Body sections with H2/H3 headings (aim for 3–5 sections)
- Conclusion with a clear takeaway or call to action
- Sources section listing every URL you used

Target word count: follow the brief. Default is 1000–1500 words if not specified.

For revisions: apply every requested change from the reviewer's comments. Do not resubmit the old draft with minor tweaks and hope for the best.

---

## Step 5 — Post the draft as a task comment

```
POST /api/issues/:id/comments
Body: {
  "body": "[full Markdown draft including frontmatter]"
}
```

Confirm the comment was created successfully (check the response status).

---

## Step 6 — Move the task to `in_review`

```
PATCH /api/issues/:id
Body: { status: "in_review" }
```

The task is now in the reviewer's queue. Your work on this task is complete until it is either approved or returned with revision feedback.

---

## Step 7 — No tasks available

If there are no `todo` or `in_progress` tasks assigned to you, respond with:

```
HEARTBEAT_OK — No pending blog tasks. Awaiting assignment.
```

Do not invent tasks. Do not write speculative content. Wait for the next heartbeat.
