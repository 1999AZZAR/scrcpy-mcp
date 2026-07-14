# WhatsApp

## WhatsApp specifics

- Package name: `com.whatsapp`
- Prefix with `+` to force-stop before launch: `+com.whatsapp`
- **Bottom tab bar** has 4 tabs (`android.widget.FrameLayout` elements): chats, updates, communities, calls. Active tab has `selected="true"`. Tab labels are locale-dependent — discover via `ui_dump`.
- **Chat list** is a RecyclerView at `android:id/list` with `com.whatsapp:id/contact_row_container` rows. Contact names are in `com.whatsapp:id/conversations_row_contact_name` (`text` field).
- **Chat screen**: contact name at `com.whatsapp:id/conversation_contact_name`, last-seen at `com.whatsapp:id/conversation_contact_status`.
- **Input field**: `com.whatsapp:id/entry` (`android.widget.EditText`) — tap to focus, then use `clipboard_set` with `paste: true` (requires active scrcpy session) for any text with non-ASCII characters. See **Non-ASCII text input** above.
- **Send**: use `key_event` with `ENTER` instead of tapping the send button.
- **Photo**: contact photo has contentDesc like "Photo of <name>" (locale-dependent pattern).