; The GUID comes from electron-builder's UUID-v5 of com.everfern.desktop.
!define EF_ELECTRON_GUID "41de1d5e-0192-5d93-b042-182cad964b10"
!include FileFunc.nsh

; 1 when this install replaces an Electron install in the same folder.
Var EfFromElectron

!macro NSIS_HOOK_PREINSTALL
  StrCpy $EfFromElectron 0
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
    StrCpy $EfFromElectron 1
    IfFileExists "$APPDATA\EverFern\renderer-migration.native" ef_migration_ready 0
    IfFileExists "$APPDATA\desktop\renderer-migration.native" ef_migration_ready 0
      MessageBox MB_ICONSTOP "Open the EverFern bridge update once to prepare your saved data, then retry this update." /SD IDOK
      Abort
    ef_migration_ready:
  ${EndIf}
!macroend

!macro EF_DROP_ELECTRON_KEYS
  ReadRegStr $R0 HKCU "Software\${EF_ELECTRON_GUID}" "InstallLocation"
  ${If} $R0 == $INSTDIR
    ; Remove only the superseded Electron uninstall entry after the Tauri install
    ; succeeds. Never invoke the old uninstaller: it can remove the new executable.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${EF_ELECTRON_GUID}"
    DeleteRegKey HKCU "Software\${EF_ELECTRON_GUID}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 64
  !insertmacro EF_DROP_ELECTRON_KEYS
  SetRegView 32
  !insertmacro EF_DROP_ELECTRON_KEYS
  SetRegView 64

  ${If} $EfFromElectron == 1
    ; Electron runtime files left in the shared folder. The Tauri payload lives in
    ; EverFern.exe plus app\, node\, skills\, prompts\, public\ and extension-navis\.
    RMDir /r "$INSTDIR\resources"
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\swiftshader"
    Delete "$INSTDIR\*.pak"
    Delete "$INSTDIR\icudtl.dat"
    Delete "$INSTDIR\snapshot_blob.bin"
    Delete "$INSTDIR\v8_context_snapshot.bin"
    Delete "$INSTDIR\ffmpeg.dll"
    Delete "$INSTDIR\d3dcompiler_47.dll"
    Delete "$INSTDIR\libEGL.dll"
    Delete "$INSTDIR\libGLESv2.dll"
    Delete "$INSTDIR\vk_swiftshader.dll"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\vulkan-1.dll"
    Delete "$INSTDIR\dxcompiler.dll"
    Delete "$INSTDIR\dxil.dll"
    Delete "$INSTDIR\LICENSE.electron.txt"
    Delete "$INSTDIR\LICENSES.chromium.html"
    Delete "$INSTDIR\Uninstall EverFern.exe"

    ; electron-updater starts this installer with "--updated /S --force-run" and
    ; expects it to reopen the app; Tauri's template only relaunches its own updates.
    ClearErrors
    ${GetOptions} $CMDLINE "--force-run" $R1
    ${IfNot} ${Errors}
    ${AndIf} ${Silent}
      Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
    ${EndIf}
  ${EndIf}
!macroend
