import { Tray, Menu, nativeImage, app } from 'electron'
import * as path from 'path'
import Store from 'electron-store'
import createSettingsWindow from './settings' // Import the createSettingsWindow function
import {
    loadProfile,
    deleteProfile,
    saveProfile,
    promptForProfileName,
} from './utils' // Import profile management functions
import { ProfilesStore } from './types' // Import the ProfilesStore type

import { unregisterAllHotkeys } from './hotkeys' // Import hotkey management functions

let tray: Tray | null = null
const store = new Store()

export default function createTray() {
    // Create the tray icon using nativeImage and resize it to the desired size
    const image = nativeImage.createFromPath(
        path.join(__dirname, '../assets/tray-icon.png') // Adjust this path as needed
    )
    tray = new Tray(image.resize({ width: 16, height: 16 }))

    tray.setToolTip('ScreenDeck')

    tray.on('click', () => {
        tray?.popUpContextMenu()
    })

    updateTrayMenu()
}

// Function to update the tray menu based on the window state
function updateTrayMenu() {
    if (!tray) {
        console.log('Tray has been destroyed; skipping menu update.')
        return
    }

    // Retrieve stored values
    const companionIP = store.get('companionIP', '127.0.0.1') as string
    const version = app.getVersion()

    // Build context menu with version, IP, and Device ID
    const topMenuItems = [
        { label: `ScreenDeck Version: ${version || ''}`, enabled: false },
        { label: `Companion IP: ${companionIP || ''}`, enabled: false },
        {
            label: `Companion Version: ${global.satelliteClient?.companionVersion || 'Unknown'}`,
            enabled: false,
        },
        {
            label: `Satellite API Version: ${global.satelliteClient?.companionApiVersion || 'Unknown'}`,
            enabled: false,
        },
        {
            label: `Connected: ${global.satelliteClient?.connected ? 'Yes' : 'No'}`,
            enabled: false,
        },
        { type: 'separator' },
        {
            label: `Hide All Screen Decks`,
            type: 'normal',
            click: () => {
                global.deviceWindows.forEach((win, deviceId) => {
                    if (win.isVisible()) {
                        win.hide()
                        store.set(`device.${deviceId}.hidden`, true)
                    }
                })
                updateTrayMenu()
            },
        },
        {
            label: `Show All Screen Decks`,
            type: 'normal',
            click: () => {
                global.deviceWindows.forEach((win, deviceId) => {
                    if (!win.isVisible()) {
                        win.show()
                        store.set(`device.${deviceId}.hidden`, false)
                    }
                })
                updateTrayMenu()
            },
        },
        { type: 'separator' },
    ] as Electron.MenuItemConstructorOptions[]

    const devices = store.get('deviceIds') as string[]
    const deviceMenuItems = devices.map((deviceId) => {
        const win = global.deviceWindows.get(deviceId)
        const isVisible = win?.isVisible() ?? false
        const isDisabled = store.get(`device.${deviceId}.disablePress`, false)

        return {
            label: deviceId,
            submenu: [
                {
                    label: 'Identify',
                    type: 'normal',
                    click: () => {
                        const win = global.deviceWindows.get(deviceId)
                        if (win) {
                            //show the window if it's hidden
                            if (!isVisible) {
                                win.show()
                                store.set(`device.${deviceId}.hidden`, false)
                            }
                            win.webContents.send('identify')
                            updateTrayMenu()
                        }
                    },
                },
                {
                    label: isVisible ? 'Hide' : 'Show',
                    type: 'normal',
                    click: () => {
                        const win = global.deviceWindows.get(deviceId)
                        if (win) {
                            if (win.isVisible()) {
                                win.hide()
                                store.set(`device.${deviceId}.hidden`, true)
                            } else {
                                win.show()
                                store.set(`device.${deviceId}.hidden`, false)
                            }
                            updateTrayMenu()
                        }
                    },
                },
                {
                    label: isDisabled
                        ? 'Enable Button Presses'
                        : 'Disable Button Presses',
                    type: 'normal',
                    click: () => {
                        const newState = !isDisabled
                        store.set(`device.${deviceId}.disablePress`, newState)

                        const win = global.deviceWindows.get(deviceId)
                        if (win) {
                            win.webContents.send('disablePress', newState)
                        }

                        updateTrayMenu()
                    },
                },
            ],
        }
    }) as Electron.MenuItemConstructorOptions[]

    const profiles = store.get('profiles', {}) as ProfilesStore
    const profileNames = Object.keys(profiles)

    const loadProfileMenu = Object.entries(profiles).map(([id, profile]) => ({
        label: profile.name,
        click: () => loadProfile(id),
    }))

    const deleteProfileMenu = Object.entries(profiles).map(([id, profile]) => ({
        label: profile.name,
        click: () => deleteProfile(id),
    }))

    const profileMenuItems = [
        { type: 'separator' },
        {
            label: 'Save Current Profile',
            click: async () => {
                const profileName = await promptForProfileName()
                if (profileName) saveProfile(profileName)
            },
        },
        { label: 'Load Profile', submenu: loadProfileMenu },
        { label: 'Delete Profile', submenu: deleteProfileMenu },
    ] as Electron.MenuItemConstructorOptions[]

    const bottomMenuItems = [
        { type: 'separator' },
        {
            label: 'Settings',
            type: 'normal',
            click: () => {
                // Open settings window
                createSettingsWindow()
            },
        },
        {
            label: 'Quit',
            type: 'normal',
            click: () => {
                global.isQuitting = true

                // Disconnect Companion client
                if (global.satelliteClient) {
                    global.satelliteClient.disconnect() // or .disconnect() based on your API
                }

                // Close all device windows
                global.deviceWindows?.forEach((win) => {
                    win.close()
                })

                unregisterAllHotkeys()

                // Destroy the tray
                if (tray) {
                    tray.destroy()
                    tray = null
                }

                // Quit the app
                app.quit()
            },
        },
        { type: 'separator' },
        {
            label: 'About the Developer',
            click: () => {
                require('electron').shell.openExternal(
                    'https://josephadams.dev'
                )
            },
        },
    ] as Electron.MenuItemConstructorOptions[]

    const contextMenu = Menu.buildFromTemplate([
        ...topMenuItems,
        ...deviceMenuItems,
        ...profileMenuItems,
        ...bottomMenuItems,
    ])

    if (tray) {
        tray?.setContextMenu(contextMenu)
    }
}

export { updateTrayMenu }
