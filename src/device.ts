import { BrowserWindow, screen } from 'electron'
import * as path from 'path'
import ShortUniqueId from 'short-uuid'
import { showDevTools } from './utils' // Import utility to check if dev tools should be shown
import { updateTrayMenu } from './tray'
import { store } from './store'

export function createDeviceWindows() {
    const deviceIds = store.get('deviceIds') as string[] | undefined
    // Create windows for each device
    deviceIds?.forEach((deviceId) => {
        createDeviceWindow(deviceId)
    })
}

// Create a window for each device
export function createDeviceWindow(deviceId: string) {
    console.log(`Creating window for deviceId: ${deviceId}`)

    //get properties by deviceId
    const columnCount = store.get(`device.${deviceId}.columnCount`, 8)
    const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
    const bitmapSize = store.get(`device.${deviceId}.bitmapSize`, 72)
    const alwaysOnTop = store.get(`device.${deviceId}.alwaysOnTop`, true)
    const movable = store.get(`device.${deviceId}.movable`, false)
    const resizable = store.get(`device.${deviceId}.resizable`, false)
    const collapsed = store.get(`device.${deviceId}.collapsed`, false)
    const disablePress = store.get(`device.${deviceId}.disablePress`, false)
    const dimOnLeave = store.get(`device.${deviceId}.dimOnLeave`, false)
    const autoHide = store.get(`device.${deviceId}.autoHide`, false)
    const hideEmptyKeys = store.get(`device.${deviceId}.hideEmptyKeys`, false)
    const backgroundColor = store.get(
        `device.${deviceId}.backgroundColor`,
        '#000000'
    )
    const backgroundOpacity = store.get(
        `device.${deviceId}.backgroundOpacity`,
        0.5
    )

    const { width, height } = calculateWindowSize(
        columnCount,
        rowCount,
        bitmapSize
    )
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth } = primaryDisplay.workAreaSize

    // Restore position from store or use defaults
    const x = store.get(`device.${deviceId}.x`, screenWidth - width - 20)
    const y = store.get(`device.${deviceId}.y`, 20)

    const win = new BrowserWindow({
        width: width,
        // If this device was collapsed when the app last quit, launch
        // already collapsed instead of flashing full-size first (#40).
        height: collapsed ? COLLAPSED_HEIGHT : height,
        x: x,
        y: y,
        transparent: true,
        frame: false,
        alwaysOnTop: alwaysOnTop,
        // Resizing and collapsing fight each other (aspect-ratio lock vs. a
        // tiny fixed collapsed height), so a collapsed window is never
        // resizable - toggleDeviceCollapsed() restores this on expand.
        resizable: resizable && !collapsed,
        skipTaskbar: true,
        movable: movable,
        hasShadow: false,
        fullscreenable: false,
        focusable: true,
        title: `ScreenDeck - ${deviceId}`,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, // Enable context isolation for security
            nodeIntegration: false, // Disable nodeIntegration for security
        },
    })

    // On macOS, keep the overlay visible across all Spaces/desktops and over full-screen apps
    if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    if (resizable && !collapsed) {
        applyResizeConstraints(win, columnCount, rowCount)
    }

    win.loadFile(path.join(__dirname, '../public/index.html'), {
        query: { deviceId },
    })

    win.webContents.on('did-finish-load', () => {
        win.webContents.send('updateBackground', {
            backgroundColor,
            backgroundOpacity,
        })

        win.webContents.send('disablePress', disablePress)
    })

    //show devtools
    if (showDevTools) {
        win.webContents.openDevTools({
            mode: 'detach', // Open in a separate window
        })
    }

    //hide the window initially
    win.hide()

    // Handle window events
    win.on('focus', () => {
        win.webContents.send('windowFocused', { deviceId })
        updateTrayMenu()
    })
    win.on('blur', () => {
        win.webContents.send('windowBlurred', { deviceId })
        updateTrayMenu()
    })
    win.on('close', (event) => {
        if (global.isQuitting) {
            return
        }
        event.preventDefault() // Prevent default close behavior
        win.hide() // Hide the window instead of closing it
        win.webContents.send('windowClosed', { deviceId })
        updateTrayMenu()
    })
    win.on('show', () => {
        win.webContents.send('windowShown', { deviceId })
        updateTrayMenu()
    })
    win.on('hide', () => {
        win.webContents.send('windowHidden', { deviceId })
        updateTrayMenu()
    })

    win.on('move', () => {
        const { x, y } = win.getBounds()
        store.set(`device.${deviceId}.x`, x)
        store.set(`device.${deviceId}.y`, y)
    })

    global.deviceWindows.set(deviceId, win)
}

// Show all device windows
// When `ignoreHiddenState` is true, every device window is shown regardless of
// its persisted per-device `hidden` flag. This is used on initial app startup so
// that a device the user previously closed (which sets `hidden = true`) doesn't
// stay hidden forever. During normal operation (tray Hide/Show, in-window close
// button, etc.) callers should omit the argument to keep respecting `hidden`.
export function showWindows(ignoreHiddenState = false) {
    global.deviceWindows.forEach((win, deviceId) => {
        console.log(`Showing window for deviceId: ${deviceId}`)
        const hidden = store.get(`device.${deviceId}.hidden`, false)
        if (ignoreHiddenState || !hidden) {
            win.show()
            win.focus()
            win.webContents.send('windowShown', { deviceId })
        } else {
            win.hide()
        }
    })
    console.log('All device windows shown')
}

// Show or hide device labels in all windows
export function showDeviceLabels(show: boolean) {
    global.deviceWindows.forEach((win, deviceId) => {
        win.webContents.send('showDeviceLabel', { deviceId, show })
    })
}

// Create a new device with default settings
export function createNewDevice(): string {
    const newDeviceId = generateDeviceId()

    // Also store default per-device settings
    store.set(`device.${newDeviceId}.columnCount`, 8) // Default 8x4 layout
    store.set(`device.${newDeviceId}.rowCount`, 4) // Default 8x4 layout
    store.set(`device.${newDeviceId}.bitmapSize`, 72) // Default bitmap size
    store.set(`device.${newDeviceId}.alwaysOnTop`, true) // Default to true
    store.set(`device.${newDeviceId}.movable`, true) // Default to true
    store.set(`device.${newDeviceId}.resizable`, false) // Default to false
    store.set(`device.${newDeviceId}.dimOnLeave`, false) // Default to false
    store.set(`device.${newDeviceId}.disablePress`, false) // Default to false
    store.set(`device.${newDeviceId}.backgroundColor`, '#000000') // Default black
    store.set(`device.${newDeviceId}.backgroundOpacity`, 0.5) // Default semi-transparent

    console.log(`Generated new deviceId: ${newDeviceId}`)

    return newDeviceId
}

// Generate a new unique deviceId
function generateDeviceId(): string {
    const uuidGenerator = ShortUniqueId()
    return `screendeck-${uuidGenerator.new()}`
}

// Calculate the window size based on the number of columns, rows, and bitmap size
export function calculateWindowSize(
    columnCount: number,
    rowCount: number,
    bitmapSize: number
) {
    const KEY_WIDTH = bitmapSize
    const KEY_HEIGHT = bitmapSize
    const PADDING = 20
    const GAP = 10
    const rows = rowCount
    const width =
        columnCount * KEY_WIDTH + (columnCount - 1) * GAP + PADDING * 2
    const height = rows * KEY_HEIGHT + (rows - 1) * GAP + PADDING * 2
    return { width, height }
}

// Bounds on the effective per-key bitmap size a resizable window is allowed
// to be dragged to (issue #13) - keeps keys from shrinking to unusable
// slivers or growing to unreasonably large squares.
export const MIN_BITMAP_SIZE = 30
export const MAX_BITMAP_SIZE = 200

// Window height when a device is collapsed (issue #40) - just tall enough
// to show the drag handle strip so it stays grabbable/double-clickable.
export const COLLAPSED_HEIGHT = 36

// Locks a resizable device window's aspect ratio to the key grid's
// columns:rows so OS resize handles keep every key square, and clamps the
// draggable size range to MIN_BITMAP_SIZE..MAX_BITMAP_SIZE per key (#13).
export function applyResizeConstraints(
    win: BrowserWindow,
    columnCount: number,
    rowCount: number
) {
    win.setAspectRatio(columnCount / rowCount)

    const { width: minWidth, height: minHeight } = calculateWindowSize(
        columnCount,
        rowCount,
        MIN_BITMAP_SIZE
    )
    const { width: maxWidth, height: maxHeight } = calculateWindowSize(
        columnCount,
        rowCount,
        MAX_BITMAP_SIZE
    )
    win.setMinimumSize(minWidth, minHeight)
    win.setMaximumSize(maxWidth, maxHeight)
}

//this is for the "hide empty keys" feature
export function resizeWindowForDevice(deviceId: string) {
    const win = global.deviceWindows.get(deviceId)
    if (!win) {
        console.warn(`No window found for device ${deviceId}`)
        return
    }

    const deviceConfig = store.get(`device.${deviceId}`) as any
    const hideEmptyKeys = deviceConfig.hideEmptyKeys
    const bitmapSize = deviceConfig.bitmapSize || 72
    const columnCount = deviceConfig.columnCount || 8

    const keyMap = global.keyStates.get(deviceId)
    if (!hideEmptyKeys || !keyMap || keyMap.size === 0) {
        // Default grid size
        const { width, height } = calculateWindowSize(
            columnCount,
            deviceConfig.rowCount || 4,
            bitmapSize
        )
        // On Windows, BrowserWindow.setBounds() can behave unreliably on
        // resizable: false windows, sometimes only applying one axis of the
        // resize (see #33). Temporarily allow resizing around the call as a
        // workaround.
        win.setResizable(true)
        win.setBounds({
            width,
            height,
            x: win.getBounds().x,
            y: win.getBounds().y,
        })
        win.setResizable(false)
        return
    }

    // Find used keys
    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity
    for (const keyIndex of keyMap.keys()) {
        const x = keyIndex % columnCount
        const y = Math.floor(keyIndex / columnCount)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
    }

    const visibleCols = maxX - minX + 1
    const visibleRows = maxY - minY + 1

    const { width, height } = calculateWindowSize(
        visibleCols,
        visibleRows,
        bitmapSize
    )
    console.log(
        `[Resize] ${deviceId}: ${visibleCols} cols x ${visibleRows} rows → ${width}x${height}`
    )

    // On Windows, BrowserWindow.setBounds() can behave unreliably on
    // resizable: false windows, sometimes only applying one axis of the
    // resize (see #33). Temporarily allow resizing around the call as a
    // workaround.
    win.setResizable(true)
    win.setBounds({
        width,
        height,
        x: win.getBounds().x,
        y: win.getBounds().y,
    })
    win.setResizable(false)
}
