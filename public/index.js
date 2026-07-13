// Helper function to convert hex + opacity to rgba
function hexToRgba(hex, opacity) {
    if (!hex) return `rgba(0,0,0,${opacity})`
    const bigint = parseInt(hex.replace('#', ''), 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return `rgba(${r},${g},${b},${opacity})`
}

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search)
    const deviceId = urlParams.get('deviceId')

    if (!deviceId) {
        console.error('No deviceId in query string')
        throw new Error('No deviceId')
    }

    let keyElements = []
    const activeKeys = new Set()

    let globalColumnCount = 0
    let globalRowCount = 0
    let keyStates = new Map() // deviceId -> Map(keyIndex -> { bitmap, text, color, etc. })

    let initialBackground = null
    let initialOpacity = null

    let globalAutoHideOnLeave = false
    let globalHideEmptyKeys = false

    // Request config from main process
    window.electronAPI.invoke('getDeviceConfig', deviceId).then((config) => {
        const { autoHide, hideEmptyKeys, backgroundColor, backgroundOpacity } =
            config

        globalAutoHideOnLeave = autoHide || false
        globalHideEmptyKeys = hideEmptyKeys || false

        const keypad = document.getElementById('keypad')
        if (keypad) {
            keypad.style.backgroundColor = hexToRgba(
                backgroundColor,
                backgroundOpacity
            )
        }

        // Handle auto hide on mouse leave
        let hideTimeout = null

        let originalBounds = null

        const windowContainer = document.querySelector('.window-container')

        function hideKeypad() {
            console.log('Hiding keypad for device:', deviceId)
            if (!globalAutoHideOnLeave) return

            const keypad = document.getElementById('keypad')
            const logo = document.getElementById('logoOverlay')

            if (keypad && logo) {
                // Fade out keypad
                keypad.style.opacity = '0'
                keypad.style.pointerEvents = 'none'

                // Show and fade in logo
                logo.style.display = 'flex'
                setTimeout(() => {
                    logo.style.opacity = '1'
                    logo.style.transform = 'scale(1)'
                    logo.style.backgroundColor = keypad.style.backgroundColor
                }, 10)
            }

            // Save current size before shrinking
            window.electronAPI
                .invoke('getKeypadBounds', deviceId)
                .then((bounds) => {
                    originalBounds = bounds
                    const bitmapSize = bounds.bitmapSize || 72
                    window.electronAPI.invoke('resizeKeypadWindow', {
                        deviceId,
                        width: bitmapSize + 50, // 50px padding
                        height: bitmapSize + 50, // 50px padding
                    })
                })
        }

        function showKeypad() {
            console.log('Showing keypad for device:', deviceId)
            if (!globalAutoHideOnLeave || !originalBounds) return

            const keypad = document.getElementById('keypad')
            const logo = document.getElementById('logoOverlay')

            if (keypad && logo) {
                // Hide logo smoothly
                logo.style.opacity = '0'
                logo.style.transform = 'scale(0.95)'

                setTimeout(() => {
                    logo.style.display = 'none'
                    keypad.style.opacity = '1'
                    keypad.style.pointerEvents = 'auto'
                }, 300)
            }

            // Restore original size
            window.electronAPI.invoke('resizeKeypadWindow', {
                deviceId,
                width: originalBounds.width,
                height: originalBounds.height,
            })
        }

        if (keypad) {
            window.addEventListener('mouseleave', () => {
                const closeButton = document.getElementById('closeButton')
                if (closeButton) {
                    closeButton.style.opacity = '0'
                    closeButton.style.pointerEvents = 'none'
                }

                console.log(
                    'Mouse left window, hiding keypad for device:',
                    deviceId
                )
                if (globalAutoHideOnLeave) {
                    hideTimeout = setTimeout(hideKeypad, 500) // small delay
                }
            })

            window.addEventListener('mouseenter', () => {
                const closeButton = document.getElementById('closeButton')
                if (closeButton) {
                    closeButton.style.opacity = '1'
                    closeButton.style.pointerEvents = 'auto'
                }

                console.log(
                    'Mouse entered window, showing keypad for device:',
                    deviceId
                )
                if (hideTimeout) {
                    clearTimeout(hideTimeout)
                    hideTimeout = null
                }
                if (globalAutoHideOnLeave) {
                    showKeypad()
                }
            })

            window.addEventListener('mousemove', (e) => {
                const threshold = 50 // pixels

                if (
                    e.clientX < threshold ||
                    e.clientY < threshold ||
                    e.clientX > window.innerWidth - threshold ||
                    e.clientY > window.innerHeight - threshold
                ) {
                    showKeypad()
                }
            })
        }

        const columnCount = config.columnCount || 0
        globalColumnCount = columnCount
        const rowCount = config.rowCount || 0
        globalRowCount = rowCount

        if (columnCount <= 0 || rowCount <= 0) {
            console.warn(`No keys defined for ${deviceId}. Hiding UI.`)
            document.body.style.backgroundColor = 'transparent'
            document.getElementById('keypad').style.display = 'none'
            document.getElementById('closeButton').style.display = 'none'
            return
        }

        buildKeyGrid(columnCount, rowCount)
    })

    function buildKeyGrid(columnCount, rowCount) {
        const keypad = document.getElementById('keypad')
        globalColumnCount = columnCount
        globalRowCount = rowCount
        keysTotal = columnCount * rowCount

        keypad.style.gridTemplateColumns = `repeat(${columnCount}, 1fr)`

        // Remove existing keys
        keypad.querySelectorAll('.key').forEach((key) => key.remove())
        keyElements = []

        for (let i = 0; i < keysTotal; i++) {
            const keyElement = document.createElement('div')
            keyElement.className = 'key'
            keyElement.dataset.index = i
            //keyElement.style.display = 'flex'
            keypad.appendChild(keyElement)
            keyElements.push(keyElement)

            refreshKey(deviceId, i)
        }

        //checkKeyStates()

        //updateGridLayout() // Initial layout calc after grid build
    }

    function checkKeyStates() {
        if (!keyStates || keyStates.size === 0) {
            console.log('No key states found for device:', deviceId)
            // Show loading message
            //document.getElementById('loadingMessage').style.display = 'block'
            //find all elements with class 'key' and hide them
            document.querySelectorAll('.key').forEach((key) => {
                //key.style.visibility = 'hidden'
            })
        } else {
            document.getElementById('loadingMessage').style.display = 'none'
            document.getElementById('keypad').style.display = 'grid'
            //find all elements with class 'key' and show them
            document.querySelectorAll('.key').forEach((key) => {
                key.style.visibility = 'visible'
            })
        }
    }

    let currentMaxColumns = 0
    let currentMaxRows = 0

    function updateGridLayout() {
        const keypad = document.getElementById('keypad')
        if (!globalHideEmptyKeys) {
            keypad.style.gridTemplateColumns = `repeat(${globalColumnCount}, 1fr)`
            currentMaxColumns = globalColumnCount
            currentMaxRows = globalRowCount
            return
        }

        let maxCols = 0
        let maxRow = 0
        for (let row = 0; row < globalRowCount; row++) {
            let rowHasContent = false
            let rowCols = 0
            for (let col = 0; col < globalColumnCount; col++) {
                const index = row * globalColumnCount + col
                const keyEl = keyElements[index]
                if (keyEl && keyEl.style.display !== 'none') {
                    rowHasContent = true
                    rowCols++
                }
            }
            if (rowHasContent) {
                maxRow++
                if (rowCols > maxCols) maxCols = rowCols
            }
        }

        currentMaxColumns = maxCols || 1
        currentMaxRows = maxRow || 1

        keypad.style.gridTemplateColumns = `repeat(${currentMaxColumns}, 1fr)`
    }

    let activeContextMenu = null

    function showContextMenu(e, keyIndex) {
        e.preventDefault()

        // Remove existing menu if one is already open
        if (activeContextMenu) {
            activeContextMenu.remove()
            activeContextMenu = null
        }

        // Create the menu
        const menu = document.createElement('div')
        menu.classList.add('context-menu')
        menu.style.position = 'fixed'
        menu.innerHTML = `
    <div class="menu-item" data-action="encoder">Set to Encoder Mode</div>
    <div class="menu-item" data-action="set-step-size">Set Step Size...</div>
    <div class="menu-item" data-action="button">Set to Button Mode (Normal)</div>
    <div class="menu-item" data-action="button-sticky">Set to Sticky Button Mode</div>
    <div class="menu-item" data-action="clear-sticky">Clear Sticky Mode</div>
    <div class="menu-item" data-action="hotkey">Assign Hotkey...</div>
    `

        document.body.appendChild(menu)
        activeContextMenu = menu

        // Calculate position to keep it on-screen
        const padding = 10 // px from edges
        const menuRect = menu.getBoundingClientRect() // Get default size

        let top = e.clientY
        let left = e.clientX

        // Adjust vertical position if too low
        if (top + menuRect.height > window.innerHeight - padding) {
            top = window.innerHeight - menuRect.height - padding
        }
        if (top < padding) {
            top = padding
        }

        // Adjust horizontal position if too far right
        if (left + menuRect.width > window.innerWidth - padding) {
            left = window.innerWidth - menuRect.width - padding
        }
        if (left < padding) {
            left = padding
        }

        menu.style.top = `${top}px`
        menu.style.left = `${left}px`

        // Handle menu item clicks
        const handleAction = (action) => {
            if (!action) return

            if (action === 'encoder') {
                window.electronAPI
                    .invoke('updateKeyConfig', {
                        deviceId,
                        keyIndex,
                        config: { isEncoder: true },
                    })
                    .then(() => refreshKey(deviceId, keyIndex))
            } else if (action === 'button') {
                window.electronAPI
                    .invoke('updateKeyConfig', {
                        deviceId,
                        keyIndex,
                        config: { isEncoder: false },
                    })
                    .then(() => refreshKey(deviceId, keyIndex))
            } else if (action === 'button-sticky') {
                window.electronAPI
                    .invoke('updateKeyConfig', {
                        deviceId,
                        keyIndex,
                        config: { isEncoder: false, isSticky: true },
                    })
                    .then(() => refreshKey(deviceId, keyIndex))
            } else if (action === 'set-step-size') {
                window.electronAPI
                    .invoke('getKeyConfig', { deviceId, keyIndex })
                    .then((current) => {
                        const input = prompt(
                            'Enter step size (degrees per notch):',
                            current.stepSize || 10
                        )
                        if (input === null) return
                        const stepSize = parseInt(input, 10)
                        if (isNaN(stepSize) || stepSize <= 0) {
                            alert('Please enter a positive whole number.')
                            return
                        }
                        window.electronAPI
                            .invoke('updateKeyConfig', {
                                deviceId,
                                keyIndex,
                                config: {
                                    isEncoder: current.isEncoder,
                                    isSticky: current.isSticky,
                                    stepSize,
                                },
                            })
                            .then(() => refreshKey(deviceId, keyIndex))
                    })
            } else if (action === 'clear-sticky') {
                window.electronAPI
                    .invoke('getKeyConfig', { deviceId, keyIndex })
                    .then((current) => {
                        window.electronAPI
                            .invoke('updateKeyConfig', {
                                deviceId,
                                keyIndex,
                                config: {
                                    isEncoder: current.isEncoder,
                                    isSticky: false,
                                    stepSize: current.stepSize,
                                },
                            })
                            .then(() => refreshKey(deviceId, keyIndex))
                    })
            } else if (action === 'hotkey') {
                let keyConfig = keyStates.get(deviceId)?.get(keyIndex)
                let imageBase64 = keyConfig?.imageBase64 || null
                window.electronAPI.invoke('setHotkeyContext', {
                    deviceId,
                    keyIndex,
                    imageBase64,
                })
                window.electronAPI.invoke('openHotkeyPrompt')
            }

            closeContextMenu()
        }

        menu.addEventListener('mousedown', (evt) => {
            evt.stopPropagation() // Prevent click-through to document
        })

        menu.querySelectorAll('.menu-item').forEach((item) => {
            item.addEventListener('click', (evt) => {
                evt.stopPropagation()
                const action = evt.target.getAttribute('data-action')
                handleAction(action)
            })
        })

        // Delay closing the menu to avoid accidental loss
        setTimeout(() => {
            document.addEventListener(
                'mousedown',
                function docClickOutside(e) {
                    if (!menu.contains(e.target)) {
                        closeContextMenu()
                        document.removeEventListener(
                            'mousedown',
                            docClickOutside
                        )
                    }
                },
                { once: true }
            )
        }, 10)
    }

    function refreshKey(deviceId, keyIndex) {
        window.electronAPI
            .invoke('getKeyConfig', { deviceId, keyIndex })
            .then((keyConfig) => {
                const keyElement = keyElements[keyIndex]
                if (!keyElement) return

                // Update encoder class
                if (keyConfig.isEncoder) {
                    keyElement.classList.add('encoder')
                } else {
                    keyElement.classList.remove('encoder')
                }

                // Update sticky class
                if (keyConfig.sticky) {
                    keyElement.classList.add('sticky')
                } else {
                    keyElement.classList.remove('sticky')
                }

                // Rebind mousedown event
                keyElement.replaceWith(keyElement.cloneNode(true))
                const newKeyElement = document.querySelector(
                    `[data-index="${keyIndex}"]`
                )
                keyElements[keyIndex] = newKeyElement
                bindKeyEvents(newKeyElement, keyIndex, keyConfig)

                const state = keyStates.get(deviceId)?.get(keyIndex)
                if (state) {
                    processKey(state)
                }
            })
    }

    function bindKeyEvents(key, i, keyConfig) {
        const isEncoder = keyConfig.isEncoder
        const stepSize = keyConfig.stepSize || 10

        key.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
                return
            }

            if (isEncoder) {
                e.preventDefault()

                let lastX = e.clientX

                const onMove = (moveEvent) => {
                    const deltaX = moveEvent.clientX - lastX
                    lastX = moveEvent.clientX
                    handleDirection(deltaX)
                }

                const onUp = () => {
                    window.removeEventListener('mousemove', onMove)
                    window.removeEventListener('mouseup', onUp)
                    key.classList.remove('rotateLeft', 'rotateRight')
                }

                window.addEventListener('mouseenter', () => {
                    window.focus()
                })
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
            } else {
                activeKeys.add(i)
                sendKeyPress(i, 'down')
            }
        })

        key.addEventListener('mouseup', () => {
            activeKeys.delete(i)
            sendKeyPress(i, 'up')
        })

        const onWheel = (wheelEvent) => {
            wheelEvent.preventDefault()
            const delta = wheelEvent.deltaY > 0 ? stepSize : -stepSize
            handleDirection(delta)
        }

        key.addEventListener('wheel', onWheel, { passive: false })

        // Add context menu again
        key.addEventListener('contextmenu', (e) => showContextMenu(e, i))

        let accumulatedDeltaX = 0

        let scrollResetTimeout = null

        const handleDirection = (delta) => {
            let direction = null
            accumulatedDeltaX += delta

            while (Math.abs(accumulatedDeltaX) >= stepSize) {
                direction = accumulatedDeltaX > 0 ? 'rotateRight' : 'rotateLeft'
                sendKeyPress(i, direction)

                if (accumulatedDeltaX > 0) {
                    accumulatedDeltaX -= stepSize
                } else {
                    accumulatedDeltaX += stepSize
                }
            }

            if (direction) {
                key.classList.add(direction)
                key.classList.remove(
                    direction === 'rotateRight' ? 'rotateLeft' : 'rotateRight'
                )

                // Reset rotation after a short delay
                clearTimeout(scrollResetTimeout)
                scrollResetTimeout = setTimeout(() => {
                    key.classList.remove('rotateLeft', 'rotateRight')
                }, 250)
            }
        }
    }

    function closeContextMenu() {
        if (activeContextMenu) {
            activeContextMenu.remove()
            activeContextMenu = null
        }
    }

    // Global listener to close the menu when clicking anywhere else
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) {
            closeContextMenu()
        }
    })

    function sendKeyPress(keyIndex, action) {
        const x = keyIndex % globalColumnCount
        const y = Math.floor(keyIndex / globalColumnCount)

        sendKeyPressXY(x, y, action)
    }

    function sendKeyPressXY(x, y, action) {
        window.electronAPI.send('keyPress', {
            deviceId,
            x,
            y,
            action,
        })
    }

    window.electronAPI.onShowDeviceLabel((data) => {
        const label = document.getElementById('device-label')
        if (label) {
            label.textContent = data.deviceId
            label.style.display = data.show ? 'block' : 'none'
        }
    })

    window.electronAPI.onDisablePress((_, disabled) => {
        const keypad = document.getElementById('keypad')
        const lock = document.getElementById('lockIndicator')

        if (keypad && lock) {
            keypad.classList.toggle('disabled', disabled)
            lock.style.display = disabled ? 'block' : 'none'
        }
    })

    window.electronAPI.onAutoHide((_, autoHide) => {
        globalAutoHideOnLeave = autoHide
    })

    window.electronAPI.onHideEmptyKeys((_, hideEmptyKeys) => {
        globalHideEmptyKeys = hideEmptyKeys
        //logic to hide empty keys
    })

    window.electronAPI.onIdentify(() => {
        const keypad = document.getElementById('keypad')
        if (!keypad) return

        // Apply flash - yellow in rgba
        keypad.style.backgroundColor = 'rgba(255, 255, 0, 1)'
        //add transition for smooth effect
        keypad.style.transition = 'background-color 0.5s ease'

        setTimeout(() => {
            window.electronAPI
                .invoke('getDeviceConfig', deviceId)
                .then((config) => {
                    console.log('got config:', config)
                    const { backgroundColor, backgroundOpacity } = config

                    const keypad = document.getElementById('keypad')
                    if (keypad) {
                        keypad.style.backgroundColor = hexToRgba(
                            backgroundColor,
                            backgroundOpacity
                        )
                    }
                })
        }, 800)
    })

    window.electronAPI.onUpdateBackground((_, data) => {
        console.log('Updating background:', data)
        const keypad = document.getElementById('keypad')
        keypad.style.backgroundColor = hexToRgba(
            data.backgroundColor,
            data.backgroundOpacity
        )
    })

    window.electronAPI.onRebuildGrid((_, { columnCount, rowCount }) => {
        globalColumnCount = columnCount
        buildKeyGrid(columnCount, rowCount)
    })

    // Handle key events from Companion
    window.electronAPI.onDraw((event, keyObj) => {
        if (keyObj.deviceId !== deviceId) return

        if (!keyStates.has(keyObj.deviceId)) {
            keyStates.set(keyObj.deviceId, new Map())
        }

        keyStates.get(keyObj.deviceId).set(keyObj.keyIndex, keyObj)
        processKey(keyObj)
    })

    // Handle brightness
    window.electronAPI.onBrightness((event, brightness) => {
        adjustBrightness(brightness)
    })

    // Close button
    document.getElementById('closeButton').addEventListener('click', () => {
        window.electronAPI.invoke('closeKeypad', deviceId) // Send deviceId so main process knows which to close
    })

    function processKey(keyObj) {
        console.log('Processing key:', keyObj)

        document.getElementById('loadingMessage').style.display = 'none'
        document.getElementById('keypad').style.display = 'grid'

        const keyIndex = keyObj.keyIndex
        const bitmap = keyObj.imageBase64
        const { color, textColor, text, fontSize } = keyObj

        if (keyIndex < 0 || keyIndex >= keyElements.length) {
            console.warn(
                'Skipping invalid key index:',
                keyIndex,
                'Total keys:',
                keyElements.length
            )
            return
        }

        const keyElement = keyElements[keyIndex]
        if (!keyElement) {
            console.warn('No keyElement found for key:', keyIndex)
            return
        }

        const textSpan = keyElement.querySelector('span')
        let isEmpty = !bitmap && !color && !text

        if (globalHideEmptyKeys) {
            if (keyObj.imageBase64 || keyObj.text || keyObj.color) {
                keyElement.style.display = 'flex'
            } else {
                keyElement.style.display = 'none'
            }
        } else {
            keyElement.style.display = 'flex'
        }

        // If Companion sends a bitmap, render it
        if (bitmap) {
            renderBitmap(keyElement, bitmap)
            return
        }

        // Otherwise, update color/text if provided
        if (color) {
            keyElement.style.backgroundColor = color
        } else {
            keyElement.style.backgroundColor = ''
        }

        if (textSpan) {
            if (text) {
                try {
                    textSpan.textContent = atob(text)
                } catch (err) {
                    console.warn('Invalid base64 text, using raw:', text)
                    textSpan.textContent = text
                }
            } else {
                textSpan.textContent = ''
            }

            textSpan.style.color = textColor || ''
            textSpan.style.fontSize = fontSize || ''
        }

        //checkKeyStates()
        //updateGridLayout()
    }

    // Brightness
    function adjustBrightness(brightness) {
        const keypad = document.getElementById('keypad')
        keypad.style.opacity = brightness / 100
    }

    // Bitmap Rendering: Accepts base64-encoded raw RGB bitmap
    function renderBitmap(container, bitmapBase64) {
        requestAnimationFrame(() => {
            try {
                const binary = atob(bitmapBase64)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i)
                }

                const size = Math.sqrt(bytes.length / 3)
                if (!Number.isInteger(size)) {
                    console.warn(
                        'Bitmap data length does not result in a perfect square.'
                    )
                    return
                }

                let canvas = container.querySelector('canvas')
                if (!canvas) {
                    canvas = document.createElement('canvas')
                    container.innerHTML = ''
                    container.appendChild(canvas)
                }

                canvas.width = size
                canvas.height = size
                const ctx = canvas.getContext('2d')
                const imageData = ctx.createImageData(size, size)

                for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
                    imageData.data[j] = bytes[i]
                    imageData.data[j + 1] = bytes[i + 1]
                    imageData.data[j + 2] = bytes[i + 2]
                    imageData.data[j + 3] = 255
                }

                ctx.putImageData(imageData, 0, 0)

                // Optional: Convert the canvas into a PNG base64 (for other uses)
                // const dataUrl = canvas.toDataURL('image/png')
            } catch (err) {
                console.error('Error decoding bitmap:', err)
            }
        })
    }

    window.addEventListener('mouseup', () => {
        activeKeys.forEach((keyIndex) => {
            sendKeyPress(keyIndex, 'up')
        })
        activeKeys.clear()
    })

    window.addEventListener('blur', () => {
        activeKeys.forEach((keyIndex) => {
            sendKeyPress(keyIndex, 'up')
        })
        activeKeys.clear()
    })
})
