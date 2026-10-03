Start with a note, check what is due, or open a project.

${widgets.commandButton("Quick note", "Quick Note")} ${widgets.commandButton("Today's journal", "Journal: Today")} ${widgets.button("Search", function()
  local commands = system.listCommands()
  editor.invokeCommand(commands["Search: Notes"] and "Search: Notes" or "Memo: Search")
end)}

${(function()
  -- Phones have no keyboard shortcuts to learn; the buttons above are the way in.
  if editor.isMobile() then return "" end
  local commands = system.listCommands()
  local search = commands["Search: Notes"] or commands["Memo: Search"]
  local key = search and search.key
  if type(key) == "table" then key = key[1] end
  local hint = "`Ctrl-q q` quick note, `Ctrl-q j` today's journal"
  if key then hint = hint .. ", `" .. key .. "` search" end
  return "_" .. hint .. ". The ? button in the header opens the guide._"
end)()}

# Due soon
${some(query[[
  from t = index.tasks()
  where not t.done and t.due
    and not string.find(t.page, "^Templates/")
    and not string.find(t.page, "^Library/")
    and not string.find(t.page, "^Trash/")
  order by t.due
  limit 10
  select templates.taskItem(t)
]]) or "_Nothing due. Tasks you write as `* [ ]` anywhere show up here._"}

# Active projects
```db
database: projects
view: table
columns: [title, status, due, area]
where:
  status: active
sort: due
limit: 5
```
[[Tasks|All projects and tasks]]

# Recent journal entries
${some(query[[
  from j = index.pages(config.get("journal.tag"))
  where j.tag == "page"
  order by j.date desc
  limit 7
  select templates.pageItem(j)
]]) or "_No journal entries yet. Today's journal starts one._"}

# Recently modified pages
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 10
  select templates.fullPageItem(p)
]]}
