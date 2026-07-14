# Text Input

## Method Comparison

| Method | Tool | Best for |
|--------|------|----------|
| scrcpy inject | `input_text(text)` | Unicode, emoji, any character. Fastest. |
| ADB input text | `input_text(text)` (fallback) | ASCII. Spaces encoded as `%s`. Special chars escaped. |
| Clipboard paste | `clipboard_set(text, paste=true)` | Long texts, complex Unicode. Bypasses keyboard entirely. |
| Smart fill | `ui_smart_fill(textToType, ...)` | Combines: find element → tap → type → optional Enter. |

## Recommended: ui_smart_fill

Collapses 3-4 steps into one:

```
ui_smart_fill(
  textToType="Hello World",
  resourceId="com.whatsapp:id/entry",
  pressEnter=false
)
```

Internally: finds element → taps it → waits 500ms for keyboard → injects text via scrcpy or ADB.

## scrcpy Text Injection (input_text)

When a session is active, `input_text` uses the scrcpy `INJECT_TEXT` control message.
- Handles full Unicode including emoji and CJK characters.
- Does **not** require the keyboard to be visible.
- Max 2^31 bytes per call (effectively unlimited for normal text).

When no session is active, falls back to `adb shell input text "..."` with special character escaping (spaces → `%s`, brackets/semicolons/etc. backslash-escaped).

## Clipboard Paste Strategy

Best for long text or when keyboard injection fails:

```
clipboard_set(text="A very long paragraph...", paste=true)
```

`paste=true` sets the clipboard AND immediately simulates a paste action (Ctrl+V equivalent) in one call. Requires active session.

Without session:
```
clipboard_set(text="...")          # sets clipboard via ADB
key_event(keycode="ENTER")         # or tap send manually
```

## Pressing Enter / Submit

After typing, submit with:
- `ui_smart_fill(..., pressEnter=true)` — built-in
- `key_event(keycode="ENTER")` — keycode 66
- `ui_tap_element(resourceId="com.whatsapp:id/send")` — tap the send button

## ADB Escaping (no-session fallback only)

When ADB fallback is used, these characters are auto-escaped:
`\ " ' (space) ( ) [ ] { } | ; < > & * ? $ \` !`

Spaces become `%s` in the ADB command (Android input convention).

You should **not** pre-escape text yourself — the tool handles it. Just pass the raw string.
