# Quick Settings

## Quick Settings tiles

- `expand_settings` opens the Quick Settings panel (requires active scrcpy session). `collapse_panels` closes it.
- **Tiles are `android.widget.Switch`** widgets with `checkable="true"` and `checked="true"/"false"`. Use `checked` to determine state; `text` shows locale-dependent on/off labels.
- **Compound contentDesc**: Switch tiles bundle state info as comma-separated `contentDesc`. Example: WiFi tile → `"Wi-Fi,<signal-strength>,<ssid>"`.
- **Non-toggle tiles** (like battery saver, screenshot) use `android.widget.LinearLayout` with `clickable="true"` instead of Switch.
- **The tiles are paged** via an `androidx.viewpager.widget.ViewPager` (`quick_settings_panel`). A page indicator shows the current page (contentDesc like "Page 1 of 2"). Swipe horizontally on the ViewPager to change pages.
- **Brightness slider** is an `android.widget.SeekBar` at `com.android.systemui:id/slider`.
- **Footer buttons**: edit button (`android:id/edit`), user switch, settings gear (opens Settings app).
- To **toggle a tile**, find it by a stable substring of its `contentDesc` (e.g., "Flashlight" for English, "Linterna" for Spanish — discover via `ui_dump` first) and tap its center coordinates.

```typescript
// Toggle the flashlight tile (find by contentDesc substring)
const tile = ui_find_element({ contentDesc: "flashlight" })  // try English first
if (!tile.count) tile = ui_find_element({ contentDesc: "linterna" }) // fall back
tap({ x: tile.elements[0].tapX, y: tile.elements[0].tapY })
// Verify: tile.text changed, checked flipped
```

- **System UI elements** use package `com.android.systemui`. Quick settings, notifications, and status bar are not part of regular app windows — they overlay the existing content.