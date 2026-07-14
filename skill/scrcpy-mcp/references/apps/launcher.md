# Launcher

## Launcher home screen + app drawer

- The launcher workspace is an `android.widget.ScrollView` with `com.android.launcher3:id/workspace`. Horizontal swipes navigate between home screen pages.
- **The bottom dock** (fixed app shortcuts) stays visible across all pages. App labels vary by device.
- **App drawer opens with a swipe-up** from the bottom of the home screen — tapping the app-list icon alone may not work.
- The app drawer contains:
  - A search `EditText` at `com.android.launcher3:id/fallback_search_view` with a placeholder hint (locale-dependent)
  - An `androidx.recyclerview.widget.RecyclerView` (`com.android.launcher3:id/apps_list_view`) with app icons as `android.widget.TextView` elements
  - A prediction row (`com.android.launcher3:id/prediction_row`) showing 5 suggested apps at the top
- App icons have both `text` and `contentDesc` set to the same app name. Off-screen icons show `bounds="[0,0][0,0]"`.
- **Widgets** on home screens (clocks, fitness, search bars) appear as `LauncherAppWidgetHostView` nodes with descriptive `contentDesc` (e.g. "At a Glance" / "De un vistazo", "Digital Clock" / "Reloj digital").