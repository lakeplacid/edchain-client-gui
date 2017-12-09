var path = require('path');         // https://nodejs.org/api/path.html
var url = require('url');           // https://nodejs.org/api/url.html
var log = require('electron-log');
const { exec } = require('child_process');
const platform = require('os').platform();
const { 
    ipcMain, app, protocol, BrowserWindow, 
    Menu, Tray, nativeImage 
} = require('electron');

var __windows = {};

var __logSubscribers = {};


var getIcon = (function(){
    var iconMap = {
        "darwin": "/public/img/icon.icns",
        "linux": "/public/img/icon.png"
    };

    return function(){
        return iconMap[platform] || "/public/img/icon.png";
    };
})();

var ipfs = require('./process_ipfs')({
    "afterLogUpdateHook": function(ipfsLog){
        for(let subscriber in __logSubscribers){
            if(typeof subscriber.send === 'function'){
                subscriber.send('ipfs:logging', ipfsLog);
            }
        }
    }
});

var registerListeners = function(listeners){
    for (let prefix in listeners){
        for(let prop in listeners[prefix]){
            if(typeof listeners[prefix][prop] === 'function'){
                ipcMain.on(prefix + ':' + prop, listeners[prefix][prop]);
            }
        }
    }   
};

registerListeners({ipfs});


var getTray = (function(){
    var tray = null;
    return function(__window){
        if(!tray){
            tray = new Tray(path.resolve(__dirname, "public/img/icon.png"));
        }

        tray.on('click', () => {
            __window.isVisible() ? __window.hide() : __window.show();
        });

        __window.on('show', () => {
            tray.setHighlightMode('always');
        });

        __window.on('hide', () => {
            tray.setHighlightMode('never');
        });
        return tray;
    };
})();

var createChildWindow = function (mainWindow, url) {
    
    var child = createWindow({
        parent: mainWindow, 
        modal:true, 
        show:true,
        hasIpfsLogging: true
    });

    if (process.platform === 'darwin') {
        child.webContents.once("did-navigate", function(event, ...args){
            child.webContents.once("dom-ready", function(event, ...args){
                var pageModification = `(function(){
                    var $nav = $('<nav><button id="close-sheet">Close</button></nav>').prependTo('body');
                    $nav.on("click", "#close-sheet", function(event){
                        event.preventDefault();
                        window.close();
                    });
                })();`;
                event.sender.executeJavaScript(pageModification, null, function(){log.info("here")});
            });
        });
    }
    child.loadURL(url);
    return child;

};

var showChildWindow = function(browserWindow){
    browserWindow.show();
    // browserWindow.openDevTools();
    // log.info(browserWindow.webContents); 
};

// Window Factory
var createWindow = function createWindow(config){
    var 
        __id, browserWindow, 
        hasIpfsLogging = false;
    
    if(Object.hasOwnProperty.call(config, "hasIpfsLogging")){
        hasIpfsLogging = config["hasIpfsLogging"];
        config["hasIpfsLogging"] = null;
    }

    browserWindow = new BrowserWindow(config);
    __id = browserWindow.id;
    
    __windows[__id] = browserWindow;
    
    if(hasIpfsLogging){
        __logSubscribers[__id] = browserWindow.webContents;
    }

    browserWindow.on('closed', function(){
        __windows[__id].removeAllListeners();
        
        if(__logSubscribers[__id]) __logSubscribers[__id] = null;

        __windows[__id] = null;
    });
    return browserWindow;
};

var createMainWindow = function createMainWindow(){
    var
        settingsWindow, mainWindow;

    mainWindow = createWindow({
        width: 960,
        height: 540,
        //frame: false,
        icon: path.resolve(__dirname, "public/img/icon.png")
    });

    mainWindow.tray = getTray(mainWindow);

    mainWindow.loadURL(`file://${__dirname}/public/html/index.html`);
    
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
   
    ipcMain.on('createAndShowChildWindow', function(event,url){
        showChildWindow(createChildWindow(mainWindow, url));
    });

    ipcMain.on('createChildWindow', function(event, url){
        settingsWindow = createChildWindow(mainWindow,url);
    });

    ipcMain.on('showChildWindow', function(){
        showChildWindow(settingsWindow);
    });

    ipcMain.on("closePage", function(event, id){
        __windows[id].close();
    });
};

// macOS
// https://electronjs.org/docs/api/app#appdockseticonimage-macos
if (platform === "darwin"){
    // Seems to hate my .icns
    // app.dock.setIcon(__dirname + getIcon());
    app.dock.setIcon(path.resolve(__dirname, "public/img/icon.png"));
}

app.on('ready', function(){
    // Custom File Protocol
    // Confirm if this works on windows
    // protocol.interceptFileProtocol(
    //     'file', 
    //     (request, callback) => {
    //         const url = request.url.substr(7);    /* all urls start with 'file://' */
    //         const assetPath = path.normalize(`${__dirname}/${url}`);
    //         callback({ "path": assetPath });
    //     }, (err) => {
    //     if (err) console.error('Failed to register protocol')
    // });

    createMainWindow();

});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    ipfs.stop();
});


app.on('activate', (event, hasVisibleWindows) => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (!Object.keys(__windows).length) {
        createMainWindow();
    } else if (hasVisibleWindows) {
        event.preventDefault();
    }
});