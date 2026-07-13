import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import Store from 'electron-store'
import { defaultSettings } from './defaults'
import { createSatellite, getNextProfileName } from './utils'
import { updateTrayMenu } from './tray'

import {
    registerHotkey,
    unregisterHotkey,
    unregisterAllHotkeysForDevice,
} from './hotkeys' // Import the hotkey registration function
import {
    createNewDevice,
    createDeviceWindow,
    calculateWindowSize,
    showDeviceLabels,
    resizeWindowForDevice,
} from './device' // Import the device ID creation function

const store = new Store({ defaults: defaultSettings })

export function initializeIpcHandlers() {
    ipcMain.handle('getDeviceConfig', (_event, deviceId) => {
        const columnCount = store.get(`device.${deviceId}.columnCount`, 8)
        const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
        const bitmapSize = store.get(`device.${deviceId}.bitmapSize`, 72)
        const alwaysOnTop = store.get(`device.${deviceId}.alwaysOnTop`, false)
        const movable = store.get(`device.${deviceId}.movable`, true)
        const disablePress = store.get(`device.${deviceId}.disablePress`, false)
        const autoHide = store.get(`device.${deviceId}.autoHide`, false)
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
            columnCount,
            rowCount,
            bitmapSize,
            alwaysOnTop,
            movable,
            disablePress,
            autoHide,
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
        }
    })

    ipcMain.handle(
        'updateKeyConfig',
        (_event, { deviceId, keyIndex, config }) => {
            const isEncoder = config.isEncoder ?? false
            const stepSize = config.stepSize ?? 10
            const isSticky = config.isSticky ?? false
            store.set(`device.${deviceId}.key.${keyIndex}.isEncoder`, isEncoder)
            store.set(`device.${deviceId}.key.${keyIndex}.stepSize`, stepSize)
            store.set(`device.${deviceId}.key.${keyIndex}.isSticky`, isSticky)
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
    ipcMain.handle(
        'setHotkeyContext',
        (_event, { deviceId, keyIndex, imageBase64 }) => {
            global.hotkeyContext = { deviceId, keyIndex, imageBase64 }
        }
    )

    // Get key context for the hotkey prompt
    ipcMain.handle('getHotkeyContext', (_event) => {
        const context = global.hotkeyContext // deviceId, keyIndex, imageBase64

        if (!context) {
            return undefined
        }

        const { deviceId, keyIndex, imageBase64 } = context

        // Get list of current hotkeys
        const hotkeys = []
        for (const [hotkey, mapping] of global.registeredHotkeys.entries()) {
            hotkeys.push({
                hotkey,
                deviceId: mapping.deviceId,
                keyIndex: mapping.keyIndex,
                imageBase64: mapping.imageBase64,
            })
        }

        return {
            deviceId,
            keyIndex,
            imageBase64,
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

    // Handle assignHotkey
    ipcMain.handle('assignHotkey', (_event, { deviceId, keyIndex, hotkey }) => {
        const columnCount = store.get(`device.${deviceId}.columnCount`, 8)
        const x = keyIndex % columnCount
        const y = Math.floor(keyIndex / columnCount)

        // Register in hotkeys.ts
        const success = registerHotkey(hotkey, deviceId, keyIndex)
        if (success) {
            // Save to store
            const keyConfig = store.get(
                `device.${deviceId}.keys`,
                {}
            ) as Record<number, { hotkey?: string }>
            keyConfig[keyIndex] = { ...(keyConfig[keyIndex] || {}), hotkey }
            store.set(`device.${deviceId}.keys`, keyConfig)
        }

        return success
    })

    ipcMain.handle('clearHotkey', (_event, { deviceId, keyIndex, hotkey }) => {
        unregisterHotkey(hotkey)

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

        global.satelliteClient?.addDevice(newDeviceId, 'ScreenDeck', {
            columnCount: store.get(`device.${newDeviceId}.columnCount`, 8),
            rowCount: store.get(`device.${newDeviceId}.rowCount`, 4),
            bitmapSize: store.get(`device.${newDeviceId}.bitmapSize`, 72),
            colours: true,
            text: true,
            brightness: true,
            pincodeMap: null,
        })

        return newDeviceId
    })

    ipcMain.handle('getAllDevices', () => {
        const deviceIds = store.get('deviceIds', []) as string[]
        return deviceIds.map((id) => ({
            deviceId: id,
            columnCount: store.get(`device.${id}.columnCount`, 8),
            rowCount: store.get(`device.${id}.rowCount`, 4),
            bitmapSize: store.get(`device.${id}.bitmapSize`, 72),
            alwaysOnTop: store.get(`device.${id}.alwaysOnTop`, false),
            movable: store.get(`device.${id}.movable`, true),
            disablePress: store.get(`device.${id}.disablePress`, false),
            autoHide: store.get(`device.${id}.autoHide`, false),
            hideEmptyKeys: store.get(`device.${id}.hideEmptyKeys`, false),
            backgroundColor: store.get(
                `device.${id}.backgroundColor`,
                '#000000'
            ),
            backgroundOpacity: store.get(`device.${id}.backgroundOpacity`, 0.5),
        }))
    })

    ipcMain.handle('updateDeviceConfig', (_event, { deviceId, config }) => {
        let needsDeviceUpdate = false

        // Check if key properties have actually changed
        for (const key of ['columnCount', 'rowCount', 'bitmapSize']) {
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
            if (config.disablePress !== undefined) {
                win.webContents.send(
                    'disablePress',
                    Boolean(config.disablePress)
                )
            }
            if (config.autoHide !== undefined) {
                win.webContents.send('autoHide', Boolean(config.autoHide))
            }
            if (config.hideEmptyKeys !== undefined) {
                //resizeWindowForDevice(deviceId)
                win.webContents.send(
                    'hideEmptyKeys',
                    Boolean(config.hideEmptyKeys)
                )
            }

            // Resize window if columnCount/rowCount/bitmapSize changed
            if (needsDeviceUpdate) {
                const columnCount = store.get(
                    `device.${deviceId}.columnCount`,
                    8
                )
                const rowCount = store.get(`device.${deviceId}.rowCount`, 4)
                const bitmapSize = store.get(
                    `device.${deviceId}.bitmapSize`,
                    72
                )

                const { width, height } = calculateWindowSize(
                    columnCount,
                    rowCount,
                    bitmapSize
                )

                win.setSize(width, height)

                // If the Satellite client is connected and key properties changed, update the device config
                if (global.satelliteClient) {
                    global.satelliteClient.removeDevice(deviceId)
                    global.satelliteClient.addDevice(deviceId, 'ScreenDeck', {
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

            win.show()
        }

        updateTrayMenu()
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
