# System & Session Management

## Session Lifecycle

### start_session

```
start_session(maxSize=1024, maxFps=30)
```

Pushes `scrcpy-server.jar` to the device, launches it via `adb shell app_process`, and opens two TCP sockets (video + control) via `adb forward`.

Returns:
```json
{
  "status": "connected",
  "serial": "37131FDJH0043G",
  "screenSize": { "width": 1080, "height": 2400 },
  "videoAvailable": true,
  "message": "scrcpy session active. Input and screenshots will use the fast path."
}
```

**`videoAvailable: false`** means the device has no usable H.264 encoder (rare). The session is still fully functional for all input/clipboard/panel tools — only `screenshot()` falls back to `adb screencap`.

### stop_session

```
stop_session()
```

Closes the control socket, kills the scrcpy server on device, stops the MJPEG server if running. All tools revert to ADB fallback.

### version

```
version()
→ { version: "2.7", source: "binary" }
```

Source can be: `"env"` (SCRCPY_SERVER_VERSION env var), `"binary"` (scrcpy CLI), `"default"` (built-in constant).

---

## WiFi ADB

### Enable wireless ADB

```
connect_wifi(port=5555)
```

1. Switches device to TCP mode: `adb tcpip 5555`
2. Reads device IP via `ip route`
3. Connects: `adb connect <ip>:5555`

Returns `{ address: "192.168.1.42:5555" }`. A USB cable is required for the initial switch — after `connect_wifi` succeeds, you can unplug.

### Disconnect wireless ADB

```
disconnect_wifi(address="192.168.1.42:5555")
```

---

## Screen Power

```
screen_on()    # WAKEUP via scrcpy or adb keyevent KEYCODE_WAKEUP
screen_off()   # SLEEP via scrcpy or adb keyevent KEYCODE_SLEEP
```

With active session: scrcpy `SET_DISPLAY_POWER` — instant, no ADB round-trip.

---

## Screen Rotation

```
rotate_device()    # ⚠️ Requires active session
```

Sends scrcpy `ROTATE_DEVICE` control message. Cycles through portrait/landscape.

---

## Panel Control (all require active session)

```
expand_notifications()    # pull notification shade
expand_settings()         # expand quick settings panel
collapse_panels()         # close all open panels
```

These bypass ADB gestures entirely — direct scrcpy protocol messages.

---

## Screen Recording

### Start recording

```
screen_record_start(
  remotePath="/sdcard/scrcpy-mcp-recording.mp4",
  duration=60           # optional max duration in seconds
)
```

- Launches `adb shell screenrecord` as a background process.
- Android imposes a **180-second maximum** per recording.
- Only one recording per device at a time.

### Stop and retrieve

```
screen_record_stop(
  pullToHost=true,
  localPath="/home/user/recording.mp4"
)
```

- Sends SIGINT to `screenrecord`, waits up to 2 seconds for clean exit.
- If `pullToHost=true`, runs `adb pull` to copy the file to host.
- If `localPath` is omitted, defaults to `./recording-<serial>.mp4`.

---

## MJPEG Live Video Stream

```
start_video_stream(port=7183)
```

Starts a scrcpy session (if not already active), then starts an HTTP MJPEG server at `http://localhost:7183`. Also attempts to open an `ffplay` viewer window.

Returns:
```json
{
  "status": "started",
  "url": "http://localhost:7183",
  "screenSize": { "width": 1080, "height": 2400 },
  "viewer": "ffplay window opened"
}
```

Stop:
```
stop_video_stream()
```

---

## File Transfer

### Push file to device

```
file_push(
  localPath="/home/user/photo.jpg",   # must be absolute path
  remotePath="/sdcard/photo.jpg"
)
```

Validates that `localPath` is absolute and exists before pushing.

### Pull file from device

```
file_pull(
  remotePath="/sdcard/photo.jpg",
  localPath="/home/user/photo.jpg"    # must be absolute path
)
```

### List device directory

```
file_list(path="/sdcard/")
```

Returns parsed `ls -la` output:
```json
{
  "path": "/sdcard/",
  "count": 12,
  "entries": [
    { "name": "DCIM", "permissions": "drwxrwx--x", "owner": "root",
      "group": "sdcard_rw", "size": 4096, "date": "2026-07-14 12:00",
      "isDirectory": true }
  ]
}
```

---

## Raw Shell Access

```
shell_exec(command="pm list packages -3")
shell_exec(command="getprop ro.build.version.release")
shell_exec(command="dumpsys battery | grep level")
```

Runs `adb shell <command>` directly. Returns stdout. Use for anything not covered by the typed tools. **Avoid using this for UI interaction** — use the UI/input tools instead.
