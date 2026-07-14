# Gestures & Navigation

## Tap

```
tap(x=540, y=1200)
```

Coordinates are native device pixels. Get them from `ui_get_state()` (Center: x, y) or `ui_find_element()` (tapX, tapY).

With an active session: scrcpy `INJECT_TOUCH_EVENT` (ACTION_DOWN → 10ms sleep → ACTION_UP).  
Without session: `adb shell input tap x y`.

## Swipe

```
swipe(x1=540, y1=1800, x2=540, y2=400, duration=300)
```

- `duration` in milliseconds (default 300ms).
- With session: interpolates intermediate MOVE events at ~16ms intervals for smooth gesture.
- Without session: `adb shell input swipe`.

**Scroll vs Swipe:** Use `scroll()` for content scrolling (uses the scrcpy scroll event which respects fling/inertia). Use `swipe()` for navigation gestures like going back or swiping between tabs.

## Scroll

```
scroll(x=540, y=1200, dx=0, dy=3)
```

- `dx` / `dy` are scroll amounts. Positive dy = scroll down. Negative dy = scroll up.
- With session: uses scrcpy `INJECT_SCROLL_EVENT` — respects momentum/fling.
- Without session: converts to a swipe gesture over 300ms at 100px per unit.

## Long Press

```
long_press(x=540, y=1200, duration=500)
```

Default 500ms. With session: DOWN → sleep(duration) → UP via scrcpy.  
Without session: `adb shell input swipe x y x y duration` (same point, no movement).

## Drag and Drop

```
drag_drop(startX=200, startY=400, endX=800, endY=1200, duration=500)
```

- API 26+ (Android 8+): `adb shell input draganddrop`.
- Older: falls back to swipe.
- With session: uses scrcpy swipe (same as gesture swipe, no special drag protocol).

## Key Events

```
key_event(keycode="HOME")
key_event(keycode="BACK")
key_event(keycode="APP_SWITCH")
key_event(keycode=187)          # numeric also accepted
```

Full keycode map supported:

| Name | Code | Effect |
|------|------|--------|
| `HOME` | 3 | Go to launcher |
| `BACK` | 4 | Navigate back |
| `APP_SWITCH` | 187 | Open recent apps |
| `ENTER` | 66 | Submit / confirm |
| `DELETE` | 67 | Backspace |
| `TAB` | 61 | Tab |
| `MENU` | 82 | App menu |
| `VOLUME_UP` | 24 | |
| `VOLUME_DOWN` | 25 | |
| `POWER` | 26 | |
| `CAMERA` | 27 | |
| `WAKEUP` | 224 | Wake screen |
| `SLEEP` | 223 | Sleep screen |
| `DPAD_UP/DOWN/LEFT/RIGHT/CENTER` | 19-23 | D-pad |
| `MEDIA_PLAY_PAUSE` | 85 | |
| `MEDIA_NEXT` | 87 | |
| `MEDIA_PREVIOUS` | 88 | |
| `BRIGHTNESS_UP` | 221 | |
| `BRIGHTNESS_DOWN` | 220 | |
| `NOTIFICATION` | 83 | |

With session: scrcpy `INJECT_KEYCODE` (DOWN + UP).  
Without session: `adb shell input keyevent`.

## App Switching

### Fast: app_start (recommended)
```
app_start(packageName="com.android.chrome")
```
With session: scrcpy `START_APP` — near-instant.  
Without session: ADB monkey launch.

### Force-stop then launch
```
app_start(packageName="+com.android.chrome")
```
The `+` prefix force-stops the app first, then launches. Useful for a clean app state.

### Open recent apps overlay
```
key_event(keycode="APP_SWITCH")   # opens recents
```
Then tap an app thumbnail via `ui_tap_element`.

### Verify foreground app (no screenshot needed)
```
app_current()
→ { packageName: "com.android.chrome", activity: "com.google.android.apps.chrome.Main" }
```

## Panel Control (requires active session)

```
expand_notifications()    # pull down notification shade
expand_settings()         # pull down quick settings (double-swipe)
collapse_panels()         # dismiss all panels
```

These use scrcpy control messages directly — no ADB needed and faster than a swipe gesture.
