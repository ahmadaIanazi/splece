using System.Diagnostics;
using System.Text.Json;
using Velopack;

internal static class Program {
    static readonly string Root = AppContext.BaseDirectory;
    static readonly string Studio = Path.Combine(Root,"studio");
    static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Splece");
    static string Version => JsonDocument.Parse(File.ReadAllText(Path.Combine(Studio,"package.json"))).RootElement.GetProperty("version").GetString()!;
    [STAThread] static void Main(string[] args) {
        // Never let a pending update bypass the studio's active-work shutdown guard.
        VelopackApp.Build().SetAutoApplyOnStartup(false).Run();
        ApplicationConfiguration.Initialize();
        if(args.Contains("--update")) {
            using var mutex = new Mutex(true,"Local\\SpleceUpdate",out bool first);
            if(!first){MessageBox.Show("An update window is already open.","Splece updates");return;}
            using var form=new Form {Text="Splece updates",Width=470,Height=210,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false};
            var label=new Label {Text="Checking for updates…",Dock=DockStyle.Fill,Padding=new Padding(24),Font=new Font("Segoe UI",11)};
            form.Controls.Add(label);
            using var cancel=new CancellationTokenSource();form.FormClosing+=(_,_)=>cancel.Cancel();
            form.Shown+=async (_,_)=>{
                try {
                    State("checking","Checking splece.com for updates…");
                    var result=await Node("scripts/release/windows-updater.mjs",["check"],cancel.Token);
                    if(!result.GetProperty("available").GetBoolean()){State("current","You have the latest compatible version of Splece.");MessageBox.Show(form,"You’re up to date.","Splece");return;}
                    var version=result.GetProperty("version").GetString()!;State("available",$"Splece {version} is available.",version);
                    if(MessageBox.Show(form,$"Splece {version} is available. Download it now? Your projects and API connections stay on this PC.","Splece updates",MessageBoxButtons.YesNo)!=DialogResult.Yes){State("idle","Check again whenever you’re ready.");return;}
                    label.Text="Downloading and verifying your update…\nYou can close this window to cancel.";State("downloading","Downloading and verifying your update…",version);
                    var download=await Node("scripts/release/windows-updater.mjs",["download",version],cancel.Token);
                    var manager=new UpdateManager(download.GetProperty("folder").GetString()!);
                    if(!manager.IsInstalled)throw new Exception("Install Splece using its installer before updating.");
                    var update=await manager.CheckForUpdatesAsync();
                    if(update==null)throw new Exception("No compatible update is available.");
                    await manager.DownloadUpdatesAsync(update,cancelToken:cancel.Token);
                    State("ready","Update ready. Finish your work before restarting.",version);
                    if(MessageBox.Show(form,"Ready to install. Finish editing in all browser tabs, then choose OK to restart Splece. Active jobs must finish first.","Splece updates",MessageBoxButtons.OKCancel)!=DialogResult.OK){State("idle","Update downloaded. Check again when you’re ready to restart.");return;}
                    await Node("scripts/release/bundled-launcher.mjs",["stop"],cancel.Token);
                    State("installing","Installing the update and reopening Splece…",version);
                    manager.ApplyUpdatesAndRestart(update);
                } catch(OperationCanceledException){State("cancelled","Update cancelled. Your installed app is unchanged.");}
                catch(Exception ex){State("error",ex.Message);MessageBox.Show(form,ex.Message,"Splece updates",MessageBoxButtons.OK,MessageBoxIcon.Information);}
                finally {form.Close();}
            };
            Application.Run(form);
        } else {
            try {var result=Node("scripts/release/bundled-launcher.mjs",[],CancellationToken.None).GetAwaiter().GetResult();Process.Start(new ProcessStartInfo(result.GetProperty("url").GetString()!){UseShellExecute=true});}
            catch(Exception ex){MessageBox.Show(ex.Message,"Splece",MessageBoxButtons.OK,MessageBoxIcon.Information);}
        }
    }
    static void State(string state,string message,string? latest=null){
        try{var folder=Path.Combine(Data,"launcher");Directory.CreateDirectory(folder);var target=Path.Combine(folder,"update-state.json");var temp=target+"."+Environment.ProcessId;
        File.WriteAllText(temp,JsonSerializer.Serialize(new{state,message,latestVersion=latest,version=Version,pid=Environment.ProcessId,root=Path.TrimEndingDirectorySeparator(Studio),checkedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),updatedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}));File.Move(temp,target,true);}catch{}
    }
    static async Task<JsonElement> Node(string script,string[] args,CancellationToken cancel){
        var start=new ProcessStartInfo(Path.Combine(Root,"runtime","node.exe")){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Root};
        start.ArgumentList.Add(Path.Combine(Studio,script));foreach(var arg in args)start.ArgumentList.Add(arg);
        foreach(var key in new[]{"NODE_OPTIONS","NODE_PATH","PORT","STUDIO_DATA_DIR"})start.Environment.Remove(key);
        using var child=Process.Start(start)??throw new Exception("Splece could not start.");
        using var registration=cancel.Register(()=>{try{child.Kill(true);}catch{}});
        var stdout=child.StandardOutput.ReadToEndAsync();var stderr=child.StandardError.ReadToEndAsync();await child.WaitForExitAsync(cancel);await stderr;
        var value=JsonDocument.Parse(await stdout).RootElement.Clone();
        if(child.ExitCode!=0 || (value.TryGetProperty("ok",out var ok)&&!ok.GetBoolean()))throw new Exception(value.TryGetProperty("error",out var error)?error.GetString():"Splece could not finish this step.");return value;
    }
}
