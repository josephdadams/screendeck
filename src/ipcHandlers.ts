import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { createSatellite, getNextProfileName } from './utils'
import { updateTrayMenu } from './tray'

import {
    registerHotkey,
    registerToggleAllHotkey,
    registerToggleDeviceHotkey,
    unregisterHotkey,
    unregisterAllHotkeysForDevice,
} from './hotkeys' // Import the hotkey registration function
import {
    createNewDevice,
    createDeviceWindow,
    calculateWindowSize,
    showDeviceLabels,
    resizeWindowForDevice,
    applyResizeConstraints,
    COLLAPSED_HEIGHT,
} from './device' // Import the device ID creation function
import { store } from './store'

// Applies a partial (or full) device config: saves it to the store, updates
// the live BrowserWindow, resizes it if needed, and notifies the renderer.
// Shared by the `updateDeviceConfig` and `resetDeviceToDefaults` handlers.
function applyDeviceConfig(deviceId: string, config: Record<string, any>) {
    let needsDeviceUpdate = false

    // Check if key properties have actually changed
    for (const key of ['columnCount', 'rowCount', 'bitmapSize', 'name']) {
        const oldValue = store.get(`device.${deviceId}.${key}`)
        const newValue = config[key]

        if (newValue !== undefined && newValue !== oldValue) {
            needsDeviceUpdate = true
            break
        }
    }

    // Save all config values
    Object.entries(config).forEach(([key, value]) => {
        const fullKey = `device.${deviceId}.${key}`

        if (value === undefined) {
            store.delete(fullKey as any)
        } else {
            store.set(fullKey, value)
        }
    })

    console.log(`Device ${deviceId} config updated:`, config)

    // Update the BrowserWindow properties
    const win = global.deviceWindows.get(deviceId)
    if (win) {
        if (config.alwaysOnTop !== undefined) {
            win.setAlwaysOnTop(Boolean(config.alwaysOnTop))
        }
        if (config.movable !== undefined) {
            win.setMovable(Boolean(config.movable))
        }
        if (config.resizable !== undefined) {
            const isResizable = Boolean(config.resizable)
            win.setResizable(isResizable)
            if (isResizable) {
                const columnCount = store.get(
                    `device.${deviceId}.columnCount`,
                    8
                )
                const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
                applyResizeConstraints(win, columnCount, rowCount)
            }
        }
        if (config.disablePress !== undefined) {
            win.webContents.send('disablePress', Boolean(config.disablePress))
        }
        if (config.edgeReveal !== undefined) {
            // Turning edgeReveal on hands visibility control to the poll
            // loop (startEdgeRevealPolling), so hide immediately rather than
            // waiting for the cursor to move; turning it off falls back to
            // being purely `hidden`-controlled, so show immediately (#10).
            if (Boolean(config.edgeReveal)) {
                win.hide()
            } else {
                win.show()
            }
        }
        if (config.dimOnLeave !== undefined) {
            win.webContents.send('dimOnLeave', Boolean(config.dimOnLeave))
        }
        if (config.autoHide !== undefined) {
            win.webContents.send('autoHide', Boolean(config.autoHide))
        }
        if (config.hideEmptyKeys !== undefined) {
            resizeWindowForDevice(deviceId)
            win.webContents.send(
                'hideEmptyKeys',
                Boolean(config.hideEmptyKeys)
            )
        }

        // Resize window if columnCount/rowCount/bitmapSize changed
        if (needsDeviceUpdate) {
            const columnCount = store.get(`device.${deviceId}.columnCount`, 8)
            const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
            const bitmapSize = store.get(`device.${deviceId}.bitmapSize`, 72)

            const { width, height } = calculateWindowSize(
                columnCount,
                rowCount,
                bitmapSize
            )

            // On Windows, BrowserWindow.setSize() can behave unreliably on
            // resizable: false windows, sometimes only applying one axis of
            // the resize (see #33). Temporarily allow resizing around the
            // call as a workaround, then restore the device's actual
            // configured resizable state (not unconditionally false - #13
            // added a real per-device resizable setting).
            const isResizable = store.get(
                `device.${deviceId}.resizable`,
                false
            ) as boolean
            win.setResizable(true)
            win.setSize(width, height)
            win.setResizable(isResizable)
            if (isResizable) {
                applyResizeConstraints(win, columnCount, rowCount)
            }

            // If the Satellite client is connected and key properties changed, update the device config
            if (global.satelliteClient) {
                global.satelliteClient.removeDevice(deviceId)
                const productName = store.get(
                    `device.${deviceId}.name`,
                    'ScreenDeck'
                )
                global.satelliteClient.addDevice(deviceId, productName, {
                    columnCount: store.get(
                        `device.${deviceId}.columnCount`,
                        8
                    ),
                    rowCount: store.get(`device.${deviceId}.rowCount`, 4),
                    bitmapSize: store.get(
                        `device.${deviceId}.bitmapSize`,
                        72
                    ),
                    colours: true,
                    text: true,
                    brightness: true,
                    pincodeMap: null,
                })
            }

            win.webContents.send('rebuildGrid', {
                columnCount,
                rowCount,
                bitmapSize,
            })
        }

        // Update background color/opacity *live*
        if (
            config.backgroundColor !== undefined ||
            config.backgroundOpacity !== undefined
        ) {
            const backgroundColor = store.get(
                `device.${deviceId}.backgroundColor`,
                '#000000'
            )
            const backgroundOpacity = store.get(
                `device.${deviceId}.backgroundOpacity`,
                0.5
            )

            console.log('Updating background color/opacity:', {
                backgroundColor,
                backgroundOpacity,
            })

            win.webContents.send('updateBackground', {
                backgroundColor,
                backgroundOpacity,
            })
        }

        // Skip the usual "make sure it's visible" show() if we just
        // intentionally hid this window to hand control to the edgeReveal
        // poll loop (#10) - otherwise this would immediately undo that.
        if (!(config.edgeReveal !== undefined && Boolean(config.edgeReveal))) {
            win.show()
        }
    }

    updateTrayMenu()
}

export function initializeIpcHandlers() {
    ipcMain.handle('getDeviceConfig', (_event, deviceId) => {
        const name = store.get(`device.${deviceId}.name`, 'ScreenDeck')
        const columnCount = store.get(`device.${deviceId}.columnCount`, 8)
        const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
        const bitmapSize = store.get(`device.${deviceId}.bitmapSize`, 72)
        const alwaysOnTop = store.get(`device.${deviceId}.alwaysOnTop`, false)
        const movable = store.get(`device.${deviceId}.movable`, true)
        const resizable = store.get(`device.${deviceId}.resizable`, false)
        const disablePress = store.get(`device.${deviceId}.disablePress`, false)
        const dimOnLeave = store.get(`device.${deviceId}.dimOnLeave`, false)
        const autoHide = store.get(`device.${deviceId}.autoHide`, false)
        const edgeReveal = store.get(`device.${deviceId}.edgeReveal`, false)
        const hideEmptyKeys = store.get(
            `device.${deviceId}.hideEmptyKeys`,
            false
        )
        const backgroundColor = store.get(
            `device.${deviceId}.backgroundColor`,
            '#000000'
        )
        const backgroundOpacity = store.get(
            `device.${deviceId}.backgroundOpacity`,
            0.5
        )

        return {
            name,
            columnCount,
            rowCount,
            bitmapSize,
            alwaysOnTop,
            movable,
            resizable,
            disablePress,
            dimOnLeave,
            autoHide,
            edgeReveal,
            hideEmptyKeys,
            backgroundColor,
            backgroundOpacity,
        }
    })

    ipcMain.handle('getKeypadBounds', (_event, deviceId) => {
        const win = global.deviceWindows?.get(deviceId)
        if (win) {
            const bounds = win.getBounds()
            const bitmapSize = store.get(`device.${deviceId}.bitmapSize`, 72)
            return { ...bounds, bitmapSize }
        }
        return null
    })

    ipcMain.handle(
        'resizeKeypadWindow',
        (_event, { deviceId, width, height }) => {
            const win = global.deviceWindows?.get(deviceId)
            if (win) {
                win.setBounds({
                    ...win.getBounds(),
                    width,
                    height,
                })
            }
        }
    )

    ipcMain.handle('closeKeypad', (_event, deviceId) => {
        const win = global.deviceWindows?.get(deviceId)
        if (win) {
            win.hide()
            store.set(`device.${deviceId}.hidden`, true)
        }

        updateTrayMenu()
    })

    // Handle keyPress events (from renderer)
    ipcMain.on('keyPress', (_event, { deviceId, x, y, action }) => {
        if (!global.satelliteClient) return

        const disablePress = store.get(`device.${deviceId}.disablePress`, false)
        if (disablePress) {
            console.log(`Button presses disabled for ${deviceId}. Ignoring.`)
            return
        }

        if (action === 'down') {
            global.satelliteClient.keyDownXY(deviceId, x, y)
        } else if (action === 'up') {
            global.satelliteClient.keyUpXY(deviceId, x, y)
        } else if (action === 'rotateLeft') {
            global.satelliteClient.rotateLeftXY(deviceId, x, y)
        } else if (action === 'rotateRight') {
            global.satelliteClient.rotateRightXY(deviceId, x, y)
        }
    })

    ipcMain.handle('getKeyConfig', (_event, { deviceId, keyIndex }) => {
        return {
            isEncoder: store.get(
                `device.${deviceId}.key.${keyIndex}.isEncoder`,
                false
            ),
            stepSize: store.get(
                `device.${deviceId}.key.${keyIndex}.stepSize`,
                10
            ),
            isSticky: store.get(
                `device.${deviceId}.key.${keyIndex}.isSticky`,
                false
            ),
            verticalEncoder: store.get(
                `device.${deviceId}.key.${keyIndex}.verticalEncoder`,
                false
            ),
        }
    })

    ipcMain.handle(
        'updateKeyConfig',
        (_event, { deviceId, keyIndex, config }) => {
            const existing = {
                isEncoder: store.get(
                    `device.${deviceId}.key.${keyIndex}.isEncoder`,
                    false
                ),
                stepSize: store.get(
                    `device.${deviceId}.key.${keyIndex}.stepSize`,
                    10
                ),
                isSticky: store.get(
                    `device.${deviceId}.key.${keyIndex}.isSticky`,
                    false
                ),
                verticalEncoder: store.get(
                    `device.${deviceId}.key.${keyIndex}.verticalEncoder`,
                    false
                ),
            }
            const merged = { ...existing, ...config }
            store.set(`device.${deviceId}.key.${keyIndex}.isEncoder`, merged.isEncoder)
            store.set(`device.${deviceId}.key.${keyIndex}.stepSize`, merged.stepSize)
            store.set(`device.${deviceId}.key.${keyIndex}.isSticky`, merged.isSticky)
            store.set(
                `device.${deviceId}.key.${keyIndex}.verticalEncoder`,
                merged.verticalEncoder
            )
        }
    )

    ipcMain.handle('toggleEncoder', (_event, { deviceId, keyIndex }) => {
        const current = store.get(
            `device.${deviceId}.key.${keyIndex}.isEncoder`,
            false
        )
        const newValue = !current
        store.set(`device.${deviceId}.key.${keyIndex}.isEncoder`, newValue)
        return newValue
    })

    // Handle brightness request from renderer (optional)
    ipcMain.handle('setBrightness', (_event, brightness) => {
        global.deviceWindows?.forEach((win) => {
            win.webContents.send('brightness', brightness)
        })
    })

    //HOTKEYS
    ipcMain.handle('setHotkeyContext', (_event, context) => {
        global.hotkeyContext = context
    })

    // Get the current context for the hotkey prompt (what's being assigned:
    // a specific key, "show/hide all", or "show/hide one device")
    ipcMain.handle('getHotkeyContext', (_event) => {
        const context = global.hotkeyContext

        if (!context) {
            return undefined
        }

        // Get list of current hotkeys, of every kind
        const hotkeys = []
        for (const [hotkey, binding] of global.registeredHotkeys.entries()) {
            hotkeys.push({ hotkey, ...binding })
        }

        return {
            ...context,
            currentHotkeys: hotkeys,
        }
    })

    ipcMain.handle('openHotkeyPrompt', () => {
        if (
            global.hotkeyPromptWindow &&
            !global.hotkeyPromptWindow.isDestroyed()
        ) {
            global.hotkeyPromptWindow.focus()
            return
        }

        const focusedWindow = BrowserWindow.getFocusedWindow()
        const win = new BrowserWindow({
            width: 500,
            height: 800,
            modal: true, // 👈 This makes it modal
            ...(focusedWindow ? { parent: focusedWindow } : {}),
            resizable: false,
            minimizable: false,
            maximizable: false,
            frame: false,
            title: 'Assign Hotkey',
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
            },
        })

        win.loadFile(path.join(__dirname, '../public/hotkeyPrompt.html'))

        //show dev tools
        win.webContents.openDevTools({ mode: 'detach' })

        win.on('show', () => showDeviceLabels(true))
        win.on('hide', () => showDeviceLabels(false))
        win.on('close', () => showDeviceLabels(false))

        global.hotkeyPromptWindow = win

        win.on('closed', () => {
            global.hotkeyPromptWindow = null
        })
    })

    ipcMain.handle('closeHotkeyPrompt', () => {
        if (
            global.hotkeyPromptWindow &&
            !global.hotkeyPromptWindow.isDestroyed()
        ) {
            global.hotkeyPromptWindow.close()
        }
    })

    // Handle assignHotkey - the payload is a HotkeyBinding plus the chosen
    // hotkey string, covering per-key hotkeys as well as the "show/hide all"
    // and "show/hide one device" app-level hotkeys (issue #38)
    ipcMain.handle('assignHotkey', (_event, { hotkey, ...context }) => {
        let success = false

        if (context.kind === 'key') {
            const { deviceId, keyIndex } = context
            success = registerHotkey(hotkey, deviceId, keyIndex)
            if (success) {
                const keyConfig = store.get(
                    `device.${deviceId}.keys`,
                    {}
                ) as Record<number, { hotkey?: string }>
                keyConfig[keyIndex] = {
                    ...(keyConfig[keyIndex] || {}),
                    hotkey,
                }
                store.set(`device.${deviceId}.keys`, keyConfig)
            }
        } else if (context.kind === 'toggleAll') {
            success = registerToggleAllHotkey(hotkey)
            if (success) {
                store.set('appHotkeys.toggleAll', hotkey)
            }
        } else if (context.kind === 'toggleDevice') {
            const { deviceId } = context
            success = registerToggleDeviceHotkey(hotkey, deviceId)
            if (success) {
                store.set(`device.${deviceId}.toggleHotkey`, hotkey)
            }
        }

        return success
    })

    ipcMain.handle('clearHotkey', (_event, { hotkey, ...context }) => {
        unregisterHotkey(hotkey)

        if (context.kind === 'toggleAll') {
            store.delete('appHotkeys.toggleAll' as any)
            return true
        }

        if (context.kind === 'toggleDevice') {
            store.delete(`device.${context.deviceId}.toggleHotkey` as any)
            return true
        }

        const { deviceId, keyIndex } = context
        const keyConfig = store.get(`device.${deviceId}.keys`, {}) as Record<
            number,
            { hotkey?: string }
        >
        if (keyConfig[keyIndex]) {
            delete keyConfig[keyIndex].hotkey
            store.set(`device.${deviceId}.keys`, keyConfig)
        }

        return true
    })

    ipcMain.handle('showDeviceLabels', (_event, show) => {
        showDeviceLabels(show)
    })

    //SETTINGS
    ipcMain.handle('createNewDevice', () => {
        const newDeviceId = createNewDevice()

        let deviceIds = store.get('deviceIds', []) as string[]
        deviceIds.push(newDeviceId)
        store.set('deviceIds', deviceIds)

        // Create the window
        createDeviceWindow(newDeviceId)

        global.satelliteClient?.addDevice(
            newDeviceId,
            store.get(`device.${newDeviceId}.name`, 'ScreenDeck'),
            {
                columnCount: store.get(
                    `device.${newDeviceId}.columnCount`,
                    8
                ),
                rowCount: store.get(`device.${newDeviceId}.rowCount`, 4),
                bitmapSize: store.get(
                    `device.${newDeviceId}.bitmapSize`,
                    72
                ),
                colours: true,
                text: true,
                brightness: true,
                pincodeMap: null,
            }
        )

        return newDeviceId
    })

    ipcMain.handle('getAllDevices', () => {
        const deviceIds = store.get('deviceIds', []) as string[]
        return deviceIds.map((id) => ({
            deviceId: id,
            name: store.get(`device.${id}.name`, 'ScreenDeck'),
            toggleHotkey: store.get(`device.${id}.toggleHotkey`, null),
            columnCount: store.get(`device.${id}.columnCount`, 8),
            rowCount: store.get(`device.${id}.rowCount`, 4),
            bitmapSize: store.get(`device.${id}.bitmapSize`, 72),
            alwaysOnTop: store.get(`device.${id}.alwaysOnTop`, false),
            movable: store.get(`device.${id}.movable`, true),
            resizable: store.get(`device.${id}.resizable`, false),
            disablePress: store.get(`device.${id}.disablePress`, false),
            dimOnLeave: store.get(`device.${id}.dimOnLeave`, false),
            autoHide: store.get(`device.${id}.autoHide`, false),
            edgeReveal: store.get(`device.${id}.edgeReveal`, false),
            hideEmptyKeys: store.get(`device.${id}.hideEmptyKeys`, false),
            backgroundColor: store.get(
                `device.${id}.backgroundColor`,
                '#000000'
            ),
            backgroundOpacity: store.get(`device.${id}.backgroundOpacity`, 0.5),
        }))
    })

    ipcMain.handle('updateDeviceConfig', (_event, { deviceId, config }) => {
        applyDeviceConfig(deviceId, config)
    })

    ipcMain.handle('resetDeviceToDefaults', (_event, deviceId) => {
        // Mirrors the defaults set in device.ts's createNewDevice()
        const defaultConfig = {
            columnCount: 8,
            rowCount: 4,
            bitmapSize: 72,
            alwaysOnTop: true,
            movable: true,
            resizable: false,
            disablePress: false,
            dimOnLeave: false,
            backgroundColor: '#000000',
            backgroundOpacity: 0.5,
        }

        applyDeviceConfig(deviceId, defaultConfig)

        console.log(`Device ${deviceId} reset to defaults.`)

        return defaultConfig
    })

    // Double-click the drag handle collapses a device down to just its top
    // strip, or restores it back to its full grid size (issue #40). Mutually
    // exclusive with resizing (#13): while collapsed, resizing is disabled
    // and the aspect-ratio lock is released, both restored on expand.
    ipcMain.handle('toggleDeviceCollapsed', (_event, deviceId) => {
        const win = global.deviceWindows.get(deviceId)
        if (!win) return false

        const collapsed = !store.get(`device.${deviceId}.collapsed`, false)
        store.set(`device.${deviceId}.collapsed`, collapsed)

        const { x, y, width } = win.getBounds()
        const resizable = store.get(
            `device.${deviceId}.resizable`,
            false
        ) as boolean

        if (collapsed) {
            if (resizable) {
                win.setAspectRatio(0)
            }
            win.setResizable(false)
            win.setBounds({ x, y, width, height: COLLAPSED_HEIGHT })
        } else {
            const columnCount = store.get(`device.${deviceId}.columnCount`, 8)
            const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
            const bitmapSize = store.get(`device.${deviceId}.bitmapSize`, 72)
            const { height } = calculateWindowSize(
                columnCount,
                rowCount,
                bitmapSize
            )

            win.setBounds({ x, y, width, height })

            if (resizable) {
                win.setResizable(true)
                applyResizeConstraints(win, columnCount, rowCount)
            }
        }

        return collapsed
    })

    ipcMain.handle('deleteDevice', (_event, deviceId) => {
        let deviceIds = store.get('deviceIds', []) as string[]
        deviceIds = deviceIds.filter((id) => id !== deviceId)
        store.set('deviceIds', deviceIds)

        // Remove all device-specific settings
        const keys = Object.keys(store.store)
        keys.forEach((key) => {
            if (key.startsWith(`device.${deviceId}.`)) {
                store.delete(key as any)
            }
        })

        // Unregister any global hotkeys associated with this device
        unregisterAllHotkeysForDevice(deviceId)

        // Close the window
        const win = global.deviceWindows.get(deviceId)
        if (win) {
            win.close()
            global.deviceWindows.delete(deviceId)
        }

        // If the Satellite client is connected, remove the device
        if (global.satelliteClient) {
            global.satelliteClient.removeDevice(deviceId)
        }
        console.log(`Device ${deviceId} deleted.`)
    })

    ipcMain.handle('getSettings', () => {
        return store.store
    })

    // Handle saving settings
    ipcMain.handle('saveSettings', (_event, newSettings) => {
        const previousIP = store.get('companionIP', '127.0.0.1')
        const previousPort = store.get('companionPort', 16622)

        store.set(newSettings)

        const newIP = newSettings.companionIP
        const newPort = newSettings.companionPort

        if (newIP !== previousIP || newPort !== previousPort) {
            console.log(
                'Companion IP or port changed, restarting connection...'
            )

            if (global.satelliteClient) {
                global.satelliteClient.disconnect() // Your close method for the new API
                global.satelliteClient = null
            }

            // Wait briefly, then reconnect with the new IP/port
            setTimeout(() => {
                createSatellite() // Your function to initialize the Satellite client
            }, 500)
        }
    })

    ipcMain.handle('closeSettingsWindow', () => {
        const settingsWindow = global.settingsWindow
        if (settingsWindow) {
            settingsWindow.close()
        }
    })

    //PROFILE MANAGEMENT
    ipcMain.handle('getNextProfileName', () => {
        return getNextProfileName()
    })
}
