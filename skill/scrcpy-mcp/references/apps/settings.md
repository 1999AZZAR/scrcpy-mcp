# Settings

## Settings deep navigation

- Package name: `com.android.settings`
- **Each sub-screen replaces the main view** — a back button (contentDesc like "Navigate up", locale-dependent), title, and search icon appear at the top.
- **Navigation depth** is unlimited; each level adds to the back stack. `BACK` returns one level.
- **Switch/toggle widgets** are `android.widget.Switch` with `checkable="true"`, `checked="true"|"false"`. The `text` shows on/off state (locale-dependent, e.g. "On"/"Off"). The parent row also has `checkable="true"`.
- **WiFi network rows** use comma-separated `contentDesc` on the clickable row: `<ssid>,<status>,<signal>,<security>`. The title and summary are separate `text` fields.
- **Scanning status** appears as a `ProgressBar` with resource ID `com.android.settings:id/progress_bar_animation` and a scanning message (locale-dependent).
- **Items with settings gears** have child elements like `com.android.settings:id/settings_button_no_background`.