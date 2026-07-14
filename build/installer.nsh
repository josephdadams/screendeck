; Custom NSIS include for electron-builder.
;
; Workaround for GitHub issue #48: after a fresh install on Windows, the
; Start Menu / Desktop shortcut sometimes shows a generic/blank icon instead
; of the app icon until the user opens the folder a few times. This is a
; well-known class of Windows Explorer icon-cache staleness that can occur
; right after an NSIS installer creates a new executable and shortcuts
; pointing at it.
;
; "customInstall" is a documented electron-builder/NSIS hook: app-builder-lib's
; installSection.nsh contains
;   !ifmacrodef customInstall
;     !insertmacro customInstall
;   !endif
; which runs immediately after the Start Menu and Desktop shortcuts have
; been created (see addStartMenuLink / addDesktopLink earlier in the same
; file), so this fires at the right point in the install sequence.
;
; SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL) asks Explorer
; to flush its icon/association cache and re-read shell icons. This is the
; standard, commonly cited technique for this exact symptom, but it is a
; best-effort mitigation for Explorer cache flakiness, not a guaranteed fix,
; and it has NOT been verified against a real installation of this app on
; Windows.
!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
