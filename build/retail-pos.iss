; Prepare the complete desktop/LAN package with: npm run pack
; Then compile with Inno Setup 7 (ISCC.exe) to generate dist-inno\Vertexia Retail POS Setup.exe
#define MyAppName "Vertexia Retail POS"
#define MyAppPublisher "Vertexia"
#define MyAppExeName "Vertexia Retail POS.exe"
#define MyPackageDir AddBackslash(SourcePath) + "..\installer-dist\win-unpacked"
#define MyAppExePath MyPackageDir + "\" + MyAppExeName

#if !FileExists(MyAppExePath)
  #error "Desktop package missing. Run npm run pack from the project folder first."
#endif
#if !FileExists(MyPackageDir + "\resources\app\dist\index.html") || !FileExists(MyPackageDir + "\resources\app\server-dist\server\server.mjs") || !FileExists(MyPackageDir + "\resources\app\electron-dist\electron\main.mjs")
  #error "Desktop package is incomplete. Run npm run pack before compiling."
#endif
#if !FileExists(MyPackageDir + "\resources\app\node_modules\fastify\package.json")
  #error "Runtime dependencies are missing. Run npm run pack."
#endif
#if DirExists(MyPackageDir + "\resources\app\company") || DirExists(MyPackageDir + "\resources\app\data") || DirExists(MyPackageDir + "\resources\app\cloud-server") || DirExists(MyPackageDir + "\resources\app\cloud-dist") || FileExists(MyPackageDir + "\resources\app\.env")
  #error "Private, cloud-server, or database files detected in the package. Do not distribute this package."
#endif

; Read the version from the actual executable being shipped, not a stale constant.
#define MyAppVersion GetStringFileInfo(MyAppExePath, "FileVersion")
#define MyBinaryVersion GetVersionNumbersString(MyAppExePath)
#if MyAppVersion == ""
  #error "The packaged executable has no version information. Run npm run pack."
#endif

[Setup]
AppId={{D4A82F19-6E31-4C5A-B89E-2A7E1C49F810}
AppName={#MyAppName}
LicenseFile=license.txt
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://vertexiaagency.com
AppSupportURL=https://vertexiaagency.com
VersionInfoVersion={#MyBinaryVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Installer
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
; Always write the latest installer to the repository's dist-inno folder.
OutputDir=..\dist-inno
OutputBaseFilename=Vertexia Retail POS Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupIconFile=retail-pos.ico
WizardImageFile=retail-welcome.bmp,retail-welcome_150.bmp,retail-welcome_200.bmp,retail-welcome_250.bmp
WizardSmallImageFile=retail-small.bmp,retail-small_150.bmp,retail-small_200.bmp,retail-small_250.bmp
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll,*.node
RestartApplications=no
SetupLogging=yes

[Files]
; Includes Electron, built React web app, Fastify LAN server, production node_modules,
; and brand icons. Customer data and private keys stay outside {app}; no data-delete actions.
Source: "{#MyPackageDir}\*"; DestDir: "{app}"; Excludes: ".env,.env.*,*.pem,resources\app\company\*,resources\app\data\*,resources\app\backups\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
var
  PublisherLabel: TNewStaticText;

procedure InitializeWizard;
begin
  PublisherLabel := TNewStaticText.Create(WizardForm);
  PublisherLabel.Parent := WizardForm;
  PublisherLabel.Caption := 'Powered by {#MyAppPublisher}';
  PublisherLabel.Left := ScaleX(16);
  PublisherLabel.Top := WizardForm.CancelButton.Top + ScaleY(4);
  PublisherLabel.Anchors := [akLeft, akBottom];
  PublisherLabel.Font.Color := clGray;
  PublisherLabel.Font.Size := 8;
end;
