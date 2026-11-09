; The GUID comes from electron-builder's UUID-v5 of com.everfern.desktop.
!define EF_ELECTRON_GUID "41de1d5e-0192-5d93-b042-182cad964b10"

!macro NSIS_HOOK_PREINSTALL
  SetRegView 64
  ReadRegStr $R0 HKCU "Software\${EF_ELECTRON_GUID}" "InstallLocation"
  ${If} $R0 == ""
    SetRegView 32
    ReadRegStr $R0 HKCU "Software\${EF_ELECTRON_GUID}" "InstallLocation"
    SetRegView 64
  ${EndIf}
  ${If} $R0 != ""
    ; Preserve the previous per-user installation path for the framework switch.
    StrCpy $INSTDIR $R0
    IfFileExists "$APPDATA\EverFern\renderer-migration.native" ef_migration_ready 0
    IfFileExists "$APPDATA\desktop\renderer-migration.native" ef_migration_ready 0
      MessageBox MB_ICONSTOP "Open the EverFern bridge update once to prepare your saved data, then retry this update."
      Abort
    ef_migration_ready:
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 64
  ReadRegStr $R0 HKCU "Software\${EF_ELECTRON_GUID}" "InstallLocation"
  ${If} $R0 == $INSTDIR
    ; Remove only the superseded Electron uninstall entry after the Tauri install
    ; succeeds. Never invoke the old uninstaller: it can remove the new executable.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${EF_ELECTRON_GUID}"
    DeleteRegKey HKCU "Software\${EF_ELECTRON_GUID}"
  ${EndIf}
  SetRegView 32
  ReadRegStr $R0 HKCU "Software\${EF_ELECTRON_GUID}" "InstallLocation"
  ${If} $R0 == $INSTDIR
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${EF_ELECTRON_GUID}"
    DeleteRegKey HKCU "Software\${EF_ELECTRON_GUID}"
  ${EndIf}
  SetRegView 64
!macroend
