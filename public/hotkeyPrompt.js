window.addEventListener('DOMContentLoaded', () => {
    let modifiers = new Set()
    let primaryKey = ''
    let context = null // the HotkeyBinding this prompt is assigning: {kind, deviceId?, keyIndex?}
    let currentHotkeys = []

    function describeBinding(binding) {
        if (binding.kind === 'toggleAll') {
            return 'Show/Hide All Screen Decks'
        }
        if (binding.kind === 'toggleDevice') {
            return `Show/Hide ${binding.deviceId}`
        }
        return `Key ${binding.keyIndex} on ${binding.deviceId}`
    }

    function showHotkeyError(message) {
        const errorEl = document.getElementById('hotkeyError')
        if (errorEl) {
            errorEl.textContent = message
        } else {
            alert(message)
        }
    }

    function clearHotkeyError() {
        const errorEl = document.getElementById('hotkeyError')
        if (errorEl) {
            errorEl.textContent = ''
        }
    }

    // Get initial data
    window.electronAPI.getHotkeyContext().then((data) => {
        context = {
            kind: data.kind,
            deviceId: data.deviceId,
            keyIndex: data.keyIndex,
        }

        document.getElementById('targetDescription').textContent =
            describeBinding(context)

        // If there's a bitmap (per-key hotkeys only), show it
        const keyPreview = document.getElementById('keyPreview')
        keyPreview.innerHTML = '' // Clear previous content
        if (data.kind === 'key' && data.imageBase64) {
            keyPreview.style.display = 'block'
            renderBitmap(keyPreview, data.imageBase64)
        } else {
            keyPreview.style.display = 'none'
        }

        // Load current hotkeys
        updateHotkeyList(data.currentHotkeys)
    })

    // Modifier button clicks
    document.querySelectorAll('.modifiers button').forEach((btn) => {
        btn.addEventListener('click', () => {
            const mod = btn.getAttribute('data-mod')
            if (modifiers.has(mod)) {
                modifiers.delete(mod)
                btn.classList.remove('active')
            } else {
                modifiers.add(mod)
                btn.classList.add('active')
            }
            updatePreview()
        })
    })

    // Primary key input
    document.getElementById('primaryKey').addEventListener('input', (e) => {
        primaryKey = e.target.value.toUpperCase()
        updatePreview()
    })

    function updatePreview() {
        const modStr = Array.from(modifiers).join('+')
        const fullHotkey = modStr ? `${modStr}+${primaryKey}` : primaryKey
        document.getElementById('hotkeyPreview').textContent = fullHotkey
    }

    // Is `h` (an entry from currentHotkeys) bound to the exact same target
    // this prompt is currently assigning? Used to exclude "self" when
    // checking for conflicts (re-assigning a key its own hotkey isn't a
    // conflict).
    function isSameTarget(h) {
        if (h.kind !== context.kind) return false
        if (h.kind === 'toggleAll') return true
        if (h.kind === 'toggleDevice') return h.deviceId === context.deviceId
        return h.deviceId === context.deviceId && h.keyIndex === context.keyIndex
    }

    function updateHotkeyList(hotkeys) {
        currentHotkeys = hotkeys || []

        const tbody = document.getElementById('hotkeyList')
        tbody.innerHTML = ''

        hotkeys.forEach((h) => {
            const tr = document.createElement('tr')

            // Create a cell for the bitmap canvas (per-key hotkeys only)
            const tdCanvas = document.createElement('td')
            const container = document.createElement('div')
            container.style.width = '32px'
            container.style.height = '32px'
            container.style.display = 'inline-block'
            container.style.verticalAlign = 'middle'
            tdCanvas.appendChild(container)

            if (h.kind === 'key' && h.imageBase64) {
                renderBitmap(container, h.imageBase64)
            }

            tr.appendChild(tdCanvas)

            // Add other data cells
            const tdHotkey = document.createElement('td')
            tdHotkey.textContent = h.hotkey
            tr.appendChild(tdHotkey)

            const tdTarget = document.createElement('td')
            tdTarget.textContent = describeBinding(h)
            tr.appendChild(tdTarget)

            // Add Clear button
            const tdButton = document.createElement('td')
            const btn = document.createElement('button')
            btn.textContent = 'Clear'
            btn.addEventListener('click', () => {
                window.electronAPI
                    .clearHotkey({
                        kind: h.kind,
                        deviceId: h.deviceId,
                        keyIndex: h.keyIndex,
                        hotkey: h.hotkey,
                    })
                    .then(() => window.location.reload())
            })
            tdButton.appendChild(btn)
            tr.appendChild(tdButton)

            tbody.appendChild(tr)
        })
    }

    document.getElementById('assignHotkey').addEventListener('click', () => {
        clearHotkeyError()

        if (!primaryKey) {
            alert('Please enter a key')
            return
        }

        if (modifiers.size === 0) {
            alert(
                'Please include at least one modifier key (Ctrl, Alt, Cmd, Shift)'
            )
            return
        }

        const hotkeyStr = Array.from(modifiers).join('+') + `+${primaryKey}`

        // Proactively check for conflicts with other targets before even
        // asking the main process to register the hotkey.
        const conflict = currentHotkeys.find(
            (h) => h.hotkey === hotkeyStr && !isSameTarget(h)
        )

        if (conflict) {
            showHotkeyError(
                `${hotkeyStr} is already assigned to ${describeBinding(conflict)}`
            )
            return
        }

        window.electronAPI
            .assignHotkey({
                ...context,
                hotkey: hotkeyStr,
            })
            .then((success) => {
                if (success) {
                    window.close()
                } else {
                    showHotkeyError(
                        `${hotkeyStr} could not be assigned. It may already be in use.`
                    )
                }
            })
    })

    document.getElementById('cancel').addEventListener('click', () => {
        window.electronAPI.closeHotkeyPrompt()
    })

    document.getElementById('closeButton').addEventListener('click', () => {
        window.electronAPI.closeHotkeyPrompt()
    })
})

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

            // Make the canvas scale to fill the container
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            canvas.style.objectFit = 'contain' // Optional for padding behavior

            const ctx = canvas.getContext('2d')
            const imageData = ctx.createImageData(size, size)

            for (let i = 0, j = 0; i < bytes.length; i += 3, j += 4) {
                imageData.data[j] = bytes[i]
                imageData.data[j + 1] = bytes[i + 1]
                imageData.data[j + 2] = bytes[i + 2]
                imageData.data[j + 3] = 255
            }

            ctx.putImageData(imageData, 0, 0)
        } catch (err) {
            console.error('Error decoding bitmap:', err)
        }
    })
}
