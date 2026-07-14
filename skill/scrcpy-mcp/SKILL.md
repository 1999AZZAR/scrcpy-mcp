---
name: scrcpy-mcp
description: "Professional Android automation agent for device interaction, UI testing, and app management. Use for: (1) interacting with Android apps, (2) filling inputs, (3) structural UI inspection via XML/axtree, (4) complex multi-step mobile tasks. Prefer XML/axtree over screenshots — images are expensive tokens."
---

# scrcpy-mcp

Android automation via scrcpy's control socket + ADB fallback. Every tool auto-falls back to ADB when no session is active. Call MCP tools directly — no shell wrappers needed.

## Session Lifecycle

```
start_session()          → opens scrcpy control socket (fast path)
  ↓  all input/clipboard/screen tools use scrcpy protocol (10-50x faster)
stop_session()           → closes socket, tools revert to ADB
```

`start_session` is optional but **strongly recommended** for any task with more than one interaction. Without it, every tool incurs an ADB round-trip (~100-300ms each).

> Some tools **require** an active session: `rotate_device`, `expand_notifications`, `expand_settings`, `collapse_panels`. They will error if called without one.

---

## Observation Cost Hierarchy — ALWAYS follow this order

| Priority | Tool | Cost | When to use |
|----------|------|------|-------------|
| **1st** | `ui_get_state()` | Cheap — text | Default for all state checks. Compressed axtree: only visible, interactive elements. |
| **2nd** | `ui_find_element(...)` | Cheap — text | Targeted lookup when you know what you're looking for. |
| **3rd** | `ui_dump()` | Cheap — text | Full raw XML when `ui_get_state` misses something. |
| **4th** | `app_current()` | Cheap — text | Verify which app/activity is in the foreground. |
| **LAST** | `screenshot()` | **EXPENSIVE — image** | Only when rendered pixels matter (images, charts, colors). |

> ⚠️ **Never call `screenshot()` to verify an action or read screen state.** Use `ui_get_state()` or `app_current()` instead.

---

## Full Tool Dispatch Table

### Session
| Task | Call | Notes |
|------|------|-------|
| Start fast-path session | `start_session(maxSize?, maxFps?)` | Do this first. Unlocks scrcpy control socket. |
| Stop session | `stop_session()` | Reverts all tools to ADB |
| Check scrcpy version | `version()` | Reports version + detection source |

### Device
| Task | Call | Notes |
|------|------|-------|
| List connected devices | `device_list()` | Serial, state, model, product |
| Get device details | `device_info()` | Model, Android version, SDK, screen size, battery |
| Wake screen | `screen_on()` | scrcpy fast path or `KEYCODE_WAKEUP` |
| Sleep screen | `screen_off()` | scrcpy fast path or `KEYCODE_SLEEP` |
| Rotate screen | `rotate_device()` | **Requires active session** |
| Expand notification panel | `expand_notifications()` | **Requires active session** |
| Expand quick settings | `expand_settings()` | **Requires active session** |
| Collapse all panels | `collapse_panels()` | **Requires active session** |
| Enable WiFi ADB | `connect_wifi(port?)` | Auto-detects device IP, default port 5555 |
| Disconnect WiFi ADB | `disconnect_wifi(address)` | Format: `192.168.x.x:5555` |

### UI Inspection
| Task | Call | Notes |
|------|------|-------|
| Compressed axtree (default) | `ui_get_state()` | Text-only, filters empty/invisible nodes. Use first. |
| Full raw XML hierarchy | `ui_dump()` | All nodes including invisible. Use if `ui_get_state` misses an element. |
| Find element(s) by criteria | `ui_find_element(text?, resourceId?, className?, contentDesc?, exactMatch?)` | Returns list of matches + tap coords |
| Tap a found element | `ui_tap_element(text?, resourceId?, className?, contentDesc?, exactMatch?, index?)` | Find + tap in one call |
| Wait for element to appear | `ui_wait_for_element(text?, resourceId?, className?, contentDesc?, exactMatch?, timeoutMs?)` | Polls until found or timeout |
| Find, tap, type, submit | `ui_smart_fill(textToType, resourceId?, text?, exactMatch?, pressEnter?)` | 4 actions → 1 call |

### Input & Gestures
| Task | Call | Notes |
|------|------|-------|
| Tap coordinates | `tap(x, y)` | Native pixel coords matching ui_dump bounds |
| Swipe gesture | `swipe(x1, y1, x2, y2, duration?)` | Default 300ms |
| Long press | `long_press(x, y, duration?)` | Default 500ms |
| Drag and drop | `drag_drop(startX, startY, endX, endY, duration?)` | Uses `input draganddrop` on API 26+, swipe fallback |
| Type text | `input_text(text)` | scrcpy inject (handles Unicode). ADB fallback. |
| Send key event | `key_event(keycode)` | Name (`HOME`, `BACK`, `ENTER`, `APP_SWITCH`…) or numeric |
| Scroll | `scroll(x, y, dx, dy)` | scrcpy scroll event. ADB swipe fallback. |

### App Management
| Task | Call | Notes |
|------|------|-------|
| Launch app | `app_start(packageName)` | scrcpy START_APP fast path or ADB monkey. Prefix `+` to force-stop first. |
| Force-stop app | `app_stop(packageName)` | `am force-stop` |
| Get foreground app | `app_current()` | Returns package + activity via `dumpsys window` |
| List installed apps | `app_list(filter?, system?)` | `system=true` → system only, `false` → 3rd-party only |
| Install APK | `app_install(apkPath)` | Absolute host path to .apk |
| Uninstall app | `app_uninstall(packageName)` | |

### Clipboard
| Task | Call | Notes |
|------|------|-------|
| Read clipboard | `clipboard_get()` | scrcpy GET_CLIPBOARD or ADB `cmd clipboard get` (API 31+) |
| Write clipboard | `clipboard_set(text, paste?)` | scrcpy SET_CLIPBOARD. `paste=true` also simulates Ctrl+V. |

### Vision / Recording
| Task | Call | Notes |
|------|------|-------|
| Screenshot | `screenshot()` | ⚠️ **Image = expensive.** scrcpy JPEG frame (fast) or `adb screencap` fallback |
| Start MJPEG stream | `start_video_stream(port?)` | HTTP MJPEG at `http://localhost:PORT`. Auto-starts session. Opens ffplay viewer. |
| Stop MJPEG stream | `stop_video_stream()` | |
| Start screen recording | `screen_record_start(remotePath?, duration?)` | `screenrecord` on device |
| Stop screen recording | `screen_record_stop(pullToHost?, localPath?)` | Optionally pulls .mp4 to host |

### Files & Shell
| Task | Call | Notes |
|------|------|-------|
| Push file to device | `file_push(localPath, remotePath)` | `adb push` |
| Pull file from device | `file_pull(remotePath, localPath)` | `adb pull` |
| List device directory | `file_list(path)` | `ls -la` parsed output |
| Run shell command | `shell_exec(command)` | Raw `adb shell`. Use for one-off ADB commands not covered by other tools. |

---

## Key Behaviours & Gotchas

### exactMatch parameter
`ui_find_element`, `ui_tap_element`, `ui_wait_for_element`, `ui_smart_fill` all support `exactMatch: true`.

- `exactMatch: false` (default) → substring, case-insensitive
- `exactMatch: true` → exact string equality

**Always use `exactMatch: true` when the label is ambiguous.** Example: searching `"Meta AI"` without exactMatch returns 3 elements ("Ask Meta AI or Search", message preview, contact name). With exactMatch, it returns only the contact name.

### Coordinate space
All tap/swipe coordinates are **native device pixels**, matching `ui_dump` bounds directly. The scrcpy protocol internally scales to the video frame size — you never need to do this manually.

### app_start fast path
- With active session: uses scrcpy `START_APP` control message — nearly instant.
- Without session: uses `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1`.
- `+com.example.app` prefix: force-stops the app first, then launches.

### clipboard_set with paste
`clipboard_set(text, paste=true)` sets clipboard AND simulates a paste action in one step — useful for injecting long text into a focused field.

### screen_record limits
Android's `screenrecord` has a 180-second device limit per recording. Use `duration` param to set a shorter cutoff.

---

## References & Deep Dives

For complex tasks, consult the specific reference guides:

### Core Concepts
- [UI Matching & Coordinates](references/ui-matching-and-coordinates.md) — exactMatch, resourceId strategies, bounds
- [Text Input](references/text-input.md) — Unicode, clipboard paste, ADB escaping
- [Gestures & Navigation](references/gestures-and-navigation.md) — scroll vs swipe, key events, app switching
- [System & Session Management](references/system-and-session.md) — session lifecycle, WiFi ADB, recording, file transfers

### App-Specific Guides
When automating these apps, read the reference first:
- [WhatsApp](references/apps/whatsapp.md)
- [Chrome / Web Browsing](references/apps/chrome.md)
- [X (Twitter)](references/apps/x-twitter.md)
- [Android Settings](references/apps/settings.md)
- [Quick Settings / Status Bar](references/apps/quick-settings.md)
- [Launcher & App Drawer](references/apps/launcher.md)
