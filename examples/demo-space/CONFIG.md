#meta
Settings for the demo space. The sidecar connection below this block is written by setup.sh.

```space-lua
database.define {
  name = "projects",
  tag = "project",
  folder = "Projects/",
  template = "Templates/Project",
  title = "Projects",
  properties = {
    { key = "status", type = "select", options = {"active", "someday", "done"}, default = "active", label = "Status" },
    { key = "due", type = "date", label = "Due" },
    { key = "area", type = "page", label = "Area" },
    { key = "effort", type = "number", label = "Effort (days)" },
  },
  order = {"active", "someday", "done"},
}
```
