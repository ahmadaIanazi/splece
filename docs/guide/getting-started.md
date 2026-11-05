# Your first project

## Install and open

Choose the [desktop download for your system](https://www.splece.com/#download), follow its installation instructions, then open Splece. The app runs locally and opens its editor in your browser. Keep the app running while you work.

Core desktop editing does not require Git, Node.js or Python. Developer setup is separate. Optional local add-ons may require Python, Git or build tools; see [their requirements](../local-addons.md).

## Make a small edit first

1. Create a project and give it a name.
2. Keep **Online off** while exploring. Add a short clip or image that you own to the **Media Library**.
3. Add the media to your edit. Use the **playhead** to move through the timeline and preview the result.
4. Trim a clip, try a different take where available, and adjust the sound or elements you need.
5. Export a short result to your computer. Keep a backup of your original media and project folder.

Offline generation previews are samples, not newly generated AI video. You can learn the controls without spending inference credits.

## Add AI when you are ready

Open Settings → AI connections and choose a supported provider. Follow the account/key links, add credits with that provider if needed, then paste the key into Splece. Start with one connection; there is no need to register for every service.

Choose the provider/model for the task you want to use. Add your references, write one short shot, and review the prepared prompt, supported inputs and estimated cost. Switch Online on when you intend to submit a paid request. Estimates are not a promise of the final provider bill.

See [connections](providers.md) and [prompting](prompting.md).

## If something does not work

- **The browser cannot connect:** open the installed Splece app again and wait for its local service. The website is not the running desktop studio.
- **No models appear:** check the connection status, account access and selected task. A text connection does not provide video generation.
- **A reference is rejected:** choose a workflow that supports that reference type or change the inputs. Do not assume a different model accepts the same request.
- **Generation is still pending:** check the existing job. An accepted job can resume polling after restart; do not submit another paid request just to refresh it.
- **Installer warning:** follow the instructions for that exact download. The Windows beta is unsigned. Only download official Splece packages.
