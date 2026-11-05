# Direct the shot

Start with what the audience should see. Add the movement that matters. Keep each generation focused on a coherent action.

## Give the project a shared direction

Use **General** for the film's premise, atmosphere and continuity. Put the specific action in the shot. Keep exact speech in the dialogue controls and select real references from the Media Library.

**Example — A Little Lighter**

> An 18-second cinematic short about a quiet moment of freedom. At sunrise, a traveler crosses ivory dunes carrying cobalt-blue silk. Warm champagne light, pearl skies and soft blue-gray shadows surround one vivid blue accent. Keep the same traveler, ivory dress and silk throughout. Natural textures, spacious compositions and restrained camera movement. No dialogue or on-screen text.

This describes creative intent; it does not force a provider to reproduce physical optics or exact colors.

## Write one clear action

A useful starting order is **subject → action → setting → camera → visual treatment**. It is a writing aid, not a required syntax for every model.

> A traveler walks slowly along an ivory dune ridge, trailing cobalt-blue silk from her right hand. Sunrise lights the fabric from the left. Wide rear view, a gentle forward camera move, natural fabric drag and a stable horizon.

Prefer concrete movement over strings of quality adjectives. “One slow ripple passes through the silk” gives the model more useful direction than “epic, amazing, stunning, cinematic.”

## Match the prompt to the inputs

| Workflow | Focus on | Check before submitting |
|---|---|---|
| Text to video | Subject, place, visible action and composition | Describe the opening state; no image is implied |
| Image to video | What changes from the supplied image | Keep wardrobe, props and composition consistent with the opening frame |
| Reference to video | Action plus the role of each selected reference | Confirm image order, reference roles and model limits |
| First / last frame | The progression between the supplied boundaries | Both boundaries must be supported by that exact workflow |

A reference image is not automatically a native first or last frame. Select the correct input role in Splece. Use the editor's reference controls rather than inventing provider-specific tags.

**Image-to-video example**

> Keep the traveler still. Let one slow wave move through the lifted silk, then settle gently. A restrained pullback reveals more of the dunes. Preserve the visible hand connection, wardrobe and sunrise direction.

## Build a sequence

| Shot | Suggested edit length | Direction |
|---|---|---|
| The arrival | 6 seconds | Wide landscape. Two slow steps along the ridge; silk stays low. |
| Catch the light | 5 seconds | Close detail of the hand and fabric. A small ripple catches the sunlight. |
| The lift | 7 seconds | Return wide. The wind holds the silk in an arc as the landscape opens. |

Generate supported take lengths, then trim them in the editor. These are editorial targets, not claims that every provider accepts those durations.

## Refine with control

1. Read the prepared prompt and check the selected references, camera direction and model.
2. If you use **Optimize prompt**, review the new variation before generating. It uses the configured writing connection when Online is on and can cost tokens.
3. Change one thing at a time: action, camera or reference choice. Keep useful takes.
4. Inspect hands, identity, fabric attachment, motion and continuity. A good still frame does not guarantee a good moving shot.
5. Make timing decisions on the timeline. Do not ask a short generation to perform a whole film's worth of cuts.

Splece's compiler preserves authored dialogue and reference bindings; validation cannot guarantee a model follows them perfectly. Long prompts can exceed a model's limit. Shorten optional prose yourself rather than sacrificing essential dialogue or constraints.

## Record an honest demo

Prepare and review video takes before recording the interface. Keep Online off during playback and editing so the recording does not trigger paid inference. Show the result first, then references, an alternative take, the playhead and a small edit. Do not present an Offline sample as a live AI generation.
