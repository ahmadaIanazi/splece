// This catalog is an open starting point, not a type system for projects.
const shot = (title, description) => ({ title, description, duration: 5 });
export const templateCategories = [
  "All",
  "Film",
  "Social",
  "Marketing",
  "Music",
  "Learn",
  "Explore",
];
export const projectTemplates = [
  {
    id: "blue-hour",
    name: "Somewhere after sunset",
    category: "Film",
    format: "movie",
    aspect: "16:9",
    summary:
      "A small story with a sense of place. Establish, discover, linger.",
    concept:
      "An evening journey through a quiet landscape. A distant light draws us forward; a small discovery changes the way we see the place.",
    direction: {
      look: "cinematic",
      lighting: "golden",
      palette: "dusk",
      pacing: "calm",
    },
    groups: ["A world to enter", "A moment to remember"],
    shots: [
      shot(
        "Find the world",
        "A wide view of a quiet landscape at dusk. A distant light glows at the edge of the horizon.",
      ),
      shot(
        "Move closer",
        "A closer view reveals the path leading toward the distant light.",
      ),
      shot(
        "The discovery",
        "A small luminous object rests beside the path. Its light gently changes.",
      ),
      shot(
        "Leave a little mystery",
        "The landscape holds still as the distant light fades into the evening.",
      ),
    ],
  },
  {
    id: "product",
    name: "An object worth noticing",
    category: "Marketing",
    format: "ad",
    aspect: "16:9",
    summary:
      "A product reveal built around shape, detail, and a memorable finish.",
    concept:
      "A minimal product film for a beautifully made object. Reveal its silhouette, explore its material, show one useful detail, and finish with a clean hero view.",
    direction: {
      look: "clean",
      lighting: "studio",
      palette: "earth",
      pacing: "balanced",
    },
    groups: ["Make an impression", "Make it memorable"],
    shots: [
      shot(
        "The reveal",
        "The hero object emerges from shadow on a simple studio surface.",
      ),
      shot(
        "A closer look",
        "Close view of the object’s material and edge detail. Highlights move gently across the surface.",
      ),
      shot(
        "One useful detail",
        "Show the product’s defining feature in a clear, uncluttered composition.",
      ),
      shot(
        "The hero view",
        "The object rests centered in a clean composition, with open space beside it for titles added in the editor.",
      ),
    ],
  },
  {
    id: "daily-story",
    name: "A little everyday magic",
    category: "Social",
    format: "reel",
    aspect: "9:16",
    summary: "An immediate hook, two little moments, and a satisfying payoff.",
    concept:
      "A short visual diary about finding something unexpected in an ordinary day. Use everyday details to build toward one colorful surprise.",
    direction: {
      look: "analog",
      lighting: "window",
      palette: "citrus",
      pacing: "energetic",
    },
    groups: ["Catch the eye", "Deliver the moment"],
    shots: [
      shot(
        "The hook",
        "Close view of an unexpected colorful detail in an otherwise ordinary setting.",
      ),
      shot(
        "Set the scene",
        "A wider view reveals the everyday setting around the detail.",
      ),
      shot(
        "The change",
        "The colorful detail shifts and opens, revealing a small surprise.",
      ),
      shot(
        "The payoff",
        "Hold on the completed reveal in a simple, memorable composition.",
      ),
    ],
  },
  {
    id: "rhythm",
    name: "Color in motion",
    category: "Music",
    format: "music",
    aspect: "16:9",
    summary: "Build a visual rhythm from shapes, light, and repeated motifs.",
    concept:
      "An abstract visual accompaniment with a repeating circle motif. Start quietly, build layers, reach a colorful peak, then return to the opening shape.",
    direction: {
      look: "graphic",
      lighting: "neon",
      palette: "pastel",
      pacing: "energetic",
    },
    groups: ["Find the rhythm", "Build and release"],
    shots: [
      shot(
        "First pulse",
        "A single luminous circle expands gently against a dark field.",
      ),
      shot(
        "Add a layer",
        "Two luminous rings overlap while drifting in opposite directions.",
      ),
      shot(
        "The peak",
        "Several colored rings expand outward, filling the composition with layered motion.",
      ),
      shot(
        "Return home",
        "The layered rings settle back into a single luminous circle.",
      ),
    ],
  },
  {
    id: "field-notes",
    name: "Small world, big story",
    category: "Film",
    format: "documentary",
    aspect: "16:9",
    summary:
      "Observe a place through a wide view, textures, and quiet details.",
    concept:
      "A visual field note about a natural place. Let the landscape and its details tell the story. Any factual narration will be researched and added separately.",
    direction: {
      look: "cinematic",
      lighting: "golden",
      palette: "earth",
      pacing: "calm",
    },
    groups: ["Observe the place", "Notice the details"],
    shots: [
      shot(
        "The habitat",
        "A wide view of rolling hills and a calm body of water.",
      ),
      shot(
        "Natural texture",
        "A close view of grass moving gently in the breeze.",
      ),
      shot(
        "A small detail",
        "Sunlight catches ripples on the water’s surface.",
      ),
      shot(
        "A wider perspective",
        "The hills and water fill a quiet wide composition as the light softens.",
      ),
    ],
  },
  {
    id: "explain",
    name: "One idea, made clear",
    category: "Learn",
    format: "education",
    aspect: "16:9",
    summary: "Introduce an idea, break it down, and make the result tangible.",
    concept:
      "Explain one idea visually using a few simple shapes. Introduce the problem, isolate two parts, show their relationship, then reveal the complete system.",
    direction: {
      look: "graphic",
      lighting: "studio",
      palette: "pastel",
      pacing: "balanced",
    },
    groups: ["Introduce the idea", "Make it click"],
    shots: [
      shot(
        "The question",
        "Three simple geometric pieces sit apart on a clean background.",
      ),
      shot(
        "Break it down",
        "One piece is isolated and rotates slowly to reveal its form.",
      ),
      shot(
        "Show the connection",
        "The pieces move toward each other, showing how their edges align.",
      ),
      shot(
        "The takeaway",
        "The pieces form one coherent arrangement and hold still.",
      ),
    ],
  },
  {
    id: "conversation",
    name: "Room for a conversation",
    category: "Learn",
    format: "podcast",
    aspect: "16:9",
    summary:
      "An opening, two perspectives, and a closing beat for an interview.",
    concept:
      "A calm visual package for an interview or podcast. Establish a welcoming room, show the two speaking positions, and finish on a shared wide view. Add your speakers and exact dialogue later.",
    direction: {
      look: "clean",
      lighting: "window",
      palette: "earth",
      pacing: "balanced",
    },
    groups: ["Welcome in", "Give each voice space"],
    shots: [
      shot(
        "The room",
        "A welcoming room with two empty chairs facing each other and a small table between them.",
      ),
      shot(
        "First perspective",
        "A medium view of the first empty chair and the microphone beside it.",
      ),
      shot(
        "Second perspective",
        "A matching medium view of the second empty chair and its microphone.",
      ),
      shot(
        "The shared view",
        "A balanced wide view holds both chairs in the frame.",
      ),
    ],
  },
  {
    id: "playground",
    name: "What if gravity took a day off?",
    category: "Explore",
    format: "blank",
    aspect: "1:1",
    summary: "A playful experiment. Float, transform, and loop back around.",
    concept:
      "A playful motion study where simple objects forget gravity. A sphere lifts, companions join, the arrangement changes, and everything returns to its starting position.",
    direction: {
      look: "graphic",
      lighting: "studio",
      palette: "citrus",
      pacing: "balanced",
    },
    groups: ["Break a rule", "Play with the result"],
    shots: [
      shot(
        "Lift off",
        "A sphere slowly lifts away from a flat surface. Its shadow stays beneath it.",
      ),
      shot(
        "Company arrives",
        "Two smaller spheres float into view beside the first sphere.",
      ),
      shot(
        "A new arrangement",
        "The three spheres orbit a shared center in a smooth, playful movement.",
      ),
      shot(
        "Back to the beginning",
        "The smaller spheres drift away and the first sphere settles onto the surface.",
      ),
    ],
  },
].map((t) => ({
  ...t,
  version: 1,
  duration: t.shots.reduce((n, s) => n + s.duration, 0),
  poster: `/templates/${t.id}.jpg`,
  preview: `/templates/${t.id}.mp4`,
}));
export const findProjectTemplate = (id) =>
  projectTemplates.find((t) => t.id === id);
