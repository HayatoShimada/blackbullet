#meta

What to do today, one page you can keep on a phone's home screen (the **Today** shortcut of the installed app). Tick a box to finish a task; tap a date to move it. Everything is written back to the task's own line or the page's frontmatter.

**Inbox:** ${#query[[from p = index.pages() where p.name:startsWith("Inbox/") select p.name]]} waiting · [[Inbox]]

```db
title: Overdue
source: tasks
where:
  done: false
  due: {before: today}
sort: due
limit: 50
```

```db
title: Due today
source: tasks
where:
  done: false
  due: {gte: today, lte: today}
limit: 50
```

```db
title: This week
source: tasks
where:
  done: false
  due: {after: today, lte: today+7}
sort: due
limit: 50
```

Task pages (tagged `todo`) that are next, or due by today:

```db
title: Next
source: tag:todo
where:
  status: next
sort: due
columns: [title, due, project]
limit: 50
```

```db
title: Task pages due
source: tag:todo
where:
  status: {not: done}
  due: {lte: today}
sort: due
columns: [title, status, due, project]
limit: 50
```
