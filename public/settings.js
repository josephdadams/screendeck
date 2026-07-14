window.addEventListener('DOMContentLoaded', () => {
    const deviceList = document.getElementById('deviceList')
    const addDeviceButton = document.getElementById('addDevice')

    loadCompanionSettings()
    loadDevices()

    document
        .getElementById('saveCompanion')
        .addEventListener('click', async () => {
            const ip = document.getElementById('companionIP').value
            const port = parseInt(
                document.getElementById('companionPort').value,
                10
            )

            const showOnStartup =
                document.getElementById('showOnStartup').checked

            await window.electronAPI.saveSettings({
                companionIP: ip,
                companionPort: port,
                showOnStartup: showOnStartup,
            })

            // Show status message
            const status = document.getElementById('saveStatus')
            status.textContent = '✅ Settings Saved!'

            // Optionally clear the message after a few seconds
            setTimeout(() => {
                status.textContent = ''
                window.electronAPI.closeSettingsWindow()
            }, 1000)
        })

    document.getElementById('closeButton').addEventListener('click', () => {
        window.electronAPI.closeSettingsWindow()
    })

    async function loadCompanionSettings() {
        const settings = await window.electronAPI.getSettings()

        document.getElementById('companionIP').value =
            settings.companionIP || '127.0.0.1'
        document.getElementById('companionPort').value =
            settings.companionPort || 16622
        document.getElementById('showOnStartup').checked =
            settings.showOnStartup !== false
    }

    async function loadDevices() {
        const devices = await window.electronAPI.getAllDevices()
        deviceList.innerHTML = ''

        devices.forEach((device) => {
            const container = document.createElement('div')
            container.classList.add('device')

            const idLabel = document.createElement('strong')
            idLabel.textContent = device.deviceId
            container.appendChild(idLabel)

            // === Left side fields ===
            const leftFields = document.createElement('div')
            leftFields.style.display = 'flex'
            leftFields.style.flexDirection = 'column'
            leftFields.style.gap = '4px'
            leftFields.style.marginRight = '20px'

            // === Right side fields ===
            const rightFields = document.createElement('div')
            rightFields.style.display = 'flex'
            rightFields.style.flexDirection = 'column'
            rightFields.style.gap = '4px'

            const columnCountInput = createInput('Columns', device.columnCount)
            const rowCountInput = createInput('Rows', device.rowCount)
            const bitmapSizeInput = createInput('Bitmap', device.bitmapSize)
            const alwaysOnTopInput = createCheckbox(
                'Always On Top',
                device.alwaysOnTop
            )
            const movableInput = createCheckbox('Movable', device.movable)
            const disablePressInput = createCheckbox(
                'Disable Button Presses',
                device.disablePress
            )
            const autoHideInput = createCheckbox(
                'Auto Hide on Mouse Leave',
                device.autoHide || false
            )
            const hideEmptyKeysInput = createCheckbox(
                'Hide Empty Keys',
                device.hideEmptyKeys || false
            )

            // Create color picker
            const backgroundColorInput = document.createElement('input')
            backgroundColorInput.type = 'color'
            backgroundColorInput.value = device.backgroundColor || '#000000'

            const backgroundOpacityInput = document.createElement('input')
            backgroundOpacityInput.type = 'range'
            backgroundOpacityInput.min = 0
            backgroundOpacityInput.max = 1
            backgroundOpacityInput.step = 0.01
            backgroundOpacityInput.value = device.backgroundOpacity || 0.5

            const backgroundColorLabel = document.createElement('label')
            backgroundColorLabel.textContent = 'Background Color: '
            backgroundColorLabel.appendChild(backgroundColorInput)

            const backgroundOpacityLabel = document.createElement('label')
            backgroundOpacityLabel.textContent = 'Background Opacity: '
            backgroundOpacityLabel.appendChild(backgroundOpacityInput)

            /*backgroundColorInput.addEventListener('input', async () => {
                await window.electronAPI.updateDeviceConfig({
                    deviceId: device.deviceId,
                    config: { backgroundColor: backgroundColorInput.value },
                })
            })*/

            backgroundOpacityInput.addEventListener('input', async () => {
                await window.electronAPI.updateDeviceConfig({
                    deviceId: device.deviceId,
                    config: {
                        backgroundOpacity: parseFloat(
                            backgroundOpacityInput.value
                        ),
                    },
                })
            })

            container.appendChild(document.createElement('hr'))

            // Append to leftFields
            ;[columnCountInput, rowCountInput, bitmapSizeInput].forEach(
                (inputObj) => {
                    leftFields.appendChild(inputObj.label)
                    leftFields.appendChild(inputObj.input)
                }
            )
            leftFields.appendChild(backgroundColorLabel)
            leftFields.appendChild(backgroundOpacityLabel)
            ;[
                alwaysOnTopInput,
                movableInput,
                disablePressInput,
                autoHideInput,
                hideEmptyKeysInput,
            ].forEach((inputObj) => {
                rightFields.appendChild(inputObj.label)
                rightFields.appendChild(inputObj.input)
            })
            // === Add fields to a row container ===
            const fieldsContainer = document.createElement('div')
            fieldsContainer.style.display = 'flex'
            fieldsContainer.style.justifyContent = 'space-between'
            fieldsContainer.style.alignItems = 'flex-start'
            fieldsContainer.appendChild(leftFields)
            fieldsContainer.appendChild(rightFields)

            container.appendChild(fieldsContainer)
            container.appendChild(document.createElement('hr'))

            // Save & Delete buttons
            const actions = document.createElement('div')
            actions.classList.add('device-actions')

            const saveBtn = document.createElement('button')
            saveBtn.textContent = 'Save'
            saveBtn.addEventListener('click', async () => {
                const config = {
                    columnCount: parseInt(columnCountInput.input.value, 10),
                    rowCount: parseInt(rowCountInput.input.value, 10),
                    bitmapSize: parseInt(bitmapSizeInput.input.value),
                    alwaysOnTop: alwaysOnTopInput.input.checked,
                    movable: movableInput.input.checked,
                    disablePress: disablePressInput.input.checked,
                    autoHide: autoHideInput.input.checked,
                    hideEmptyKeys: hideEmptyKeysInput.input.checked,
                    backgroundColor: backgroundColorInput.value,
                    backgroundOpacity: parseFloat(backgroundOpacityInput.value),
                }
                await window.electronAPI.updateDeviceConfig({
                    deviceId: device.deviceId,
                    config,
                })
                if (!container.querySelector('.save-confirmation')) {
                    const confirmation = document.createElement('span')
                    confirmation.className = 'save-confirmation'
                    confirmation.textContent = 'Settings saved!'
                    confirmation.style.marginLeft = '10px'
                    confirmation.style.fontSize = '12px'
                    confirmation.style.color = '#4CAF50'
                    confirmation.style.opacity = '0'
                    confirmation.style.transition = 'opacity 0.3s ease'

                    actions.appendChild(confirmation)

                    setTimeout(() => {
                        confirmation.style.opacity = '1'
                    }, 10)

                    setTimeout(() => {
                        confirmation.style.opacity = '0'
                        setTimeout(() => confirmation.remove(), 300)
                    }, 1500)
                }
            })
            actions.appendChild(saveBtn)

            const deleteBtn = document.createElement('button')
            deleteBtn.textContent = 'Delete'
            deleteBtn.style.backgroundColor = '#f44336'
            deleteBtn.style.color = 'white'
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`Delete device ${device.deviceId}?`)) {
                    await window.electronAPI.deleteDevice(device.deviceId)
                    loadDevices()
                }
            })
            actions.appendChild(deleteBtn)

            const resetBtn = document.createElement('button')
            resetBtn.textContent = 'Reset to Defaults'
            resetBtn.addEventListener('click', async () => {
                if (
                    confirm(
                        `Reset device ${device.deviceId} to default settings? This will not affect its hotkeys.`
                    )
                ) {
                    await window.electronAPI.resetDeviceToDefaults(
                        device.deviceId
                    )
                    loadDevices() // reload the whole list so displayed values reflect the reset
                }
            })
            actions.appendChild(resetBtn)

            container.appendChild(actions)
            deviceList.appendChild(container)
        })
    }

    function createCheckbox(labelText, checked) {
        const container = document.createElement('label')
        container.style.display = 'flex'
        container.style.alignItems = 'center'
        container.style.gap = '4px'

        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = checked

        const label = document.createElement('span')
        label.textContent = labelText

        container.appendChild(input)
        container.appendChild(label)

        return { label: container, input }
    }

    function createInput(labelText, value) {
        const label = document.createElement('label')
        label.textContent = labelText + ': '
        const input = document.createElement('input')
        input.type = 'number'
        input.value = value
        return { label, input }
    }

    addDeviceButton.addEventListener('click', async () => {
        await window.electronAPI.createNewDevice()
        loadDevices()
    })
})
