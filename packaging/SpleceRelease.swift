import AppKit
import Sparkle

final class SpleceRelease: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
    var updaterController: SPUStandardUpdaterController!
    var pendingUpdateCheck = false
    var updateState = "idle"
    var latestVersion: String?
    var checkedAt: Double?
    var busy = false
    var closing = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu(), item = NSMenuItem(), appMenu = NSMenu()
        item.submenu = appMenu; menu.addItem(item)
        let open = NSMenuItem(title:"Open Studio", action:#selector(openStudio), keyEquivalent:"o")
        open.target = self; appMenu.addItem(open)
        let updates = NSMenuItem(title:"Check for Updates…", action:#selector(checkForUpdates), keyEquivalent:"")
        updates.target = self; appMenu.addItem(updates)
        let logs = NSMenuItem(title:"Show Splece Data", action:#selector(showData), keyEquivalent:"")
        logs.target = self; appMenu.addItem(logs)
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title:"Quit Splece", action:#selector(NSApplication.terminate(_:)), keyEquivalent:"q"))
        NSApp.mainMenu = menu
        updaterController = SPUStandardUpdaterController(startingUpdater:true, updaterDelegate:self, userDriverDelegate:nil)
        writeUpdateState("idle")
        openStudio()
        if pendingUpdateCheck { checkForUpdates() }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        if urls.contains(where: { $0.scheme == "splece" && $0.host == "updates" }) { checkForUpdates() }
        else if urls.contains(where: { $0.scheme == "splece" && $0.host == "open" }) { openStudio() }
    }
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openStudio(); return true }
    @objc func checkForUpdates() {
        guard let controller = updaterController else { pendingUpdateCheck = true; return }
        pendingUpdateCheck = false
        if closing { return }
        NSApp.activate(ignoringOtherApps:true)
        if !controller.updater.canCheckForUpdates { writeUpdateState(updateState, "Continue in the Splece update window."); return }
        latestVersion = nil
        writeUpdateState("checking", "Checking splece.com for updates…")
        controller.checkForUpdates(nil)
    }
    func writeUpdateState(_ state: String, _ message: String = "") {
        updateState = state
        guard let resources = Bundle.main.resourceURL else { return }
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Splece/launcher")
        var value: [String:Any] = ["state":state, "message":message,
            "pid":ProcessInfo.processInfo.processIdentifier,
            "root":resources.appendingPathComponent("studio").resolvingSymlinksInPath().path,
            "version":Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "",
            "updatedAt":Date().timeIntervalSince1970 * 1000]
        if let latestVersion { value["latestVersion"] = latestVersion }
        if let checkedAt { value["checkedAt"] = checkedAt }
        do {
            try FileManager.default.createDirectory(at:folder, withIntermediateDirectories:true)
            try JSONSerialization.data(withJSONObject:value).write(to:folder.appendingPathComponent("update-state.json"), options:.atomic)
        } catch { NSLog("Unable to save update status: %@", error.localizedDescription) }
    }
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        checkedAt = Date().timeIntervalSince1970 * 1000
        latestVersion = item.displayVersionString
        writeUpdateState("available", "An update is available. Continue in the Splece update window.")
    }
    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
        checkedAt = Date().timeIntervalSince1970 * 1000
        writeUpdateState("current", "You have the latest compatible version of Splece.")
    }
    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        writeUpdateState("downloading", "Downloading your update. You can cancel in the Splece update window.")
    }
    func updater(_ updater: SPUUpdater, didExtractUpdate item: SUAppcastItem) {
        writeUpdateState("ready", "Update ready. Finish your work, then install and relaunch from the Splece window.")
    }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        let code = (error as NSError).code
        if code == SUError.noUpdateError.rawValue { return }
        writeUpdateState("error", "The update could not finish. Your installed app is unchanged. Try again from the Splece update window.")
    }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        if error == nil && ["checking", "available", "downloading"].contains(updateState) {
            writeUpdateState("idle", "Check again whenever you’re ready.")
        }
    }
    func userDidCancelDownload(_ updater: SPUUpdater) {
        writeUpdateState("cancelled", "Download cancelled. Your installed app is unchanged.")
    }
    @objc func showData() {
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Splece")
        NSWorkspace.shared.open(folder)
    }
    @objc func openStudio() {
        if busy || closing { return }; busy = true
        guard let resources = Bundle.main.resourceURL else { busy = false; return }
        DispatchQueue.global(qos:.userInitiated).async {
            let process = Process(), output = Pipe()
            process.executableURL = resources.appendingPathComponent("runtime/node")
            process.arguments = [resources.appendingPathComponent("studio/scripts/release/bundled-launcher.mjs").path]
            process.environment = self.launchEnvironment()
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                let bytes = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let result = (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any]
                DispatchQueue.main.async {
                    self.busy = false
                    if process.terminationStatus == 0, result?["ok"] as? Bool == true,
                       let address = result?["url"] as? String, let url = URL(string:address) { NSWorkspace.shared.open(url) }
                    else { self.error(result?["error"] as? String ?? "Splece could not start. Open Show Splece Data in the menu to find the launcher logs.") }
                }
            } catch { DispatchQueue.main.async { self.busy = false; self.error(error.localizedDescription) } }
        }
    }
    func launchEnvironment() -> [String:String] {
        var environment = ProcessInfo.processInfo.environment
        for key in ["NODE_OPTIONS", "NODE_PATH", "PORT", "STUDIO_DATA_DIR"] { environment.removeValue(forKey:key) }
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if busy || closing { return .terminateCancel }
        guard let resources = Bundle.main.resourceURL else { return .terminateNow }
        closing = true
        DispatchQueue.global(qos:.userInitiated).async {
            let process = Process(), output = Pipe()
            process.executableURL = resources.appendingPathComponent("runtime/node")
            process.arguments = [resources.appendingPathComponent("studio/scripts/release/bundled-launcher.mjs").path, "stop"]
            process.environment = self.launchEnvironment()
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                let bytes = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let result = (try? JSONSerialization.jsonObject(with:bytes)) as? [String:Any]
                DispatchQueue.main.async {
                    self.closing = false
                    let ok = process.terminationStatus == 0 && result?["ok"] as? Bool == true
                    NSApp.reply(toApplicationShouldTerminate:ok)
                    if !ok {
                        NSApp.activate(ignoringOtherApps:true)
                        let alert = NSAlert()
                        alert.messageText = "Your studio is still working."
                        alert.informativeText = result?["error"] as? String ?? "Please wait for Splece to finish saving or generating, then quit again."
                        alert.addButton(withTitle:"Keep Working"); alert.runModal()
                    }
                }
            } catch {
                DispatchQueue.main.async { self.closing = false; NSApp.reply(toApplicationShouldTerminate:false); self.error(error.localizedDescription) }
            }
        }
        return .terminateLater
    }
    func error(_ message: String) {
        NSApp.activate(ignoringOtherApps:true)
        let alert = NSAlert(); alert.messageText = "Let’s get your studio open."; alert.informativeText = message
        alert.addButton(withTitle:"Try Again"); alert.addButton(withTitle:"Close")
        if alert.runModal() == .alertFirstButtonReturn { openStudio() }
    }
}
let app = NSApplication.shared
let delegate = SpleceRelease()
app.setActivationPolicy(.regular); app.delegate = delegate; app.run()
