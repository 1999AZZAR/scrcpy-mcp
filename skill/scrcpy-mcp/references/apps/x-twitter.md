# X (Twitter)

## X (Twitter) specifics

- Package name: `com.twitter.android`
- **Timeline is a RecyclerView** (`android:id/list`) inside nested ViewPager + ScrollView. Scroll with `swipe`.
- **Timeline tweets store all content in `contentDesc`** — the row's `text` field is always empty. The `contentDesc` bundles author, handle, tweet body, engagement stats, and timestamp into one long string.
- **Ad tweets with external links open in Chrome Custom Tabs**, not in X's own browser. Use `BACK` to return to X.
- **Bottom navigation tabs** (5 tabs: home, search, grok, notifications, messages) are `android.widget.FrameLayout` elements with `contentDesc` labels (locale-dependent). Active tab has `selected="true"`. Discover actual labels via `ui_dump`.
- **Top timeline tabs** (e.g., "For You" / "Following") use `contentDesc` on the parent `LinearLayout`; active tab has `selected="true"`.
- **Long swipes collapse the toolbar** — toolbar and tab bar scroll away with the ViewPager's nested scroll. `BACK` restores them.
- **The new-posts banner** appears when fresh content loads while scrolled. It has `resourceId="com.twitter.android:id/banner_text"`. Tapping it scrolls to top.
- **Search/Explore tab** has a `HorizontalScrollView` sub-tab bar (`tab_layout`). Tab labels are locale-dependent; discover via `ui_dump`. Trending topic titles use `text` (not `contentDesc`).
- **Ad badge** has `resourceId="com.twitter.android:id/tweet_ad_badge_top_right"` with a short text label (locale-dependent, e.g. "Ad" / "Anuncio").