import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from 'electron';

export default class MenuBuilder {
  private readonly mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  buildMenu() {
    const development =
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true';
    const viewItems: MenuItemConstructorOptions[] = [
      ...(development
        ? ([
            { role: 'reload' },
            { role: 'toggleDevTools' },
          ] as MenuItemConstructorOptions[])
        : []),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ];
    const help: MenuItemConstructorOptions = {
      role: 'help',
      submenu: [
        {
          label: 'Pi documentation',
          click: () =>
            void shell.openExternal('https://github.com/earendil-works/pi'),
        },
      ],
    };
    const template: MenuItemConstructorOptions[] =
      process.platform === 'darwin'
        ? [
            { role: 'appMenu' },
            { role: 'fileMenu' },
            { role: 'editMenu' },
            { label: 'View', submenu: viewItems },
            { role: 'windowMenu' },
            help,
          ]
        : [
            { role: 'fileMenu' },
            { role: 'editMenu' },
            { label: 'View', submenu: viewItems },
            { role: 'windowMenu' },
            help,
          ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    if (development) {
      this.mainWindow.webContents.on('context-menu', (_event, properties) => {
        Menu.buildFromTemplate([
          {
            label: 'Inspect element',
            click: () =>
              this.mainWindow.webContents.inspectElement(
                properties.x,
                properties.y,
              ),
          },
        ]).popup({ window: this.mainWindow });
      });
    }
    return menu;
  }
}
