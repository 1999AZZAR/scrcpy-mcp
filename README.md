# scrcpy-mcp

MCP server for Android device control via ADB and scrcpy. Gives AI agents vision and control over Android devices.

## Requirements

- **Node.js** >= 22
- **ADB** on PATH (or set `ADB_PATH`)
- **scrcpy-server.jar** (v3.x or v4.x) — ships with [scrcpy](https://github.com/Genymobile/scrcpy)
- **ffmpeg** — for H.264 decode and screenshots (optional, `ffmpeg-static` npm dep available)
- **ffplay** — for live video viewer (optional)

## Install

```sh
npm install
npm run build
```

## Run

```sh
node dist/server.js
```

Or with `npx`:

```sh
npx @modelcontextprotocol/inspector node dist/server.js
```

## MCP Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "scrcpy": {
      "command": "node",
      "args": ["/path/to/scrcpy-mcp/dist/server.js"],
      "env": {
        "SCRCPY_SERVER_PATH": "/usr/local/lib/scrcpy-v4.0/scrcpy-server"
      }
    }
  }
}
```

## Tools

### Session

| Tool | Action |
|---|---|
| `start_session` | Start scrcpy session for fast input/screenshots (10-50x faster). Pushes server, sets up ADB forward tunnel, connects video+control sockets. Idempotent. |
| `stop_session` | Stop session, fall back to ADB commands |
| `version` | Report scrcpy version and resolution source (env/binary/default) |

### Device

| Tool | Action |
|---|---|
| `device_list` | List connected devices with state and model |
| `device_info` | Model, Android version, SDK, screen size, battery |
| `screen_on` | Wake screen (scrcpy power message or KEYCODE_WAKEUP) |
| `screen_off` | Turn screen off |
| `connect_wifi` | Enable Wi-Fi ADB and connect wirelessly |
| `disconnect_wifi` | Disconnect wireless ADB |
| `rotate_device` | Rotate screen (needs active session) |
| `expand_notifications` | Expand notification panel |
| `expand_settings` | Expand quick settings |
| `collapse_panels` | Collapse all panels |

### Vision

| Tool | Action |
|---|---|
| `screenshot` | Capture screen. Returns scrcpy frame (JPEG) when session active, `adb screencap` (PNG) otherwise. |
| `screen_record_start` | Start `screenrecord` on device |
| `screen_record_stop` | Stop and optionally pull recording to host |

### Input

Coordinate tools accept native display coordinates matching `ui_dump` bounds.

| Tool | Action |
|---|---|
| `tap` | Tap at (x, y). scrcpy fast path -> ADB fallback. |
| `swipe` | Swipe from (x1,y1) to (x2,y2) with duration |
| `long_press` | Long press at (x, y) with duration |
| `drag_drop` | Drag from (x1,y1) to (x2,y2). Uses `input draganddrop` (API 26+) or swipe fallback. |
| `input_text` | Type text. Reports screen state, current app, session status. Auto-wakes screen if off. Auto-focuses input field. When `submit=true`, finds send button (by content-desc or resource-id) and taps it. |
| `key_event` | Send key event by name (HOME, BACK, ENTER, etc.) or keycode |
| `scroll` | Scroll at position with dx/dy delta |

### App Management

| Tool | Action |
|---|---|
| `app_start` | Launch app by package name. Prefix with `+` to force-stop first (e.g. `+com.example.app`). Uses scrcpy START_APP when session active, ADB `monkey` otherwise. |
| `app_stop` | Force-stop app |
| `app_install` | Install APK from host path |
| `app_uninstall` | Uninstall by package name |
| `app_list` | List installed packages with optional `filter` and `system`/third-party scoping |
| `app_current` | Get foreground app package and activity |

### Clipboard

| Tool | Action |
|---|---|
| `clipboard_get` | Read clipboard. scrcpy GET_CLIPBOARD (Android 10+) -> ADB with multiple parsing strategies. |
| `clipboard_set` | Set clipboard text. Optional `paste` flag with scrcpy session. |

### UI

All UI tools use `uiautomator dump --compressed` under the hood.

| Tool | Action |
|---|---|
| `ui_dump` | Raw UI hierarchy XML |
| `ui_find_element` | Find elements by text, resource-id, class, or content-desc. `text` matching falls back to `content-desc` if no text match found. Returns coordinates for each match. |
| `ui_tap_element` | Find element and tap it |
| `ui_get_state` | Token-efficient Markdown-like tree showing clickable elements and text |
| `ui_wait_for_element` | Poll UI until element appears or timeout (default 15s) |
| `ui_smart_fill` | Find element -> tap -> type text -> optional ENTER in one call |

### Shell

| Tool | Action |
|---|---|
| `shell_exec` | Run arbitrary ADB shell command |

### File

| Tool | Action |
|---|---|
| `file_push` | Copy file from host to device |
| `file_pull` | Copy file from device to host |
| `file_list` | List directory with permissions, owner, size, date |

### Video Streaming

| Tool | Action |
|---|---|
| `start_video_stream` | Start HTTP MJPEG stream at `http://127.0.0.1:<port>` and open ffplay viewer. Auto-starts session if needed. Default port 7183. |
| `stop_video_stream` | Stop stream and close viewer |

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ADB_PATH` | `adb` | ADB executable path |
| `ANDROID_SERIAL` | — | Default device serial |
| `SCRCPY_SERVER_VERSION` | `3.3.4` | Override scrcpy server version |
| `SCRCPY_SERVER_PATH` | auto-detect | Path to scrcpy-server.jar |
| `FFMPEG_PATH` | ffmpeg-static or system `ffmpeg` | ffmpeg binary |
| `FFPLAY_PATH` | `ffplay` | ffplay binary |

## Architecture

```
src/
  server.ts          — MCP server init, StdioServerTransport
  core/
    adb.ts           — ADB abstraction layer
    constants.ts     — Protocol constants, defaults
    scrcpy.ts        — Session lifecycle, control messages, video pipeline
    mjpeg.ts         — HTTP MJPEG stream server
  tools/
    session.ts       — start_session, stop_session, version
    device.ts        — device info, screen, rotation, panels, Wi-Fi
    vision.ts        — screenshot, screen recording
    input.ts         — tap, swipe, input_text, key_event, scroll, drag
    apps.ts          — app lifecycle and listing
    clipboard.ts     — clipboard get/set
    ui.ts            — UI hierarchy dump and element search
    shell.ts         — arbitrary ADB shell
    files.ts         — file push/pull/list
    video.ts         — MJPEG stream control
```

### Scrcpy sessions

Two sockets per session: video (raw H.264 from device encoder) and control (binary control messages). ffmpeg decodes H.264 to MJPEG frames in memory for screenshots and the HTTP stream. When video is unavailable (no encoder), control tools and ADB fallback still work.

### Coordinate spaces

Callers use native display coordinates (matches `wm size` and `ui_dump` bounds). The input system scales these into the downscaled encoder frame size before sending over scrcpy. Without a session, coordinates pass directly to `adb shell input tap`.

## Device Requirements

- USB debugging enabled
- ADB authorized (one-time screen tap)
- Screen can be dead/broken after authorization
- Wireless: `connect_wifi` enables TCP mode and connects

## License

MIT
