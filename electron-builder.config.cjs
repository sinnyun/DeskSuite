const owner = process.env.DESKSUITE_GITHUB_OWNER
const repo = process.env.DESKSUITE_GITHUB_REPO

module.exports = {
  appId: 'com.desksuite.desktop',
  productName: 'DeskSuite',
  directories: {
    output: 'release'
  },
  files: ['out/**/*'],
  extraResources: [
    {
      from: 'native/lore-bridge/bin',
      to: 'lore-bridge',
      filter: ['desksuite-lore-bridge.exe', 'desksuite-lore-bridge']
    }
  ],
  asar: true,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  ...(owner && repo
    ? {
        publish: [{ provider: 'github', owner, repo, releaseType: 'release' }]
      }
    : {})
}
