# ScreenDeck Code Review

Review of the current codebase (`src/`, `public/`) covering bugs and suggested
improvements. Line numbers refer to the state of the repo at review time.

## Bugs

### High impact

1. **DevTools always open, even in production builds** — [src/utils.ts:15-18](src/utils.ts#L15)
   ```ts
   export const showDevTools =
       process.env.NODE_ENV === 'development' ||
       process.env.DEBUG_PROD === 'true' ||
       true
   ```
   The trailing `|| true` makes this constant always `true` regardless of the
   env checks. Every window (device windows, settings, hotkey prompt, profile
   prompt) opens a detached DevTools window on launch for all users, in every
   build. This looks like a leftover debug flag. Should be
   `process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'`.

2. **"Hide All / Show All Screen Decks" persists state under the wrong key** — [src/tray.ts:69](src/tray.ts#L69), [src/tray.ts:82](src/tray.ts#L82)
   ```ts
   global.deviceWindows.forEach((win) => {
       if (win.isVisible()) {
           win.hide()
           store.set(`device.${win.webContents.id}.hidden`, true)
       }
   })
   ```
   `win.webContents.id` is Electron's internal numeric WebContents id, not the
   app's `deviceId` string used everywhere else (e.g. `showWindows()` in
   [src/device.ts:137](src/device.ts#L137) reads `device.${deviceId}.hidden`).
   As a result, using "Hide All"/"Show All" from the tray writes the hidden
   flag to a key that nothing ever reads, so the visibility choice is not
   persisted across restarts. `global.deviceWindows` is a `Map<deviceId, win>`
   — the forEach callback should use the `deviceId` key instead:
   `global.deviceWindows.forEach((win, deviceId) => ...)`.

3. **Deleting a device leaves its global hotkeys registered** — [src/ipcHandlers.ts:464-489](src/ipcHandlers.ts#L464)
   `deleteDevice` removes the device from the store, closes its window, and
   removes it from the satellite client, but never calls
   `unregisterAllHotkeysForDevice(deviceId)` (defined in
   [src/hotkeys.ts:66](src/hotkeys.ts#L66) but never called from anywhere).
   The OS-level global shortcut stays registered and pointing at a deleted
   device until the app restarts, silently doing nothing when pressed and
   blocking that key combo from being reused.

4. **Quit handler works around, rather than fixes, a close/quit conflict** — [src/tray.ts:191-219](src/tray.ts#L191), [src/device.ts:109-114](src/device.ts#L109)
   Every device window's `close` handler unconditionally calls
   `event.preventDefault()` and hides the window instead of closing it. The
   tray's "Quit" handler calls `win.close()` on each window (which just hides
   them, since `preventDefault()` fires regardless of quit intent) and then
   `app.quit()`, which can't actually terminate because windows never really
   close. The code compensates with a hard `process.exit(0)` after a 1s
   `setTimeout`, which skips Electron's normal shutdown/cleanup and is
   presumably why `eac80cc "fix tray destroy error"` was needed. A cleaner fix
   is a module-level `isQuitting` flag set before quitting, checked in the
   `close` handler to allow the real close to proceed.

5. **`CompanionSatelliteClient.addDevice` pending-device check is inverted** — [src/client.ts:660-663](src/client.ts#L660)
   ```ts
   const pendingTime = this._pendingDevices.get(deviceId)
   if (pendingTime && pendingTime < Date.now() - 10000) {
       throw new Error('Device is already being added')
   }
   ```
   This throws when the pending request is *stale* (older than 10s) and lets
   a *fresh* pending request (added moments ago) through, which is backwards.
   As written, calling `addDevice` twice in quick succession for the same
   device (e.g. rapid settings changes) sends a duplicate `ADD-DEVICE` while
   one is already in flight, and a genuinely stuck/stale entry never gets
   cleared or retried. The condition should be `pendingTime > Date.now() - 10000`
   to reject recent duplicates (and ideally clear the stale entry rather than
   throwing).

### Medium impact

6. **Encoder drag attaches a new `window` "mouseenter" listener on every mousedown, never removed** — [public/index.js:466-469](public/index.js#L466)
   ```js
   window.addEventListener('mouseenter', () => {
       window.focus()
   })
   window.addEventListener('mousemove', onMove)
   window.addEventListener('mouseup', onUp)
   ```
   `onMove`/`onUp` are removed in `onUp`, but the `mouseenter` listener is
   anonymous and is never removed. Every encoder drag interaction during a
   session leaks one more permanent listener on `window`, so repeated use of
   an encoder causes `window.focus()` to fire multiple times per mouse-enter
   and listeners to accumulate for the lifetime of the window.

7. **`registerHotkey` always stores an empty image, discarding the value it just computed** — [src/hotkeys.ts:32-47](src/hotkeys.ts#L32)
   ```ts
   let imageBase64 = ''
   const deviceMap = global.keyStates.get(deviceId)
   if (deviceMap) {
       const keyState = deviceMap.get(keyIndex)
       if (keyState) {
           imageBase64 = keyState.imageBase64 || ''
       }
   }
   global.registeredHotkeys.set(hotkey, {
       deviceId,
       keyIndex,
       imageBase64: '',   // <-- should be `imageBase64`
   })
   ```
   The looked-up `imageBase64` is never used. This mainly affects
   `loadHotkeysFromStore()` on app start — the hotkey list in the "Assign
   Hotkey" dialog shows a blank preview for every previously-assigned hotkey
   until Companion happens to redraw that key.

8. **`dimOnLeave` config changes stack duplicate `mouseleave`/`mouseenter` listeners** — [public/index.js:791-807](public/index.js#L791)
   `configureDimOnLeave()` is called once at load and again every time the
   `dimOnLeave` IPC event fires (i.e., each time the user saves that setting
   from the Settings window), but when `dimOnLeave` is `true` it unconditionally
   calls `addEventListener` without ever removing a previous listener. Toggling
   the setting off/on repeatedly during one session piles up redundant
   listeners.

9. **`hideEmptyKeys` and `autoHide` device settings have no UI in the Settings window** — [public/settings.js:145-155](public/settings.js#L145)
   ```js
   ;[
       alwaysOnTopInput,
       movableInput,
       disablePressInput,
       dimOnLeaveInput,
       //autoHideInput,
       //hideEmptyKeysInput,
   ].forEach(...)
   ```
   The checkboxes are created but commented out of the rendered list, and the
   `Save` handler's `config` object also has the corresponding lines commented
   out ([public/settings.js:182-183](public/settings.js#L182)). These settings
   still work if set directly in the store, and `hideEmptyKeys` is read and
   partially applied in `index.js`, but end users currently have no way to
   turn either feature on from the UI.

10. **Auto-hide-on-mouse-leave feature is entirely dead code** — [public/index.js:129-178](public/index.js#L129)
    `hideKeypad()`/`showKeypad()` implement the shrink-to-logo behavior, but
    every listener that would call them is commented out
    (`mouseleave`/`mouseenter`/`mousemove` handlers). Combined with #9, the
    "Auto Hide on Mouse Leave" setting is currently non-functional even though
    it's still fetched from config (`globalAutoHideOnLeave`) and referenced in
    hover state code, e.g. `closeButton` opacity toggling on
    `mouseenter`/`mouseleave`.

11. **`resizeWindowForDevice` is unreachable** — [src/device.ts:200](src/device.ts#L200)
    Exported and imported into `ipcHandlers.ts`, but both call sites are
    commented out ([src/utils.ts:107](src/utils.ts#L107),
    [src/ipcHandlers.ts:380](src/ipcHandlers.ts#L380)). The "hide empty keys →
    shrink window" behavior it implements never actually runs.

## Suggestions / improvements

- **Don't expose a raw IPC passthrough from preload.** [src/preload.ts:6-7](src/preload.ts#L6)
  exposes generic `invoke(channel, data)` / `send(channel, data)` wrappers that
  let renderer code call *any* registered IPC handler with arbitrary
  arguments. This defeats much of the purpose of `contextIsolation` /
  `nodeIntegration: false` as a security boundary — if any renderer ever loads
  untrusted/remote content (or a dependency introduces one), it gets full
  access to every privileged main-process handler. Prefer whitelisting each
  IPC call as its own named method (the file already does this for a few, e.g.
  `getDeviceConfig`), and drop the generic `invoke`/`send`.

- **Centralize the `electron-store` instance.** Nearly every main-process file
  (`utils.ts`, `device.ts`, `ipcHandlers.ts`, `tray.ts`, `hotkeys.ts`)
  constructs its own `new Store(...)`, and two of them (`tray.ts`,
  `hotkeys.ts`) omit `{ defaults: defaultSettings }` while the rest include it.
  Since it's the same underlying file, this happens to work today, but it's
  easy for a future default to only get added in one place and silently not
  apply elsewhere. A single exported `store` from one module would remove the
  duplication and the inconsistency.

- **`updateKeyConfig` does a full overwrite instead of a merge** — [src/ipcHandlers.ts:129-139](src/ipcHandlers.ts#L129)
  Every call resets `isEncoder`/`stepSize`/`isSticky` to defaults for any
  field the caller didn't include. Right now the context menu only ever sends
  one or two fields at a time, so e.g. picking "Set to Encoder Mode" silently
  resets `stepSize` back to `10` even if it had been customized. Worth merging
  with the existing stored config (`{ ...currentConfig, ...config }`) once
  more per-key options are added.

- **Escape/validate values written into the Satellite protocol.** [src/client.ts:695-719](src/client.ts#L695)
  `sendMessage` wraps string values in `"..."` without escaping embedded
  quotes/backslashes. Device IDs are internally generated so this is low risk
  today, but if variable names/values or product names ever include a `"`,
  the line would be malformed. Consider escaping per the same convention
  `parseLineParameters` already unescapes (`\"`).

- **`hexToRgba` assumes a 6-digit hex color** — [public/index.js:1-9](public/index.js#L1)
  The `<input type="color">` in Settings always produces 6-digit hex, but if
  `backgroundColor` is ever set to a 3-digit shorthand (or an invalid string)
  via the store directly, the bit-shifting math silently produces a wrong
  color rather than failing loudly. Worth normalizing/validating the input.

- **Remove large blocks of commented-out code** rather than leaving them in
  place — notably [src/utils.ts:290-322](src/utils.ts#L290) (the old
  `loadProfile` restart logic) and the several commented IPC calls noted
  above. Since `loadProfile` now does `app.relaunch()`, the dead branch below
  it can be deleted rather than kept as a comment.

- **`keysTotal` is an implicit global** in `buildKeyGrid` — [public/index.js:201](public/index.js#L201)
  ```js
  keysTotal = columnCount * rowCount
  ```
  Never declared with `let`/`const`, so it becomes an implicit global in
  non-strict script mode. Harmless today, but would throw a `ReferenceError`
  if the script is ever loaded as a module or under `"use strict"`.

## Feature ideas

- **Expose the "Hide Empty Keys" and "Auto Hide" toggles in Settings** and
  finish the auto-hide interaction (see bugs #9/#10) — the groundwork
  (shrink-to-logo animation, config plumbing) is already there.
- **Per-key custom step size UI** for encoders — `stepSize` is fully wired
  through IPC and the store, but there's no way for a user to set anything
  other than the default `10` short of editing the store file directly.
- **A visible "un-stick" affordance for sticky buttons** — the context menu
  can set Encoder / Button / Sticky Button modes, but there's no dedicated
  "Clear Sticky" menu item distinct from re-selecting "Button Mode (Normal)",
  which is easy to miss.
- **Surface connection state in the UI**, not just the tray menu — e.g. a
  small indicator on each device window when Companion is disconnected/
  reconnecting, so users don't have to open the tray menu to check.
- **Conflict feedback when a hotkey is already in use** — `registerHotkey`
  and `isHotkeyConflict` exist, but the hotkey prompt UI doesn't call
  `isHotkeyConflict` before submitting, so the only feedback on a collision
  is a generic failure with no explanation of which key/device is holding it.
- **A "reset to default" for individual device settings** in the Settings
  window, so a device that's been resized/moved oddly can be restored without
  deleting and recreating it.
