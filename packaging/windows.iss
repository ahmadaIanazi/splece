#ifndef AppVersion
#define AppVersion "0.1.0"
#endif
[Setup]
AppId={{F17B6892-840E-4B48-AFE2-89AA52FE608A}
AppName=Splece
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Splece
DefaultGroupName=Splece
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\release
OutputBaseFilename=Splece-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\public\brand\Splece.ico
UninstallDisplayIcon={app}\Splece.exe
CloseApplications=yes
RestartApplications=no
[Files]
Source: "..\release\windows-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Registry]
Root: HKCU; Subkey: "Software\Classes\splece"; ValueType: string; ValueName: ""; ValueData: "URL:Splece"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\splece"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\splece\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Splece.exe"" ""%1"""
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: checkedonce
[Icons]
Name: "{group}\Splece"; Filename: "{app}\Splece.exe"
Name: "{autodesktop}\Splece"; Filename: "{app}\Splece.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Splece.exe"; Description: "Open Splece"; Flags: nowait postinstall skipifsilent
; Project data is outside {app} and intentionally survives uninstall.
