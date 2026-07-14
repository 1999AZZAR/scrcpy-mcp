# Chrome

## Chrome/web browsing

- Package name: `com.android.chrome`
- **Web content IS accessible via `ui_dump`** when pages have proper accessibility markup (semantic HTML, ARIA). Plain pages like google.com may not expose content.
- **The WebView (`android.webkit.WebView`) is scrollable** — use `swipe` on the web content area (below the toolbar, y > 280).
- **URL bar** is an EditText at `com.android.chrome:id/url_bar`. Tap it, paste a URL via `clipboard_set`, and press `ENTER` to navigate.
- **Off-screen web elements** show as `bounds="[0,0][0,0]"` or zero-dimension bounds. Elements scrolled past the top show `bounds="[x,top][x,top]"` (height=0). Filter these out: only tap elements with positive height.
- **Chrome Custom Tabs** (opened from other apps' links) have a simpler toolbar with close, share, and minimize buttons. Use `BACK` to dismiss them.
- **Web pages with complex a11y trees** produce enormous XML dumps (30KB+). `ui_find_element` with targeted criteria is far more efficient than parsing the full `ui_dump` response.