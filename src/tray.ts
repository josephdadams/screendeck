import { Tray, Menu, nativeImage, app } from 'electron'
import * as path from 'path'
import Store from 'electron-store'
import createSettingsWindow from './settings' // Import the createSettingsWindow function

let tray: Tray | null = null
const store = new Store()

export default function createTray() {
    // Create the tray icon using nativeImage and resize it to the desired size
    const image = nativeImage.createFromPath(
        path.join(__dirname, '../assets/tray-icon.png') // Adjust this path as needed
    )
    tray = new Tray(image.resize({ width: 16, height: 16 }))

    tray.setToolTip('ScreenDeck')
    updateTrayMenu()
}

// Function to update the tray menu based on the window state
function updateTrayMenu() {
    // Retrieve stored values
    const companionIP = store.get('companionIP', '127.0.0.1') as string
    const deviceId = store.get('deviceId', 'Unknown') as string
    const version = app.getVersion()
    const alwaysOnTop = store.get('alwaysOnTop', true)

    // Build context menu with version, IP, and Device ID
    let contextMenuTemplate = [
        { label: `ScreenDeck Version: ${version}`, enabled: false },
        { label: `Companion IP: ${companionIP}`, enabled: false },
        {
            label: `Companion Version: ${global.satellite?.companionVersion}`,
            enabled: false,
        },
        {
            label: `Satellite API Version: ${global.satellite?.apiVersion}`,
            enabled: false,
        },
        { label: `Device ID: ${deviceId}`, enabled: false },
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
                app.exit()
            },
        },
    ] as Electron.MenuItemConstructorOptions[]

    // Add "Show Keypad" option if alwaysOnTop is false, or if the main window is not visible, but only if we are connected to Companion
    if (
        (!alwaysOnTop || global.mainWindow?.isVisible() === false) &&
        global.satellite?.isConnected
    ) {
        contextMenuTemplate.splice(5, 0, {
            label: 'Show Keypad',
            type: 'normal',
            click: () => {
                showMainWindow()
            },
        })
    }

    const contextMenu = Menu.buildFromTemplate(contextMenuTemplate)

    tray?.setContextMenu(contextMenu)
}

// Function to show the main keypad window
function showMainWindow() {
    if (global.mainWindow) {
        global.mainWindow.show()
        global.mainWindow.focus()
        updateTrayMenu()
    }
}

export { updateTrayMenu }
