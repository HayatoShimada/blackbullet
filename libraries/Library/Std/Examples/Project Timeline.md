---
description: Example — projects and tasks on a timeline (drag bars to reschedule)
tags: meta
---
Pages tagged `project` on a timeline. A project with `start` and `due` is a bar; one without them is drawn from its tasks (the pages whose `project` links to it, and the tasks on its page), hatched, with how many are done. Open a project with ▸ to see and move its tasks.

```db
source: projects
view: timeline
zoom: month
```

Open tasks by start and due date (`[start: 2026-11-02] [due: 2026-11-06]` on the task's line). Drag a bar to move it, an end to stretch it:

```db
source: tasks
view: timeline
where:
  done: false
```

A database of pages can link them: `parent: "[[Tasks/Design]]"` puts a row under another, and `blockedBy: ["[[Tasks/Design]]"]` draws an arrow from that row's end to this one's start. Drag the dot at a bar's end onto another bar to add one.
