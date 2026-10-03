#meta

Adds a command for toggling read-only mode (the header's mode chip shows it as Preview).

```space-lua
-- priority: 10
function toggleReadOnlyMode()
  local ro = editor.getUiOption("forcedROMode")
  ro = not ro
  editor.setUiOption("forcedROMode", ro)
  editor.rebuildEditorState()
  if ro then
    editor.flashNotification("Read-only mode enabled")
  else
    editor.flashNotification("Read-only mode disabled")
  end
end

print("System mode", system.getMode())

if system.getMode() == "rw" then
  command.define {
    name = "Editor: Toggle Read Only Mode",
    run = toggleReadOnlyMode
  }

  -- (BlackBullet) The header's mode chip toggles Preview on every device, so
  -- the phone's lock button is gone.
end
```
