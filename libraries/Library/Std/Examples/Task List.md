---
description: Example — every open task, with its page and due date
tags: meta
---
Open tasks across the space. Tick the box to complete one; double-click a due date to change it. Both are written to the task's own line.

```db
source: tasks
view: table
where:
  done: false
sort: due
limit: 100
```

On a calendar (drag a task to another day to move its due date):

```db
source: tasks
view: calendar
where:
  done: false
```
