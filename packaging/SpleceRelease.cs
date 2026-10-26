using System;
using System.Diagnostics;
using System.IO;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Windows.Forms;

class Splece {
    [STAThread] static void Main() {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), "\"" + Path.Combine(root, "studio", "scripts", "release", "bundled-launcher.mjs") + "\"");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            using (var process = Process.Start(start)) {
                process.BeginErrorReadLine();
                string json = process.StandardOutput.ReadToEnd();
                process.WaitForExit();
                var result = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                if (process.ExitCode != 0 || !(bool)result["ok"]) throw new Exception(result.ContainsKey("error") ? (string)result["error"] : "Splece could not start.");
                Process.Start(new ProcessStartInfo((string)result["url"]) { UseShellExecute = true });
            }
        } catch (Exception error) { MessageBox.Show(error.Message, "Splece", MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }
}
