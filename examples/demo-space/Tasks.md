# Open tasks
Tick a box to complete a task. Tasks written as `* [ ]` on any page show up here.

```db
source: tasks
view: table
title: Open tasks
columns: [done, title, due, page]
where:
  done: false
sort: due
limit: 100
```

# Calendar
```db
source: tasks
view: calendar
where:
  done: false
weekStart: 1
```

# Projects board
```db
database: projects
view: board
group: status
```

# Projects table
```db
database: projects
view: table
columns: [title, status, due, area, effort, modified]
sort: due
```
