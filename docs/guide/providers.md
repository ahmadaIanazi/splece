# Providers and connections

Bring your own keys. Pay providers directly for their usage. Splece does not require a connection to edit imported media.

## What connects today

This table describes implemented source mappings, not a guarantee that every vendor model works. The selected model's current capability record determines input types, duration, resolution, audio and reference limits.

| Provider | Splece uses it for | Get a key / account | Official guide |
|---|---|---|---|
| Venice | Writing, images and mapped video workflows | [Venice API settings](https://venice.ai/settings/api) | [Create a key](https://docs.venice.ai/guides/getting-started/generating-api-key) |
| xAI / Grok | Mapped images, image edits and video | [xAI console](https://console.x.ai/) | [Quickstart](https://docs.x.ai/developers/quickstart) |
| fal.ai | Mapped images, video, speech and sound | [fal dashboard](https://fal.ai/dashboard/keys) | [Quickstart](https://fal.ai/docs/documentation/quickstart) |
| OpenAI | Writing and assistance | [API keys](https://platform.openai.com/api-keys) | [Key help](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key) |
| OpenRouter | Writing and assistance; supported vision models for image-aware tasks | [API keys](https://openrouter.ai/settings/keys) | [Quickstart](https://openrouter.ai/docs/quickstart) |
| DeepSeek | Writing, planning and assistance | [API keys](https://platform.deepseek.com/api_keys) | [API guide](https://api-docs.deepseek.com/) |

fal.ai is optional. Neither a ComfyUI installation nor a local generation GPU is required for the mapped cloud-provider workflows. Local analysis add-ons have separate requirements. A provider's consumer chat subscription may not include API credits; check its API billing page.

## Connect in a few steps

1. Open the provider's account link above and sign in.
2. In its API dashboard, create an API key. Use an appropriate spending limit if the provider offers one.
3. Check API billing or credits in that same dashboard.
4. In Splece, open **Settings → AI connections**, select the provider, and paste the key into its key field.
5. Verify the connection and choose an available model for the task. Connection checks request account/catalog information; they do not submit a generation.
6. Review your shot and inputs. Turn Online on only when you want to use connected AI.

Never paste a key into project text, screenshots, issues or chat. Keys are saved by the local service, outside portable project bundles.

## Native support versus extensibility

- **Native connection:** an implemented adapter and task mapping. Add your key and select a supported model.
- **Custom integration:** code changes that normalize authentication, inputs, job status, downloads and capability limits. Replicate, RunPod and arbitrary custom endpoints need this work today.
- **MCP:** a possible agent-control interface, not a generation-provider adapter. This release does not advertise a built-in MCP server.

OpenRouter support here is for writing/assistance, not arbitrary video routing. A vendor supporting an API feature does not automatically expose that feature in Splece.

[Add a provider →](provider-adapters.md)

## Verification limits

Automated checks use mocked provider responses and do not spend credits. Direct xAI/Grok live output has not been verified for this release. Catalog availability can change independently of Splece; a listed workflow is not a claim of paid end-to-end testing across every model.
