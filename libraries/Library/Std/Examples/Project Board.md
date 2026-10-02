---
description: Example — your projects as a board (drag a card to change its status)
tags: meta
---
Pages tagged `project`, one column per `status`. Drag a card to another column to change that page's `status`.

```db
source: projects
view: board
```

The same pages as a table you can edit in place, and by due date:

```db
source: projects
view: table
sort: due
```

```db
source: projects
view: calendar
```
