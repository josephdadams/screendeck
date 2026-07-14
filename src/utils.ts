import { app, BrowserWindow, ipcMain } from 'electron'
import ShortUniqueId from 'short-uuid'
import path from 'path'
import { createNewDevice, createDeviceWindows, showWindows } from './device' // Function to create a new device
import { resizeWindowForDevice } from './device'
import { CompanionSatelliteClient, MINIMUM_PROTOCOL_VERSION } from './client' // Your new client class
import { updateTrayMenu } from './tray'
import { ProfilesStore, Profile } from './types' // Import your types
import { showNotification } from './notification'
import { unregisterAllHotkeys, loadHotkeysFromStore } from './hotkeys' // Import hotkey management functions
import { store } from './store'

export const showDevTools =
    process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

// Initialize the deviceIds list (runs on first app launch)
export function initializeDeviceIds() {
    let deviceIds = store.get('deviceIds') as string[] | undefined

    if (!deviceIds || deviceIds.length === 0) {
        const newDeviceId = createNewDevice()
        store.set('deviceIds', [newDeviceId])
    }
}

// ===========================
// Companion Satellite Client
// ===========================

// Tracks whether we've already shown a notification for the current
// "unsupported Companion version" streak, so we don't spam the user with a
// fresh OS notification on every reconnect attempt (every 30s, forever).
let unsupportedVersionNotified = false

export function createSatellite() {
    // Create the CompanionSatelliteClient
    if (global.satelliteClient?.connected) {
        console.log('[Satellite] Already connected, skipping initialization')
        return
    }

    global.satelliteClient = new CompanionSatelliteClient({ debug: true })

    // Handle connection events
    global.satelliteClient.on('log', (msg) => console.log(`[Satellite] ${msg}`))
    global.satelliteClient.on('error', (err) =>
        console.error(`[Satellite Error] ${err}`)
    )

    global.satelliteClient.on('unsupportedVersion', ({ companionVersion, apiVersion }) => {
        console.error(
            `[Satellite] Unsupported Companion version. Companion ${companionVersion}, API ${apiVersion}`
        )

        if (!unsupportedVersionNotified) {
            unsupportedVersionNotified = true
            showNotification(
                'Companion Version Not Supported',
                `Detected Companion ${companionVersion ?? 'unknown'} (API ${apiVersion ?? 'unknown'}), which is too old for ScreenDeck. ` +
                    `Please update Companion to a version supporting API ${MINIMUM_PROTOCOL_VERSION} or newer.`
            )
        }
    })

    global.satelliteClient.on('connected', () => {
        console.log('[Satellite] Connected Event Received')
        // A successful connection means we're no longer in an "unsupported
        // version" streak, so reset the notification guard for next time.
        unsupportedVersionNotified = false
        // Register devices
        setTimeout(() => {
            const deviceIds = store.get('deviceIds') as string[] | []
            for (const deviceId of deviceIds) {
                console.log(`[Satellite] Adding device: ${deviceId}`)
                const productName = store.get(
                    `device.${deviceId}.name`,
                    'ScreenDeck'
                )
                global.satelliteClient?.addDevice(deviceId, productName, {
                    columnCount: store.get(`device.${deviceId}.columnCount`, 8),
                    rowCount: store.get(`device.${deviceId}.rowCount`, 4),
                    bitmapSize: store.get(`device.${deviceId}.bitmapSize`, 72),
                    colours: true,
                    text: true,
                    brightness: true,
                    pincodeMap: null,
                })
            }

            updateTrayMenu()

            // On initial startup, ignore any persisted per-device `hidden` flags so
            // decks the user previously closed don't stay hidden forever (issues #53, #49).
            const showOnStartup = store.get('showOnStartup', true) as boolean
            showWindows(showOnStartup)

            global.deviceWindows.forEach((win) => {
                win.webContents.send('satelliteStatus', 'connected')
            })
        }, 500)
    })

    global.satelliteClient.on('connecting', () => {
        global.deviceWindows.forEach((win) => {
            win.webContents.send('satelliteStatus', 'connecting')
        })
    })

    global.satelliteClient.on('disconnected', () => {
        global.deviceWindows.forEach((win) => {
            win.webContents.send('satelliteStatus', 'disconnected')
        })
    })

    global.satelliteClient.on('draw', (data) => {
        console.log(`[Satellite] Draw event for device ${data.deviceId}`)
        console.log('[Satellite] Draw data:', data)

        //save the image to global.keyStates
        data.imageBase64 = data.image?.toString('base64') || undefined

        //save to global.keyStates
        if (!global.keyStates.has(data.deviceId)) {
            global.keyStates.set(data.deviceId, new Map())
        }

        // If this key is a registered hotkey, update its bitmap reference too
        for (const [hotkey, mapping] of global.registeredHotkeys.entries()) {
            if (
                mapping.kind === 'key' &&
                mapping.deviceId === data.deviceId &&
                mapping.keyIndex === data.keyIndex
            ) {
                // Update the bitmap for this hotkey (optional redundancy)
                mapping.imageBase64 = data.imageBase64 ?? ''
            }
        }

        const deviceKeyStates = global.keyStates.get(data.deviceId)
        if (deviceKeyStates) {
            deviceKeyStates.set(data.keyIndex, {
                imageBase64: data.imageBase64,
                color: data.color,
                text: data.text,
            })
        }

        // Send the draw event to the corresponding device window
        const win = global.deviceWindows.get(data.deviceId)
        if (win) {
            resizeWindowForDevice(data.deviceId)
            win.webContents.send('draw', data)
        }
    })

    global.satelliteClient.on('clearDeck', (data) => {
        const win = global.deviceWindows.get(data.deviceId)
        if (win) {
            win.webContents.send('clearDeck')
        }
    })

    global.satelliteClient.on('brightness', (data) => {
        const win = global.deviceWindows.get(data.deviceId)
        if (win) {
            win.webContents.send('brightness', data.percent)
        }
    })

    global.satelliteClient.on('lockedState', (data) => {
        const win = global.deviceWindows.get(data.deviceId)
        if (win) {
            win.webContents.send('lockedState', data)
        }
    })

    // Connect to Companion
    global.satelliteClient
        .connect({
            mode: 'tcp',
            host: store.get('companionIP', '127.0.0.1') as string,
            port: store.get('companionPort', 16622) as number,
        })
        .catch((err) => {
            console.error(`[Satellite] Connection failed: ${err}`)
        })
}

// Applies a settings update that may include a new Companion IP/port,
// reconnecting the satellite client if either actually changed. Shared by
// the `saveSettings` IPC handler (Settings UI) and the mDNS/REST remote
// config server (#4), so both paths trigger a reconnect the same way.
export function applyCompanionConnectionSettings(
    newSettings: Record<string, unknown>
) {
    const previousIP = store.get('companionIP', '127.0.0.1')
    const previousPort = store.get('companionPort', 16622)

    store.set(newSettings)

    const newIP = newSettings.companionIP ?? previousIP
    const newPort = newSettings.companionPort ?? previousPort

    if (newIP !== previousIP || newPort !== previousPort) {
        console.log('Companion IP or port changed, restarting connection...')

        if (global.satelliteClient) {
            global.satelliteClient.disconnect()
            global.satelliteClient = null
        }

        // Wait briefly, then reconnect with the new IP/port
        setTimeout(() => {
            createSatellite()
        }, 500)
    }
}

// ===========================
// Profile Management
// ===========================

function generateProfileId() {
    const uuidGenerator = ShortUniqueId()
    return `profile-${uuidGenerator.new()}`
}

export function promptForProfileName(): Promise<string | undefined> {
    return new Promise((resolve) => {
        const promptWindow = new BrowserWindow({
            width: 500,
            height: 200,
            resizable: false,
            minimizable: false,
            maximizable: false,
            modal: true,
            show: false,
            parent: BrowserWindow.getFocusedWindow() || undefined,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
            },
        })

        //show dev tools
        if (showDevTools) {
            promptWindow.webContents.openDevTools({
                mode: 'detach', // Open in a separate window
            })
        }

        // Load the HTML file for the input dialog
        promptWindow.loadFile(
            path.join(__dirname, '../public/profilePrompt.html')
        )

        promptWindow.once('ready-to-show', () => {
            promptWindow.show()
        })

        // Listen for the input from the renderer
        ipcMain.once('profileNameResult', (_event, result) => {
            resolve(result)
            promptWindow.close()
        })

        promptWindow.on('closed', () => {
            resolve(undefined)
        })
    })
}

export function getNextProfileName() {
    const existingProfiles = store.get('profiles', {}) as ProfilesStore // object of profiles
    let maxNumber = 0

    Object.values(existingProfiles).forEach((profile) => {
        const match = profile.name?.match(/^Profile (\d+)$/)
        if (match) {
            const num = parseInt(match[1])
            if (num > maxNumber) maxNumber = num
        }
    })

    return `Profile ${maxNumber + 1}`
}

export function saveProfile(profileName: string) {
    const profileId = generateProfileId()

    const profiles: ProfilesStore = store.get('profiles', {})
    const newProfile: Profile = {
        name: profileName,
        deviceIds: store.get('deviceIds', []),
        devices: store.get('device', {}),
    }
    profiles[profileId] = newProfile
    store.set('profiles', profiles)

    console.log(`Profile "${profileName}" saved as ${profileId}.`)
    showNotification(
        'Profile Saved',
        `Profile "${profileName}" has been saved successfully.`
    )

    updateTrayMenu()
}

export function loadProfile(profileId: string) {
    const profiles = store.get('profiles', {}) as ProfilesStore
    const profile = profiles[profileId]

    if (!profile) return

    const profileName = profile.name

    console.log(`Loading profile "${profileName}" with ID ${profileId}`)
    console.log('Profile details:', profile)

    // Close all current windows
    global.deviceWindows.forEach((win) => win.close())
    global.deviceWindows.clear()

    // Remove all current devices from satellite
    if (global.satelliteClient) {
        const currentDeviceIds = store.get('deviceIds', []) as string[]
        for (const deviceId of currentDeviceIds) {
            console.log(`[Satellite] Removing device: ${deviceId}`)
            global.satelliteClient.removeDevice(deviceId)
        }
    }

    // Remove all 'device.<deviceId>.' keys from store
    const currentDeviceIds = store.get('deviceIds', []) as string[]
    for (const deviceId of currentDeviceIds) {
        const keysToRemove = Object.keys(store.store).filter((key) =>
            key.startsWith(`device.${deviceId}.`)
        )
        for (const key of keysToRemove) {
            store.delete(key as any)
        }
    }

    //unregister all hotkeys for devices
    unregisterAllHotkeys()

    // Set deviceIds and restore device configs from profile
    store.set('deviceIds', profile.deviceIds)

    for (const deviceId of profile.deviceIds) {
        const deviceConfig = profile.devices[deviceId]
        if (deviceConfig) {
            Object.entries(deviceConfig).forEach(([key, value]) => {
                store.set(`device.${deviceId}.${key}`, value)
            })
        }
    }

    //restart the app
    app.relaunch()
    app.exit(0)
}

export function deleteProfile(profileId: string) {
    const profiles = store.get('profiles', {}) as ProfilesStore
    const profile = profiles[profileId]
    if (!profile) return
    const profileName = profiles[profileId]?.name
    delete profiles[profileId]
    store.set('profiles', profiles)
    console.log(`Profile "${profileName}" deleted.`)
    showNotification(
        'Profile Deleted',
        `Profile "${profileName}" has been deleted successfully.`
    )
    updateTrayMenu()
}
