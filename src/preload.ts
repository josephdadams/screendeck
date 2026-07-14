import { contextBridge, ipcRenderer } from 'electron'

// Expose APIs to the renderer process through contextBridge.
//
// Every IPC channel gets its own named, single-purpose method here instead of
// a generic invoke/send passthrough. A generic passthrough would let any
// renderer script call *any* registered ipcMain handler with arbitrary
// arguments, which defeats the point of contextIsolation/nodeIntegration as a
// security boundary.
contextBridge.exposeInMainWorld('electronAPI', {
    getNextProfileName: () => ipcRenderer.invoke('getNextProfileName'),

    sendProfileName: (name: string) =>
        ipcRenderer.send('profileNameResult', name),

    onShowDeviceLabel: (callback: any) =>
        ipcRenderer.on('showDeviceLabel', (_event, data) => callback(data)),

    // Listen for key events (per device)
    onKeyEvent: (callback: (event: any, keyObj: any) => void) => {
        ipcRenderer.on('keyEvent', (event, keyObj) => callback(event, keyObj))
    },

    // Listen for draw events
    onDraw: (callback: (event: any, data: any) => void) => {
        ipcRenderer.on('draw', (event, data) => callback(event, data))
    },

    onUpdateBackground: (callback: any) => {
        ipcRenderer.on('updateBackground', (event, data) =>
            callback(event, data)
        )
    },

    onRebuildGrid: (callback: any) => {
        ipcRenderer.on('rebuildGrid', (event, data) => callback(event, data))
    },

    onDisablePress: (callback: any) => {
        ipcRenderer.on('disablePress', (event, data) => callback(event, data))
    },

    onDimOnLeave: (callback: any) => {
        ipcRenderer.on('dimOnLeave', (event, data) => callback(event, data))
    },

    onAutoHide: (callback: any) => {
        ipcRenderer.on('autoHide', (event, data) => callback(event, data))
    },

    onHideEmptyKeys: (callback: any) => {
        ipcRenderer.on('hideEmptyKeys', (event, data) => callback(event, data))
    },

    onIdentify: (callback: any) => ipcRenderer.on('identify', callback),

    // Listen for brightness changes
    onBrightness: (callback: (event: any, brightness: number) => void) => {
        ipcRenderer.on('brightness', (event, brightness) =>
            callback(event, brightness)
        )
    },

    // Listen for clearDeck events
    onClearDeck: (callback: (event: any) => void) => {
        ipcRenderer.on('clearDeck', callback)
    },

    // Listen for locked state changes
    onLockedState: (callback: (event: any, data: any) => void) => {
        ipcRenderer.on('lockedState', (event, data) => callback(event, data))
    },

    // Listen for Companion satellite connection status changes
    onSatelliteStatus: (callback: any) => {
        ipcRenderer.on('satelliteStatus', (event, status) =>
            callback(event, status)
        )
    },

    // Get per-device config (columnCount, rowCount, etc.)
    getDeviceConfig: (deviceId: string) =>
        ipcRenderer.invoke('getDeviceConfig', deviceId),

    // Reset a device's settings back to createNewDevice()'s defaults
    resetDeviceToDefaults: (deviceId: string) =>
        ipcRenderer.invoke('resetDeviceToDefaults', deviceId),

    // Collapse/expand a device window (double-click its drag handle)
    toggleDeviceCollapsed: (deviceId: string) =>
        ipcRenderer.invoke('toggleDeviceCollapsed', deviceId),

    // Get the current window bounds for a device's keypad window
    getKeypadBounds: (deviceId: string) =>
        ipcRenderer.invoke('getKeypadBounds', deviceId),

    // Resize a device's keypad window
    resizeKeypadWindow: (data: {
        deviceId: string
        width: number
        height: number
    }) => ipcRenderer.invoke('resizeKeypadWindow', data),

    // Close (hide) a device's keypad window
    closeKeypad: (deviceId: string) =>
        ipcRenderer.invoke('closeKeypad', deviceId),

    // Send a key press/release/rotate event (fire-and-forget)
    keyPress: (data: {
        deviceId: string
        x: number
        y: number
        action: string
    }) => ipcRenderer.send('keyPress', data),

    // Get per-key config (isEncoder, stepSize)
    getKeyConfig: (data: { deviceId: string; keyIndex: number }) =>
        ipcRenderer.invoke('getKeyConfig', data),

    // Update per-key config (isEncoder, stepSize)
    updateKeyConfig: (data: {
        deviceId: string
        keyIndex: number
        config: any
    }) => ipcRenderer.invoke('updateKeyConfig', data),

    // Toggle a key between encoder/button mode
    toggleEncoder: (data: { deviceId: string; keyIndex: number }) =>
        ipcRenderer.invoke('toggleEncoder', data),

    // Broadcast a brightness change to all device windows
    setBrightness: (brightness: number) =>
        ipcRenderer.invoke('setBrightness', brightness),

    //HOTKEYS
    setHotkeyContext: (data: {
        deviceId: string
        keyIndex: number
        imageBase64?: string | null
    }) => ipcRenderer.invoke('setHotkeyContext', data),

    getHotkeyContext: () => ipcRenderer.invoke('getHotkeyContext'),

    openHotkeyPrompt: () => ipcRenderer.invoke('openHotkeyPrompt'),

    closeHotkeyPrompt: () => ipcRenderer.invoke('closeHotkeyPrompt'),

    assignHotkey: (data: {
        deviceId: string
        keyIndex: number
        hotkey: string
    }) => ipcRenderer.invoke('assignHotkey', data),

    clearHotkey: (data: {
        deviceId: string
        keyIndex: number
        hotkey: string
    }) => ipcRenderer.invoke('clearHotkey', data),

    showDeviceLabels: (show: boolean) =>
        ipcRenderer.invoke('showDeviceLabels', show),

    //SETTINGS
    createNewDevice: () => ipcRenderer.invoke('createNewDevice'),

    getAllDevices: () => ipcRenderer.invoke('getAllDevices'),

    updateDeviceConfig: (data: { deviceId: string; config: any }) =>
        ipcRenderer.invoke('updateDeviceConfig', data),

    deleteDevice: (deviceId: string) =>
        ipcRenderer.invoke('deleteDevice', deviceId),

    getSettings: () => ipcRenderer.invoke('getSettings'),

    // Save settings (if you need it for settings page)
    saveSettings: (newSettings: any) =>
        ipcRenderer.invoke('saveSettings', newSettings),

    closeSettingsWindow: () => ipcRenderer.invoke('closeSettingsWindow'),
})
