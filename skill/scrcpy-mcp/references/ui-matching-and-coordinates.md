# UI Matching & Coordinates

## How Element Lookup Works

All UI tools (`ui_find_element`, `ui_tap_element`, `ui_wait_for_element`, `ui_smart_fill`) call `uiautomator dump` under the hood and parse the resulting XML. The XML is the ground truth — every bound, resource ID, and text label comes directly from Android's accessibility tree.

## Search Criteria

Every UI tool accepts the same filter set. You can combine them — all active filters are ANDed together.

| Parameter | Matching (default) | Matching (exactMatch=true) |
|-----------|-------------------|---------------------------|
| `text` | Case-insensitive substring | Exact string equality |
| `resourceId` | Always exact | Always exact |
| `className` | Always exact | Always exact |
| `contentDesc` | Case-insensitive substring | Exact string equality |

### When to use exactMatch

**Problem:** Partial matching on common labels returns too many elements.

```
ui_find_element(text="Meta AI")
→ 3 results:
  [0] "Ask Meta AI or Search"  (search bar label)
  [1] "@Meta AI Hello! ..."     (message preview)
  [2] "Meta AI"                 (contact name — what we want)
```

**Fix:** Use `exactMatch: true`:
```
ui_find_element(text="Meta AI", exactMatch=true)
→ 1 result: "Meta AI" (contact name)
```

### Prefer resourceId over text when available

Resource IDs are stable across locales and app updates. Get them from `ui_dump`:

```xml
<node resource-id="com.whatsapp:id/entry" ... />
```

Then:
```
ui_tap_element(resourceId="com.whatsapp:id/entry")
```

No ambiguity, no exactMatch needed.

### index parameter

When multiple elements match and you want a specific one:
```
ui_tap_element(className="android.widget.Button", index=2)
```
Selects the 3rd matching button (0-indexed). Defaults to 0.

---

## Coordinate Space

All tap/swipe/scroll coordinates are **native device pixels**.

- `device_info()` returns `screenWidth` × `screenHeight` — the native resolution.
- `start_session()` returns `screenSize` — same native resolution.
- `ui_dump` / `ui_find_element` / `ui_get_state` all return bounds in this same native space.

**You never need to scale coordinates.** The scrcpy control socket handles the internal video frame scaling automatically.

### Reading bounds from ui_dump

```xml
bounds="[154,689][293,742]"
```
→ element spans x: 154→293, y: 689→742  
→ center tap: `tapX=224, tapY=716` (pre-computed by `ui_find_element`)

### Reading coords from ui_get_state

```
- [16] Text: "Meta AI" | ID: conversations_row_contact_name (Center: 224, 716)
```
→ tap at `tap(x=224, y=716)` directly.

---

## Choosing the Right Tool

| Goal | Best tool |
|------|-----------|
| Read entire screen state | `ui_get_state()` |
| Find one specific element | `ui_find_element(resourceId=...)` |
| Tap an element | `ui_tap_element(resourceId=...)` |
| Type into a field | `ui_smart_fill(textToType=..., resourceId=...)` |
| Wait for a transition | `ui_wait_for_element(text=..., timeoutMs=5000)` |
| Debug unexpected layout | `ui_dump()` — see the full raw XML |

---

## Common Patterns

### Open a chat in WhatsApp
```
ui_tap_element(exactMatch=true, text="Meta AI")
# Confirm navigation:
app_current() → {packageName: "com.whatsapp", activity: "com.whatsapp.Conversation"}
```

### Fill a search box
```
ui_smart_fill(
  textToType="Indonesia",
  resourceId="com.android.chrome:id/url_bar",
  pressEnter=true
)
```

### Wait for a loader to disappear, then proceed
```
ui_wait_for_element(contentDesc="Send", timeoutMs=8000)
ui_tap_element(contentDesc="Send")
```
