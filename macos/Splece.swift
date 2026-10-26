import AppKit

final class SpleceDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let defaults = UserDefaults.standard
    private var window: NSWindow!
    private var status: NSTextField!
    private var progress: NSProgressIndicator!
    private var openButton: NSButton!
    private var folderButton: NSButton!
    private var busy = false
    private var config: [String: Any] = [:]

    var root: String { defaults.string(forKey:"codeRoot") ?? config["codeRoot"] as? String ?? "" }
    var port: Int { config["port"] as? Int ?? 4310 }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let url = Bundle.main.url(forResource:"Configuration",withExtension:"json"),
           let data = try? Data(contentsOf:url),
           let value = try? JSONSerialization.jsonObject(with:data) as? [String:Any] { config = value }
        makeMenu()
        makeWindow()
        launchStudio()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        launchStudio()
        return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        for (title, action) in [("Open Studio", #selector(openStudio)),
                                ("Launcher Settings…", #selector(showLauncher)),
                                ("Apply Code Updates…", #selector(applyUpdates)),
                                ("Show Launcher Logs", #selector(revealLogs))] {
            let item = NSMenuItem(title:title,action:action,keyEquivalent:"")
            item.target = self; menu.addItem(item)
        }
        return menu
    }

    private func makeMenu() {
        let main = NSMenu()
        let item = NSMenuItem(); main.addItem(item)
        let app = NSMenu(title:"Splece"); item.submenu = app
        func add(_ title: String, _ action: Selector, _ key: String = "") {
            let entry = NSMenuItem(title:title,action:action,keyEquivalent:key); entry.target = self; app.addItem(entry)
        }
        add("About Splece", #selector(about))
        app.addItem(.separator())
        add("Open Studio", #selector(openStudio), "o")
        add("Launcher Settings…", #selector(showLauncher), ",")
        add("Apply Code Updates…", #selector(applyUpdates), "r")
        add("Show Code Folder", #selector(revealCode))
        add("Choose Code Folder…", #selector(chooseFolder))
        add("Show Launcher Logs", #selector(revealLogs))
        app.addItem(.separator())
        add("Hide Splece", #selector(hideApp), "h")
        add("Quit Splece", #selector(quitApp), "q")
        NSApp.mainMenu = main
    }
    private func makeWindow() {
        window = NSWindow(contentRect:NSRect(x:0,y:0,width:440,height:292),
                          styleMask:[.titled,.closable,.miniaturizable],backing:.buffered,defer:false)
        window.title = "Splece"; window.delegate = self; window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named:.darkAqua)
        window.backgroundColor = NSColor(calibratedRed:0.06,green:0.08,blue:0.12,alpha:1)
        window.center()
        let content = window.contentView!
        let icon = NSImageView(frame:NSRect(x:28,y:184,width:72,height:72))
        icon.image = NSApp.applicationIconImage; content.addSubview(icon)
        let title = NSTextField(labelWithString:"Splece")
        title.font = .systemFont(ofSize:28,weight:.semibold); title.frame = NSRect(x:112,y:214,width:280,height:36)
        content.addSubview(title)
        let subtitle = NSTextField(labelWithString:"Your stories. In motion.")
        subtitle.textColor = .secondaryLabelColor; subtitle.frame = NSRect(x:114,y:189,width:290,height:22)
        content.addSubview(subtitle)
        status = NSTextField(wrappingLabelWithString:"Opening your local studio…")
        status.font = .systemFont(ofSize:13); status.frame = NSRect(x:32,y:104,width:376,height:64)
        content.addSubview(status)
        progress = NSProgressIndicator(frame:NSRect(x:32,y:86,width:376,height:4))
        progress.style = .bar; progress.isIndeterminate = true; content.addSubview(progress)
        folderButton = NSButton(title:"Code Folder…",target:self,action:#selector(chooseFolder))
        folderButton.bezelStyle = .rounded; folderButton.frame = NSRect(x:26,y:26,width:136,height:32)
        content.addSubview(folderButton)
        openButton = NSButton(title:"Open Studio",target:self,action:#selector(openStudio))
        openButton.bezelStyle = .rounded; openButton.keyEquivalent = "\r"; openButton.frame = NSRect(x:264,y:26,width:150,height:32)
        content.addSubview(openButton)
    }

    private func findNode() -> String? {
        var candidates = [config["node"] as? String ?? "", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        let nvm = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nvm/versions/node")
        let versions = (try? FileManager.default.contentsOfDirectory(atPath:nvm.path)) ?? []
        candidates += versions.sorted { $0.compare($1,options:.numeric) == .orderedDescending }
            .map { nvm.appendingPathComponent($0).appendingPathComponent("bin/node").path }
        return candidates.first { FileManager.default.isExecutableFile(atPath:$0) }
    }

    private func launchStudio(_ command: String = "open") {
        if busy { window.makeKeyAndOrderFront(nil); return }
        guard FileManager.default.fileExists(atPath:root + "/scripts/studio-launcher.mjs") else {
            showError("Choose the Splece code folder. It may have moved since the app was installed."); return
        }
        guard let node = findNode() else {
            showError("Node.js 22.13 or newer is needed. Install Node, then reopen Splece."); return
        }
        busy = true; openButton.isEnabled = false; folderButton.isEnabled = false
        status.stringValue = command == "restart" ? "Checking that jobs are finished before applying updates…" : "Opening your studio. Checking for code updates…"
        progress.isHidden = false; progress.startAnimation(nil)
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
        let codeRoot = root, serverPort = port
        DispatchQueue.global(qos:.userInitiated).async {
            do {
                let process = Process(), output = Pipe()
                process.executableURL = URL(fileURLWithPath:node)
                process.arguments = [codeRoot + "/scripts/studio-launcher.mjs",command,codeRoot]
                process.currentDirectoryURL = URL(fileURLWithPath:codeRoot)
                var environment = ProcessInfo.processInfo.environment
                environment["PORT"] = String(serverPort)
                environment["PATH"] = URL(fileURLWithPath:node).deletingLastPathComponent().path + ":" + (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")
                process.environment = environment
                let logFolder = URL(fileURLWithPath:codeRoot).appendingPathComponent(".studio-launcher")
                try FileManager.default.createDirectory(at:logFolder,withIntermediateDirectories:true)
                let log = logFolder.appendingPathComponent("launcher.log")
                if !FileManager.default.fileExists(atPath:log.path) { FileManager.default.createFile(atPath:log.path,contents:nil,attributes:[.posixPermissions:0o600]) }
                let errors = try FileHandle(forWritingTo:log); try errors.seekToEnd()
                defer { try? errors.close() }
                process.standardOutput = output; process.standardError = errors
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let result = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
                DispatchQueue.main.async {
                    self.busy = false; self.openButton.isEnabled = true; self.folderButton.isEnabled = true
                    self.progress.stopAnimation(nil); self.progress.isHidden = true
                    if process.terminationStatus == 0, result?["ok"] as? Bool == true,
                       let address = result?["url"] as? String, let url = URL(string:address) {
                        NSWorkspace.shared.open(url)
                        if result?["updatePending"] as? Bool == true {
                            self.status.stringValue = result?["legacy"] as? Bool == true
                                ? "Studio opened. The older server is still running. Stop it from its original terminal after jobs finish, then reopen Splece."
                                : "Studio opened. Jobs are still running, so server updates are waiting. Reopen Splece after they finish to apply them."
                        } else { self.window.orderOut(nil) }
                    } else { self.showError(result?["error"] as? String ?? "Splece could not start. Check Show Launcher Logs in the Splece menu, then try again.") }
                }
            } catch {
                DispatchQueue.main.async { self.showError(error.localizedDescription) }
            }
        }
    }
    private func showError(_ message: String) {
        busy = false; status.stringValue = message; progress.stopAnimation(nil); progress.isHidden = true
        openButton.isEnabled = true; folderButton.isEnabled = true
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }
    @objc private func openStudio() { launchStudio() }
    @objc private func showLauncher() {
        if !busy {
            status.stringValue = "Splece opens your editable code folder. Closing this window or quitting the launcher leaves your server and jobs running."
            progress.isHidden = true
        }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }
    @objc private func applyUpdates() { launchStudio("restart") }
    @objc private func revealCode() { NSWorkspace.shared.open(URL(fileURLWithPath:root)) }
    @objc private func revealLogs() { NSWorkspace.shared.open(URL(fileURLWithPath:root).appendingPathComponent(".studio-launcher")) }
    @objc private func chooseFolder() {
        guard !busy else { return }
        let panel = NSOpenPanel(); panel.title = "Choose the Splece code folder"
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.prompt = "Use Folder"
        if panel.runModal() == .OK, let selected = panel.url {
            guard FileManager.default.fileExists(atPath:selected.appendingPathComponent("scripts/studio-launcher.mjs").path) else {
                showError("That folder does not contain the Splece launcher. Choose your ai-video source folder."); return
            }
            defaults.set(selected.path,forKey:"codeRoot"); launchStudio()
        }
    }
    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"Splece",.applicationVersion:"1.0",
            .credits:NSAttributedString(string:"A local home for your stories.\n\nThe app opens your editable source folder.\nClosing this launcher leaves generation jobs running.")])
    }
    @objc private func hideApp() { NSApp.hide(nil) }
    @objc private func quitApp() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = SpleceDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
