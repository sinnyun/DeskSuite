# DeskSuite 把持久化数据固定在 $INSTDIR\data（见 src/main/paths.ts）。
# electron-builder 默认卸载逻辑会整目录删除/移走 $INSTDIR（uninstaller.nsh 的
# customRemoveFiles 默认分支），这里改为只清程序文件、保留 data。
!macro customRemoveFiles
  SetOutPath $TEMP
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  ${do}
    ${if} $R1 == ""
      ${break}
    ${endif}
    ${if} $R1 != "."
    ${andif} $R1 != ".."
    ${andif} $R1 != "data"
      ${if} ${FileExists} "$INSTDIR\$R1\*.*"
        RMDir /r "$INSTDIR\$R1"
      ${else}
        Delete "$INSTDIR\$R1"
      ${endif}
    ${endif}
    FindNext $R0 $R1
  ${loop}
  FindClose $R0
!macroend
