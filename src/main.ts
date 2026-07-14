import { app, BrowserWindow, powerMonitor } from 'electron'
import type { CompanionSatelliteClient } from './client' // Your new client class
import { initializeIpcHandlers } from './ipcHandlers' // Import IPC handlers
import createTray from './tray' // Import the tray creation function

import { initializeDeviceIds, createSatellite } from './utils' // Import utility functions

import { createDeviceWindows, startEdgeRevealPolling } from './device' // Import device window creation

import { loadHotkeysFromStore, HotkeyBinding } from './hotkeys'

import { startRestServer, watchRestServerSettings } from './restServer'
import { startMdnsAnnouncer, watchMdnsAnnouncerSettings } from './mdnsAnnouncer'

declare global {
    var satelliteClient: CompanionSatelliteClient | null
    var deviceWindows: Map<string, BrowserWindow>
    var keyStates: Map<
        string,
        Map<
            number,
            {
                imageBase64?: string
                color?: string
                text?: string
                // add more fields as needed (e.g., textColor, fontSize)
            }
        >
    >
    var hotkeyPromptWindow: BrowserWindow | null
    var hotkeyContext: HotkeyBinding | null
    var registeredHotkeys: Map<string, HotkeyBinding>
    var trayParentWindow: BrowserWindow
    var settingsWindow: BrowserWindow | null
    var isQuitting: boolean
}

// Initialize the Companion Satellite client and device windows
function init() {
    global.satelliteClient = null
    global.deviceWindows = new Map()
    global.keyStates = new Map()
    global.hotkeyPromptWindow = null
    global.hotkeyContext = null
    global.registeredHotkeys = new Map()
    global.settingsWindow = null
    global.isQuitting = false

    global.trayParentWindow = new BrowserWindow({
        show: false,
        width: 0,
        height: 0,
        frame: false,
        transparent: true,
        skipTaskbar: true,
    })

    initializeDeviceIds() //ensure at least one deviceId exists
    initializeIpcHandlers() // Set up IPC handlers
    createDeviceWindows() // Create device windows
    createSatellite() // Initialize the Companion Satellite client
    loadHotkeysFromStore() // Load hotkeys from the store
    startEdgeRevealPolling() // Start polling cursor position for edge-reveal devices (#10)

    startRestServer() // Start the remote-config REST server (#4)
    watchRestServerSettings()
    startMdnsAnnouncer() // Advertise this install over mDNS (#4)
    watchMdnsAnnouncerSettings()
}

app.whenReady().then(() => {
    if (process.platform === 'darwin') {
        app.dock.hide() // Hide the dock icon on macOS
    }

    init() // Initialize the app, IPC handlers, and device windows
    createTray() // Create the system tray icon

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createDeviceWindows()
        }
    })

    app.on('window-all-closed', () => {
        //don't do anything unless closed by the tray
    })

    app.on('before-quit', () => {
        console.log('App is quitting...')
    })

    app.on('will-quit', () => {
        console.log('App will quit...')
    })

    app.on('quit', () => {
        console.log('App has quit.')
    })

    powerMonitor.on('resume', () => {
        console.log('System resumed from sleep, refreshing device windows...')
        global.deviceWindows.forEach((win) => {
            if (win.isVisible()) {
                win.hide()
                win.show()
            }
        })
    })
})
