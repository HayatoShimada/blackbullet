#meta

A morning notification of what is due: how many tasks are due today and overdue, with the first three titles, sent by the search service next to the app (`memo-mcp`) at 08:00 (its `MEMO_PUSH_AT`, in `MEMO_TZ`). Tapping it opens [[^Library/Std/Pages/Today]]. Nothing is sent on a day with nothing due.

* ${widgets.commandButton("Notifications: Turn On")}: asks the browser to allow notifications and subscribes this device. Each phone or browser is turned on by itself.
* ${widgets.commandButton("Notifications: Send Test")}: sends one now to this device.
* ${widgets.commandButton("Notifications: Turn Off")}: stops them on this device.

On an iPhone or iPad, notifications only reach the installed app: in Safari, **Share → Add to Home Screen**, open the app from the Home Screen, then turn them on there.

The message is encrypted for the device; the push service that carries it (Google, Apple or Mozilla) cannot read it. To send only the counts, never titles, set `MEMO_PUSH_TITLES=off` for the service; a space marked confidential never sends titles.

```space-lua
-- priority: 10
notify = notify or {}

notify.OFF = "Notifications need the search service. Start it with ./setup.sh."

-- One request to the service's /api/push/*: the decoded body, or nil and a message.
function notify.call(method, endpoint, payload)
  local cfg, err = memo.sidecarConfig()
  if not cfg then
    return nil, err == memo.OFF and notify.OFF or err
  end
  local headers = {}
  if cfg.token and cfg.token ~= "" then
    headers.Authorization = "Bearer " .. cfg.token
  end
  local options = { method = method, headers = headers }
  if payload then
    headers["content-type"] = "application/json"
    payload.space = cfg.space
    options.body = payload
  end
  local ok, res = pcall(net.proxyFetch, cfg.base .. "/api/push/" .. endpoint, options)
  if not ok or (tonumber(res.status) or 0) >= 500 then
    return nil, notify.OFF
  end
  if res.status < 200 or res.status >= 300 then
    local detail = type(res.body) == "table" and res.body.error or tostring(res.status)
    if res.status == 404 then
      return nil, "Notifications are off on the server (" .. detail .. "). Update it with ./setup.sh."
    end
    return nil, "Notifications failed: " .. detail
  end
  return res.body
end

function notify.fail(message)
  editor.flashNotification(message, "error")
end

command.define {
  name = "Notifications: Turn On",
  run = function()
    local status = notifications.status()
    if status.needsInstall then
      editor.flashNotification("On iPhone and iPad: Share → Add to Home Screen, open the app from the Home Screen, then turn notifications on there.", "info")
      return
    end
    if not status.supported then
      notify.fail("This browser cannot receive notifications.")
      return
    end
    -- First, while the tap that started this still counts: Safari asks only then.
    local permission = notifications.requestPermission()
    if permission ~= "granted" then
      notify.fail("Notifications are blocked for this site. Allow them in the browser's site settings, then try again.")
      return
    end
    local key, err = notify.call("GET", "key")
    if not key then
      notify.fail(err)
      return
    end
    local subscription = notifications.subscribe(key.publicKey)
    local done, failure = notify.call("POST", "subscribe", { subscription = subscription })
    if not done then
      notify.fail(failure)
      return
    end
    editor.flashNotification("Notifications are on for this device: what is due arrives each morning at " .. (done.at or "08:00") .. ".")
  end,
}

command.define {
  name = "Notifications: Turn Off",
  run = function()
    local endpoint = notifications.unsubscribe()
    if not endpoint then
      editor.flashNotification("Notifications were not on for this device.")
      return
    end
    local done, failure = notify.call("POST", "unsubscribe", { endpoint = endpoint })
    if not done then
      notify.fail(failure)
      return
    end
    editor.flashNotification("Notifications are off for this device.")
  end,
}

command.define {
  name = "Notifications: Send Test",
  run = function()
    local endpoint = notifications.endpoint()
    if not endpoint then
      notify.fail("Notifications are not on for this device. Run Notifications: Turn On first.")
      return
    end
    local done, failure = notify.call("POST", "test", { endpoint = endpoint })
    if not done then
      notify.fail(failure)
      return
    end
    if (done.sent or 0) == 0 then
      notify.fail("The server does not know this device. Run Notifications: Turn On again.")
    else
      editor.flashNotification("Sent. It should arrive in a few seconds.")
    end
  end,
}
```
