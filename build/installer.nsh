; Custom NSIS script for EverFern Modern Installer Wizard

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to the EverFern Setup Wizard"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of EverFern, your autonomous AI workplace agent.\r\n\r\nIt is recommended that you close all other applications before starting Setup.\r\n\r\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to the EverFern Uninstall Wizard"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the uninstallation of EverFern, your autonomous AI workplace agent.\r\n\r\nBefore starting the uninstallation, please make sure EverFern is not running.\r\n\r\nClick Next to continue."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
