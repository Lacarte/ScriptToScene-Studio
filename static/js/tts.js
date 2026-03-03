/* ================================================================
   ScriptToScene Studio — TTS Module (Kokoro TTS)
   ================================================================ */

// ---- State ----
const _ttsState = {
  modelReady: false,
  voices: [],
  selectedVoice: localStorage.getItem('sts-tts-voice') || 'af_heart',
  selectedLang: localStorage.getItem('sts-tts-lang') || 'top-picks',
  blendMode: localStorage.getItem('sts-tts-blend') === 'true',
  blendVoiceA: localStorage.getItem('sts-tts-blendA') || 'af_heart',
  blendVoiceB: localStorage.getItem('sts-tts-blendB') || 'am_adam',
  blendRatio: parseInt(localStorage.getItem('sts-tts-blendRatio') || '50'),
  blendMethod: localStorage.getItem('sts-tts-blendMethod') || 'slerp',
  blendPickerTarget: null,
  blendPickerLang: 'en-us',
  genMode: localStorage.getItem('sts-tts-genMode') || 'generate',
  isGenerating: false,
  currentJobId: null,
  chunkEventSource: null,
  downloadEventSource: null,
  streamAbortController: null,
  streamAudioCtx: null,
  history: [],
  nowPlaying: null,
};

const LANG_NAMES = {
  'en-us': 'American English', 'en-gb': 'British English', 'ja': 'Japanese',
  'zh': 'Chinese', 'es': 'Spanish', 'fr': 'French', 'hi': 'Hindi',
  'it': 'Italian', 'pt-br': 'Portuguese'
};

const LANG_SHORT = {
  'en-us': 'English US', 'en-gb': 'English UK', 'ja': 'Japanese',
  'zh': 'Chinese', 'es': 'Spanish', 'fr': 'French', 'hi': 'Hindi',
  'it': 'Italian', 'pt-br': 'Portuguese'
};

const LANG_SHORT_COMPACT = {
  'en-us': 'US', 'en-gb': 'UK', 'ja': 'JA', 'zh': 'ZH', 'es': 'ES',
  'fr': 'FR', 'hi': 'HI', 'it': 'IT', 'pt-br': 'PT'
};

const LANG_ORDER = ['en-us', 'en-gb', 'ja', 'zh', 'es', 'fr', 'hi', 'it', 'pt-br'];

const VOICE_META = {
  // American Female — coral/pink
  af_alloy:   { g: 'f', hue: '#FF9B9B', lang: 'en-us', name: 'Alloy',   desc: 'Neutral, versatile' },
  af_aoede:   { g: 'f', hue: '#FFB5B5', lang: 'en-us', name: 'Aoede',   desc: 'Soft, melodic' },
  af_bella:   { g: 'f', hue: '#FF8A8A', lang: 'en-us', name: 'Bella',   desc: 'Energetic, engaging' },
  af_heart:   { g: 'f', hue: '#FF7070', lang: 'en-us', name: 'Heart',   desc: 'Warm, friendly, natural' },
  af_jessica: { g: 'f', hue: '#FFA5A5', lang: 'en-us', name: 'Jessica', desc: 'Bright, conversational' },
  af_kore:    { g: 'f', hue: '#FFCECE', lang: 'en-us', name: 'Kore',    desc: 'Gentle, soothing' },
  af_nicole:  { g: 'f', hue: '#FF8080', lang: 'en-us', name: 'Nicole',  desc: 'Clear, professional' },
  af_nova:    { g: 'f', hue: '#FFD0D0', lang: 'en-us', name: 'Nova',    desc: 'Bright, modern' },
  af_river:   { g: 'f', hue: '#FFB0B0', lang: 'en-us', name: 'River',   desc: 'Calm, flowing' },
  af_sarah:   { g: 'f', hue: '#FF9595', lang: 'en-us', name: 'Sarah',   desc: 'Smooth, balanced' },
  af_sky:     { g: 'f', hue: '#FFBABA', lang: 'en-us', name: 'Sky',     desc: 'Light, airy' },
  // American Male — teal
  am_adam:    { g: 'm', hue: '#6FE3DA', lang: 'en-us', name: 'Adam',    desc: 'Warm, approachable' },
  am_echo:    { g: 'm', hue: '#5ED5CC', lang: 'en-us', name: 'Echo',    desc: 'Resonant, clear' },
  am_eric:    { g: 'm', hue: '#7EEFEA', lang: 'en-us', name: 'Eric',    desc: 'Confident, steady' },
  am_fenrir:  { g: 'm', hue: '#4ECDC4', lang: 'en-us', name: 'Fenrir',  desc: 'Bold, dynamic' },
  am_liam:    { g: 'm', hue: '#6DE0D8', lang: 'en-us', name: 'Liam',    desc: 'Friendly, casual' },
  am_michael: { g: 'm', hue: '#8AF0E8', lang: 'en-us', name: 'Michael', desc: 'Deep, authoritative' },
  am_onyx:    { g: 'm', hue: '#5CD8D0', lang: 'en-us', name: 'Onyx',    desc: 'Rich, powerful' },
  am_puck:    { g: 'm', hue: '#7AE8E0', lang: 'en-us', name: 'Puck',    desc: 'Playful, expressive' },
  // British Female — purple/lavender
  bf_alice:    { g: 'f', hue: '#C4B5FD', lang: 'en-gb', name: 'Alice',    desc: 'Refined, poised' },
  bf_emma:     { g: 'f', hue: '#D4C5FF', lang: 'en-gb', name: 'Emma',     desc: 'Elegant, articulate' },
  bf_isabella: { g: 'f', hue: '#B4A5ED', lang: 'en-gb', name: 'Isabella', desc: 'Graceful, warm' },
  bf_lily:     { g: 'f', hue: '#E4D5FF', lang: 'en-gb', name: 'Lily',     desc: 'Soft, gentle' },
  // British Male — steel blue
  bm_daniel: { g: 'm', hue: '#7B90A9', lang: 'en-gb', name: 'Daniel', desc: 'Composed, clear' },
  bm_fable:  { g: 'm', hue: '#8BA0B9', lang: 'en-gb', name: 'Fable',  desc: 'Storytelling, warm' },
  bm_george: { g: 'm', hue: '#6B80A0', lang: 'en-gb', name: 'George', desc: 'Classic narrator' },
  bm_lewis:  { g: 'm', hue: '#9BB0C9', lang: 'en-gb', name: 'Lewis',  desc: 'Thoughtful, measured' },
  // Japanese — sakura pink / muted blue
  jf_alpha:      { g: 'f', hue: '#FFB7C5', lang: 'ja', name: 'Alpha',      desc: 'Clear, natural' },
  jf_gongitsune: { g: 'f', hue: '#FFC7D5', lang: 'ja', name: 'Gongitsune', desc: 'Gentle, expressive' },
  jf_nezumi:     { g: 'f', hue: '#FFD7E5', lang: 'ja', name: 'Nezumi',     desc: 'Soft, delicate' },
  jf_tebukuro:   { g: 'f', hue: '#FFA7B5', lang: 'ja', name: 'Tebukuro',   desc: 'Warm, friendly' },
  jm_kumo:       { g: 'm', hue: '#A0B4C8', lang: 'ja', name: 'Kumo',       desc: 'Calm, steady' },
  // Chinese — gold
  zf_xiaobei:  { g: 'f', hue: '#FFD700', lang: 'zh', name: 'Xiaobei',  desc: 'Bright, cheerful' },
  zf_xiaoni:   { g: 'f', hue: '#FFE740', lang: 'zh', name: 'Xiaoni',   desc: 'Warm, gentle' },
  zf_xiaoxuan: { g: 'f', hue: '#FFC800', lang: 'zh', name: 'Xiaoxuan', desc: 'Clear, professional' },
  zf_xiaoyi:   { g: 'f', hue: '#FFF060', lang: 'zh', name: 'Xiaoyi',   desc: 'Soft, soothing' },
  zm_yunjian:  { g: 'm', hue: '#E8B800', lang: 'zh', name: 'Yunjian',  desc: 'Strong, commanding' },
  zm_yunxi:    { g: 'm', hue: '#D8A800', lang: 'zh', name: 'Yunxi',    desc: 'Warm, rich' },
  zm_yunxia:   { g: 'm', hue: '#C89800', lang: 'zh', name: 'Yunxia',   desc: 'Smooth, mellow' },
  zm_yunyang:  { g: 'm', hue: '#F0C000', lang: 'zh', name: 'Yunyang',  desc: 'Energetic, bright' },
  // Spanish — warm orange
  ef_dora:  { g: 'f', hue: '#FFB074', lang: 'es', name: 'Dora',  desc: 'Warm, expressive' },
  em_alex:  { g: 'm', hue: '#FFA060', lang: 'es', name: 'Alex',  desc: 'Clear, confident' },
  em_santa: { g: 'm', hue: '#FF9050', lang: 'es', name: 'Santa', desc: 'Rich, resonant' },
  // French — soft mauve
  ff_siwis: { g: 'f', hue: '#D4A0D0', lang: 'fr', name: 'Siwis', desc: 'Elegant, smooth' },
  // Hindi — saffron
  hf_alpha: { g: 'f', hue: '#FFB347', lang: 'hi', name: 'Alpha', desc: 'Clear, natural' },
  hf_beta:  { g: 'f', hue: '#FFC370', lang: 'hi', name: 'Beta',  desc: 'Warm, gentle' },
  hm_omega: { g: 'm', hue: '#E0A030', lang: 'hi', name: 'Omega', desc: 'Deep, steady' },
  hm_psi:   { g: 'm', hue: '#D09020', lang: 'hi', name: 'Psi',   desc: 'Rich, expressive' },
  // Italian — warm green
  if_sara:   { g: 'f', hue: '#90D890', lang: 'it', name: 'Sara',   desc: 'Warm, melodic' },
  im_nicola: { g: 'm', hue: '#70C870', lang: 'it', name: 'Nicola', desc: 'Clear, engaging' },
  // Portuguese — ocean blue
  pf_dora:  { g: 'f', hue: '#70B0E0', lang: 'pt-br', name: 'Dora',  desc: 'Bright, friendly' },
  pm_alex:  { g: 'm', hue: '#60A0D0', lang: 'pt-br', name: 'Alex',  desc: 'Warm, clear' },
  pm_santa: { g: 'm', hue: '#5090C0', lang: 'pt-br', name: 'Santa', desc: 'Deep, resonant' },
};

const TOP_PICKS = [
  { voice: 'af_heart',   badge: '#1 Narration',  bestFor: 'Audiobooks, narration, general purpose' },
  { voice: 'af_bella',   badge: 'Dynamic',       bestFor: 'Dynamic narration, marketing' },
  { voice: 'af_nicole',  badge: 'Professional',  bestFor: 'Non-fiction, tutorials, professional' },
  { voice: 'af_sarah',   badge: 'Versatile',     bestFor: 'General audiobooks, balanced delivery' },
  { voice: 'am_adam',    badge: 'Male Lead',     bestFor: 'Male narration, approachable tone' },
  { voice: 'am_michael', badge: 'Authoritative', bestFor: 'Deep narration, documentary' },
  { voice: 'bf_emma',    badge: 'British',       bestFor: 'British female, elegant narration' },
  { voice: 'bm_george',  badge: 'Classic',       bestFor: 'British male, classic narrator' },
];

const BLEND_PRESETS = [
  { name: 'Narrator',    a: 'af_heart',  b: 'am_michael', ratio: 35, desc: 'Warm + authoritative' },
  { name: 'Podcast',     a: 'af_bella',  b: 'am_adam',    ratio: 50, desc: 'Energetic duo' },
  { name: 'Storyteller', a: 'bf_emma',   b: 'bm_fable',   ratio: 40, desc: 'British elegance' },
  { name: 'Newscast',    a: 'af_nicole', b: 'am_eric',    ratio: 30, desc: 'Clear + confident' },
  { name: 'Gentle',      a: 'af_kore',   b: 'af_river',   ratio: 50, desc: 'Soothing blend' },
  { name: 'Bold',        a: 'am_fenrir', b: 'am_onyx',    ratio: 50, desc: 'Dynamic power' },
  { name: 'Velvet',      a: 'af_bella',  b: 'am_adam',    ratio: 80, desc: 'Bella-forward warmth' },
];

const RANDOM_STORIES = [
  `The old lighthouse keeper climbed the spiral staircase one final time. Seventy-three steps \u2014 he'd counted them every night for forty years. Tonight the light would go automatic, and the sea would lose its last human guardian. He pressed his palm against the cold glass and watched the beam sweep across black water. Somewhere out there, a fishing boat adjusted course. They'd never know it was his last turn of the lens.`,
  `She found the letter tucked inside a library book, dated nineteen fifty-two. "If you're reading this," it began, "then the maples outside must be enormous by now." She glanced out the window. The maples were enormous. She kept reading. "I buried something beneath the tallest one. Something that mattered to me once. I hope it matters to you too." She closed the book, grabbed her coat, and walked outside with a borrowed shovel.`,
  `The robot had been designed to sort mail, but somewhere between firmware update seven and firmware update eight, it developed a fondness for poetry. It would pause at each envelope, scanning the handwritten addresses with what its engineers could only describe as admiration. "Beautiful ligatures," it murmured one Tuesday, holding a birthday card up to the fluorescent light. The engineers exchanged nervous glances.`,
  `Rain hammered the tin roof of the roadside diner. A truck driver sat at the counter, stirring coffee he'd never drink. Across from him, a woman in a red coat studied a road atlas, tracing routes with her fingertip. Neither spoke. The waitress refilled his cup anyway. Outside, lightning split the sky and for one bright instant, every puddle in the parking lot turned to silver. The woman folded her map and smiled.`,
  `The astronaut floated by the observation window, watching Earth turn below. Continents drifted past like slow clouds. She pressed record on her personal log. "Day two hundred and fourteen. I can see a hurricane forming over the Atlantic. From up here it looks like a pinwheel. Beautiful and terrible. I think about my daughter learning to ride her bike in the backyard. I wonder if she looks up at the stars and knows which one is me."`,
  `The violin had been silent for twenty years, sealed in its velvet-lined case in the attic. When the old man's granddaughter found it, she lifted the bow and drew it across the strings. The sound was thin and ghostly at first, but the wood remembered. By the third note, the kitchen below fell quiet. By the seventh, her grandfather had risen from his chair, tears tracking down weathered cheeks. The violin remembered everything.`,
  `The detective stared at the chessboard. The suspect sat across from him, calm as still water. "You left one clue," the detective said, moving a pawn. "Just one. But it was enough." The suspect tilted his head. "Enlighten me." The detective placed a photograph on the table \u2014 a reflection in a window, barely visible, showing a figure in a doorway. "You forgot about the glass." The suspect's smile faded by exactly one degree.`,
  `The last bookshop on Elm Street had a cat named Tolstoy and a policy of lending books on the honor system. No cards, no due dates. Just a handwritten note on the door: "Take what you need. Return when you're ready." Most people returned their books. Some left new ones. By December, the shelves held twice as many titles as they had in spring. The owner didn't question it. She just made more tea and added another shelf.`,
  `The ship's captain spoke into the radio one final time. "This is the Aurora, signing off after thirty years of service. She's carried cargo to fourteen countries, weathered nine storms, and never once let her crew down." He paused, running his hand along the bridge console. "They'll scrap her hull and melt her steel. But steel doesn't forget the shape of a ship. Somewhere in a bridge or a building, she'll keep standing."`,
  `The garden had been abandoned for decades, but it refused to die. Roses climbed the iron gate, their thorns locking it shut. Ivy covered the stone walls like a second skin. And at the center, where a fountain had once stood, a single apple tree grew crooked and wild, its branches heavy with fruit that no one picked. Birds came and went. Seasons turned. The garden kept its own time, answering to no one.`,
  `The pianist's hands trembled above the keys. The concert hall held two thousand people, and every one of them was silent. She closed her eyes and thought of her teacher \u2014 a quiet woman who smelled of lavender and never raised her voice. "Don't play for them," the teacher had said. "Play for the version of yourself who needed music most." Her fingers found the first chord. The trembling stopped. The music began.`,
  `The deep-sea diver descended past the point where sunlight surrenders. Her headlamp cut a lonely cone through absolute darkness. At three hundred meters, something glinted. Not metal \u2014 something organic, pulsing with its own pale blue luminescence. A jellyfish the size of a cathedral ceiling drifted past, trailing tendrils like curtains of light. She hung motionless in the water, breathing slowly, watching a creature that had never seen a human and never would again.`,

  // --- Serious Facts ---
  `Your body replaces roughly three hundred thirty billion cells every single day. That means the person reading this sentence is not physically the same person who started reading it a year ago. Every atom in your skeleton is swapped out within ten years. You are not a thing. You are an event \u2014 a pattern that matter passes through, like water through a whirlpool. The shape stays. The substance never does.`,
  `There is a room in Minnesota called the anechoic chamber at Orfield Laboratories that is so quiet, the longest anyone has endured it in darkness is forty-five minutes. In total silence, you begin to hear your own heartbeat, then your lungs, then the blood rushing through your veins. Eventually your brain, desperate for input, begins to hallucinate sound. Silence, it turns out, is something the human mind was never designed to experience.`,
  `Octopuses have three hearts, blue blood, and a brain that wraps around their esophagus. Two-thirds of their neurons live in their arms, meaning each arm can taste, touch, and make decisions independently. If you cut off an octopus arm, it will continue to grab food and try to bring it to a mouth that is no longer there. Scientists still argue over whether this counts as consciousness.`,
  `The human brain consumes twenty watts of power \u2014 less than a dim light bulb \u2014 yet it runs a simulation of reality so detailed you forget it's a simulation. Everything you see, hear, and touch is a reconstruction. Your brain is locked in a dark, silent skull, and it builds the entire world from electrical signals. Color doesn't exist outside your mind. Neither does sound. You are living inside a model, and you have never once stepped outside it.`,
  `There are more possible configurations of a chess game than atoms in the observable universe. The number is called the Shannon number \u2014 roughly ten to the power of one hundred twenty. It means that every game of chess ever played, across all of human history, represents a vanishingly small fraction of what the board can produce. Most possible chess games have never been played and never will be.`,
  `Neutron stars are so dense that a teaspoon of their material weighs roughly six billion tons \u2014 about the same as every car on Earth compressed into a sugar cube. They spin up to seven hundred times per second, emit beams of radiation from their magnetic poles, and warp spacetime around them so severely that the back of the star is visible from the front. They are the corpses of dead suns, and they are stranger than fiction.`,
  `In nineteen eighty-three, a Soviet officer named Stanislav Petrov received an alert that five American nuclear missiles were heading toward Russia. Protocol demanded he report it immediately, which would have triggered a full retaliatory launch. Instead, he hesitated. He reasoned that a real first strike would involve hundreds of missiles, not five. He reported a system malfunction. He was right. A satellite had misread sunlight reflecting off clouds. One man's hesitation may have prevented the end of civilization.`,

  // --- Jaw-Dropping Viral Stories ---
  `In two thousand twelve, a man named Harrison Okene survived for three days trapped at the bottom of the Atlantic Ocean. His tugboat had capsized in a storm off the coast of Nigeria, sinking to a depth of thirty meters. Harrison found an air pocket in the bathroom \u2014 four feet of breathable space above dark, freezing water. He crouched in pitch blackness for sixty hours, listening to sea creatures around him, until a rescue diver's hand touched his in the dark. The diver screamed. No one expected to find anyone alive.`,
  `A woman named Juliane Koepcke fell two miles out of the sky after her plane was struck by lightning over the Peruvian Amazon in nineteen seventy-one. She was seventeen years old, still strapped to her seat. She survived the fall, woke up alone in the jungle with a broken collarbone and a torn ligament, and walked for eleven days through the rainforest following a stream. She passed crocodiles and insects burrowing into her wounds before finding a logging camp. She was the sole survivor of ninety-two passengers.`,
  `In nineteen sixty-six, a fishing boat off the coast of Iceland sank in freezing water. All crew members died of hypothermia within minutes \u2014 except one. A man named Gulli treaded water at two degrees Celsius for six hours, then walked barefoot across jagged lava rock for three more hours to reach a farm. Scientists later studied his body and discovered his fat composition was structurally similar to seal blubber. His survival rewrote what we knew about human cold tolerance.`,
  `There is a man in India named Dashrath Manjhi who spent twenty-two years carving a road through a mountain \u2014 alone, using only a hammer and chisel. His wife had died because the nearest hospital was on the other side of the mountain, seventy kilometers by road. He started cutting in nineteen sixty and finished in nineteen eighty-two. The path he carved reduced the distance to one kilometer. The government paved it after his death and named it after him.`,
  `In two thousand ten, thirty-three Chilean miners were trapped seven hundred meters underground after a tunnel collapse. They survived for sixty-nine days in a shelter the size of a small apartment. For the first seventeen days, no one on the surface knew if they were alive. They rationed two spoonfuls of tuna per man per day. When a drill finally broke through, the miners attached a note: "We are fine in the shelter, the thirty-three of us." The rescue operation was watched by over a billion people worldwide.`,

  // --- Biblical Events ---
  `The walls of Jericho did not fall to siege engines or battering rams. The Israelites marched around the city once a day for six days, carrying the Ark of the Covenant, with seven priests blowing rams' horns. On the seventh day, they circled the city seven times. Then the priests blew the horns, the people shouted with a single voice, and the walls collapsed outward \u2014 not inward, as they would in a natural earthquake. Archaeologists confirmed the walls fell outward. The city was never rebuilt on that site.`,
  `King Nebuchadnezzar of Babylon had a dream that no one could interpret \u2014 a statue made of gold, silver, bronze, iron, and clay, struck by a stone that became a mountain. Daniel, a Jewish captive, told the king the dream before the king described it, then explained it: each metal was a future empire. Gold was Babylon. Silver was Persia. Bronze was Greece. Iron was Rome. The stone was a kingdom that would never be destroyed. Every empire Daniel named rose and fell in exactly that order.`,
  `During the Exodus, the nation of Israel wandered the Sinai desert for forty years. Every morning, a substance called manna appeared on the ground \u2014 white, like coriander seed, tasting like honey wafers. It could not be stored overnight or it would rot, except on the sixth day, when a double portion was gathered and it miraculously preserved through the Sabbath. For forty years, roughly two million people were fed daily by food that appeared from nowhere and vanished by noon.`,
  `The prophet Elijah challenged four hundred fifty prophets of Baal on Mount Carmel. Both sides prepared a sacrifice but lit no fire. The prophets of Baal called on their god from morning until evening \u2014 shouting, dancing, cutting themselves. Nothing happened. Then Elijah soaked his altar with water three times until the trench around it was full. He prayed once. Fire fell from the sky and consumed the sacrifice, the wood, the stones, the dust, and the water in the trench. The people fell on their faces.`,
  `Moses raised his staff over the Red Sea, and a strong east wind blew all night, splitting the water and drying the seabed. The Israelites crossed on dry ground with walls of water on either side. When the Egyptian army followed at dawn, the waters returned and swallowed them entirely \u2014 chariots, horses, and soldiers. Researchers later found that a sustained sixty-three mile-per-hour east wind could push back six feet of water at the proposed crossing site near the Gulf of Suez.`,

  // --- Psychology Tricks & Ideas ---
  `There is a cognitive bias called the doorway effect. When you walk from one room into another, your brain purges short-term memory to make room for new information about the new environment. That's why you forget why you entered a room. Your brain literally decided the old room's context was no longer relevant. The fix is surprisingly simple \u2014 say what you need out loud before you cross the threshold. Your auditory memory will carry it through the door your visual memory won't.`,
  `The Benjamin Franklin effect is one of the strangest findings in social psychology. If you want someone to like you, don't do them a favor \u2014 ask them to do one for you. Franklin discovered that a rival legislator who lent him a rare book became one of his closest allies. The human brain resolves the dissonance of helping someone it doesn't like by deciding it must actually like them. You can turn an enemy into a friend simply by asking to borrow a pen.`,
  `Mirroring is the most powerful rapport-building technique ever studied. When you subtly copy someone's posture, gestures, or speech patterns, their brain registers you as part of their in-group. Waitresses who repeat orders back word-for-word receive seventy percent higher tips than those who paraphrase. Negotiators who mirror the other party's last three words extract thirty-six percent more value from deals. The person being mirrored almost never notices \u2014 but their trust increases dramatically.`,
  `The Zeigarnik effect explains why unfinished tasks haunt you. Your brain treats incomplete work like an open browser tab \u2014 it keeps running in the background, consuming mental energy, until it's closed. That's why a cliffhanger keeps you watching, why a half-written email nags you at dinner, and why making a plan to finish something gives you almost the same relief as actually finishing it. Writing a to-do list before bed reduces sleep onset time by fifty percent because it closes the tabs.`,
  `Anchoring is the reason you'll pay more for a watch placed next to a ten-thousand-dollar watch than the same watch placed next to a fifty-dollar one. The first number you encounter becomes your mental anchor, and every judgment after it is an adjustment from that anchor \u2014 never from zero. Restaurants put a ninety-dollar steak on the menu not because anyone orders it, but because it makes the forty-dollar steak feel reasonable. The anchor is invisible. The effect is not.`,
  `The spotlight effect means you think people notice you far more than they do. In one study, students forced to wear an embarrassing T-shirt estimated that fifty percent of people in the room noticed. The actual number was twenty-three percent. You remember your own stumble in a presentation for years. Your audience forgot it before lunch. Humans are the protagonists of their own movie and background extras in everyone else's. Nobody is watching you as carefully as you think.`,
  `Learned helplessness is what happens when you stop trying \u2014 not because you can't succeed, but because you've been trained to believe you can't. In the original experiment, dogs who received inescapable shocks eventually stopped trying to avoid them, even when the door was wide open. Humans do the same thing. After enough failure, the brain stops encoding escape routes. The cruelest part is that the cage doesn't need to be locked anymore. The belief that it's locked is enough.`,

  // --- Dark Psychology ---
  `Gaslighting works not by telling a single big lie, but by introducing thousands of tiny ones. The abuser questions your memory of conversations that happened yesterday, moves objects and denies touching them, tells you events didn't happen the way you remember. Over months, the victim's trust in their own perception erodes completely. The final stage is dependency \u2014 when you can no longer tell what's real, the only person you can ask is the person who broke your reality in the first place.`,
  `The dark triad \u2014 narcissism, Machiavellianism, and psychopathy \u2014 appears in roughly one out of every one hundred people. But in CEO positions, that number jumps to one in five. The traits that make someone dangerous in personal relationships \u2014 superficial charm, emotional detachment, willingness to manipulate \u2014 are the same traits that accelerate corporate success. The system doesn't accidentally promote dark personalities. It selects for them.`,
  `Love bombing is the first phase of narcissistic abuse, and it feels indistinguishable from genuine love. The abuser floods you with affection, attention, compliments, and future plans. They text constantly, remember every detail, make you feel like the center of the universe. This isn't generosity \u2014 it's investment. They are building emotional debt. Once you are bonded, the withdrawal begins. The contrast between the love bombing phase and the devaluation phase is what creates the trauma bond. You spend the rest of the relationship chasing the ghost of the first three months.`,
  `The foot-in-the-door technique is how cults recruit. They don't start with bizarre demands. They start with something small and reasonable \u2014 sign a petition, attend a free dinner, fill out a survey. Each small yes shifts your self-image slightly. "I'm the kind of person who supports this cause." Once your identity has shifted, larger requests feel consistent rather than extreme. By the time someone asks you to cut off your family or donate your savings, it doesn't feel like a leap. It feels like the next logical step.`,
  `Intermittent reinforcement is the most addictive reward pattern in psychology and the engine behind both slot machines and toxic relationships. When a reward is unpredictable \u2014 sometimes affection, sometimes coldness, sometimes cruelty, sometimes passion \u2014 the brain becomes obsessed with predicting the next reward. Consistent kindness creates comfort. Consistent cruelty creates avoidance. But random alternation between the two creates obsession. The victim doesn't stay because the relationship is good. They stay because their brain is solving a puzzle it will never complete.`,
  `There is a manipulation technique called triangulation where a person controls you by introducing a third party \u2014 real or invented \u2014 into the dynamic. "My ex used to do this for me." "My coworker thinks I should leave you." "Everyone agrees with me." The purpose is never the third person. The purpose is to create insecurity, competition, and the desperate need to prove yourself. The target works harder to please someone who has made them feel replaceable.`,

  // --- Curiosity & Mind-Bending ---
  `You are made of dead stars. Every atom in your body heavier than hydrogen was forged inside a star that exploded billions of years ago. The calcium in your bones came from a supernova. The iron in your blood was fused in a dying giant's core. You are not merely in the universe \u2014 you are the universe examining itself. Carl Sagan was not being poetic when he said we are star stuff. He was being literal.`,
  `There is a species of jellyfish called Turritopsis dohrnii that is biologically immortal. When it is injured, starving, or aging, it reverts its cells back to their youngest form and begins its life cycle again \u2014 like a butterfly turning back into a caterpillar. It has been doing this for at least five hundred million years. It has no brain. It has no heart. And it cannot die of old age. It is the only known animal that has genuinely solved death.`,
  `The observable universe contains roughly two trillion galaxies. Each galaxy contains roughly one hundred billion stars. Most stars have planets. The math suggests there are more planets in the universe than grains of sand on every beach on Earth combined. And yet, in all of that space, across all of those worlds, we have found exactly one that we know harbors life \u2014 this one. Either we are cosmically rare, or something out there is very, very quiet.`,
  `Every time you remember something, your brain doesn't play back a recording. It reconstructs the memory from scratch, like rewriting a story from notes. And each reconstruction subtly changes the memory. The act of remembering is the act of editing. Your most vivid, most certain childhood memory has been rewritten hundreds of times. The version you carry today is a copy of a copy of a copy. You do not remember events. You remember the last time you remembered them.`,
  `Bananas are radioactive. They contain potassium-40, a naturally occurring isotope that emits beta radiation. You would need to eat roughly ten million bananas in a single sitting to receive a lethal dose. But the fascinating part is that your body already contains potassium-40 \u2014 about one hundred forty grams of potassium total, of which a tiny fraction is radioactive. You are, right now, emitting radiation. You are a low-grade nuclear event, and you have been your entire life.`,
  `If you shuffle a standard deck of fifty-two cards properly, the order you produce has almost certainly never existed before in the history of the universe \u2014 and will never exist again. The number of possible arrangements is fifty-two factorial, which is roughly eight times ten to the sixty-seventh power. That number is so large that if every person on Earth shuffled a deck once per second since the Big Bang, you'd still have explored less than a trillionth of a trillionth of a percent of all possible orders.`,
  `There is a phenomenon called quantum entanglement where two particles can be connected in such a way that measuring one instantly determines the state of the other \u2014 regardless of distance. Einstein called it "spooky action at a distance" because it seemed to violate the speed of light. It doesn't transmit information faster than light, but it does mean that two particles separated by billions of light-years share a connection that transcends space. The universe, at its deepest level, is not local.`,
  `Your gut contains roughly one hundred trillion bacteria \u2014 more microbial cells than human cells in your body. These bacteria produce ninety percent of your body's serotonin, directly influence your mood, your cravings, and your decision-making. Studies have shown that transplanting gut bacteria from anxious mice into calm mice makes the calm mice anxious. You are not a single organism. You are an ecosystem. And the bacteria outvote you.`,
  `Cleopatra lived closer in time to the moon landing than to the construction of the Great Pyramid of Giza. The pyramids were built around twenty-five hundred BC. Cleopatra lived around thirty BC. The moon landing was nineteen sixty-nine AD. That means roughly two thousand five hundred years separated Cleopatra from the pyramids, but only two thousand years separate her from Apollo eleven. The ancient world is far more ancient than most people realize.`,
  `Trees in a forest communicate through an underground network of fungal threads called the mycorrhizal network \u2014 nicknamed the "Wood Wide Web." Mother trees send carbon and nutrients to their seedlings through these fungal highways. Dying trees dump their resources into the network for other trees to absorb. Trees can even send chemical warning signals to neighboring trees when insects attack. The forest is not a collection of individuals. It is a single, slow-moving conversation.`,

  // --- Once Upon a Time (Kids) ---
  `Once upon a time, in a village at the edge of a whispering forest, there lived a tiny mouse named Pip who wanted to fly. Every morning he climbed the tallest sunflower in the garden and leaped off, flapping his little paws as hard as he could. Every morning he tumbled into the soft grass below. The birds laughed. The squirrels shook their heads. But one autumn evening, a lost baby owl fell from its nest, and Pip was the only one small enough to climb the thorny bramble to carry it back. "You can't fly," said the mother owl, "but you can climb higher than anyone." Pip never jumped off a sunflower again. He didn't need to.`,
  `Once upon a time, there was a cloud named Nimbus who was afraid of thunder. Every time a storm rolled in, Nimbus would drift to the edge of the sky and hide behind the mountains. The other clouds rumbled and flashed and poured rain on the thirsty fields below, but Nimbus just shivered. One summer, the longest drought anyone could remember dried up the rivers and cracked the earth. The other clouds had used up all their rain. Only Nimbus, who had been hiding and saving every drop, had enough water left. He floated over the driest village, closed his eyes, and let go. It rained for three gentle hours. The flowers came back the next morning.`,
  `Once upon a time, a little star at the far edge of the Milky Way noticed that she was dimmer than all the others. The big stars blazed white and blue. The medium stars glowed warm and golden. But this little star barely flickered, like a candle in the wind. She asked the moon, "What good is a tiny light?" The moon smiled. "Do you see that small planet, third from that yellow sun? There's a child there who is afraid of the dark. Every night she looks out her window and finds the smallest star she can, and she whispers goodnight to it. That star is you." The little star never felt dim again.`,
  `Once upon a time, deep beneath the ocean, there lived a hermit crab named Coral who had outgrown her shell. Every shell she tried was too big, too heavy, or too scratchy. She wandered the seafloor, feeling naked and afraid, while the other crabs clicked their claws and told her to just pick one already. Then she found something strange \u2014 a small glass bottle, smooth and clear, half-buried in the sand. She climbed inside. For the first time, the other fish could see her. "You're beautiful," said a passing seahorse. Coral had spent her whole life hiding inside shells. She never realized that being seen was the bravest thing of all.`,
  `Once upon a time, in a kingdom made entirely of paper, there lived a little origami crane who could not fly. All the other paper animals \u2014 the butterflies, the eagles, the dragons \u2014 caught the wind and soared above the paper rooftops. But the crane's wings were folded too tight. One day, a terrible rain came. Water poured through the paper sky, and every flying creature was soaked and crumpled. But the little crane, whose wings were folded so tightly they were waterproof, walked through the storm carrying the paper king on her back to dry land. "You were never broken," the king told her. "You were built for this."`,
  `Once upon a time, there was a boy who planted a seed and nothing grew. He watered it every day for a week. Nothing. Two weeks. Nothing. A month. His friends laughed and said it was a dud. But the boy kept watering. After three months, the tiniest green sprout appeared. After a year, it was a sapling. After ten years, it was the tallest tree in the village, and families came from everywhere to sit in its shade and eat picnics beneath its branches. An old woman asked the boy, now a young man, what his secret was. He said, "I just didn't stop on the day before it was going to work."`,
  `Once upon a time, a little fox found a mirror in the forest. She had never seen one before. She looked into it and saw another fox staring back \u2014 with the same orange fur, the same black nose, the same bright eyes. "Who are you?" she asked. The fox in the mirror said nothing. She tried to play with it, share food with it, scare it away. Nothing worked. She sat down, exhausted, and started to cry. Then she noticed something. The fox in the mirror was crying too. "Oh," she whispered. "You're me." She wiped her tears, and the other fox wiped hers. She smiled, and the other fox smiled back. It was the first time she realized she was not alone.`,
  `Once upon a time, in a land where colors were alive, the color gray felt invisible. Red was bold. Blue was calm. Yellow was joyful. But nobody ever picked gray. One day, a terrible argument broke out between the colors. Red screamed at blue. Yellow pushed green. Purple refused to speak to orange. The whole world became loud and clashing and ugly. Then gray quietly stepped between them. Where gray touched red, it became a soft rose. Where gray touched blue, it became a gentle sky. Gray softened every color it stood beside. "You're not invisible," whispered the rainbow. "You're the reason we look beautiful together."`,
];

let _lastStoryIdx = -1;

// ---- Init ----
(function ttsInit() {
  const prompt = localStorage.getItem('sts-tts-prompt');
  const el = $('#tts-prompt');
  if (prompt && el) el.value = prompt;
  const speedEl = $('#tts-speed');
  if (speedEl) speedEl.value = localStorage.getItem('sts-tts-speed') || '1.0';
  ttsCheckModel();
  ttsLoadVoices();
  ttsLoadHistory();
  ttsUpdateCounts();
  ttsApplyGenMode();
  _ttsUpdateVoiceSummary();
  // Voice section starts collapsed — open if user previously opened it
  if (localStorage.getItem('sts-tts-voiceOpen') === '1') {
    const grid = $('#tts-voice-grid');
    const chevron = $('#tts-voice-chevron');
    if (grid) grid.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  }
})();

// ---- Model Management ----
async function ttsCheckModel() {
  try {
    const r = await fetch('/api/tts/model-status/kokoro');
    const d = await r.json();
    _ttsState.modelReady = d.cached;
    const el = $('#tts-model-status');
    if (el) {
      if (d.cached) {
        el.innerHTML = '<span style="color:var(--accent)">Model ready</span>';
      } else {
        el.innerHTML = `<span style="color:var(--coral)">Model not downloaded</span>
          <button onclick="ttsDownloadModel()" class="action-btn hover-accent" style="margin-left:8px;padding:4px 12px;font-size:10px">Download (~373MB)</button>`;
      }
    }
  } catch { /* server not ready */ }
}

async function ttsDownloadModel() {
  const el = $('#tts-model-status');
  if (el) el.innerHTML = '<span style="color:var(--text-muted)">Connecting...</span>';

  return new Promise((resolve, reject) => {
    const es = new EventSource('/api/tts/download-model/kokoro');
    _ttsState.downloadEventSource = es;

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.phase === 'downloading') {
        if (el) el.innerHTML = `<span style="color:var(--text-secondary)">Downloading ${esc(d.file)} ${d.progress}% ${d.speed}</span>`;
      } else if (d.phase === 'loading') {
        if (el) el.innerHTML = '<span style="color:var(--text-secondary)">Loading model into memory...</span>';
      } else if (d.phase === 'ready') {
        es.close();
        _ttsState.modelReady = true;
        _ttsState.downloadEventSource = null;
        if (el) el.innerHTML = '<span style="color:var(--accent)">Model ready</span>';
        toast('Model downloaded and loaded');
        ttsLoadVoices();
        resolve();
      } else if (d.phase === 'error') {
        es.close();
        _ttsState.downloadEventSource = null;
        if (el) el.innerHTML = `<span style="color:var(--coral)">Error: ${esc(d.message)}</span>`;
        toast(d.message, 'error');
        reject(new Error(d.message));
      }
    };
    es.onerror = () => {
      es.close();
      _ttsState.downloadEventSource = null;
      if (el) el.innerHTML = '<span style="color:var(--coral)">Connection lost</span>';
      reject(new Error('Connection lost'));
    };
  });
}

// ---- Voice Helpers ----
function _ttsBuildVoiceGroups() {
  const groups = {};
  const voiceList = _ttsState.voices.length ? _ttsState.voices : Object.keys(VOICE_META);
  voiceList.forEach(v => {
    const meta = VOICE_META[v] || { g: 'm', hue: '#AAB8CC', lang: 'en-us' };
    const lang = meta.lang || 'en-us';
    if (!groups[lang]) groups[lang] = [];
    groups[lang].push(v);
  });
  return groups;
}

function _ttsSortedLangs(groups) {
  return Object.keys(groups).sort((a, b) => {
    const ia = LANG_ORDER.indexOf(a), ib = LANG_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

// ---- Voice Management ----
async function ttsLoadVoices() {
  try {
    const r = await fetch('/api/tts/voices');
    _ttsState.voices = await r.json();
    ttsRenderVoices();
  } catch { /* use defaults from VOICE_META */ }
}

function ttsRenderVoices() {
  const container = $('#tts-voice-grid');
  if (!container) return;

  if (_ttsState.blendMode) {
    ttsRenderBlendUI(container);
    return;
  }

  // Build voice/blend tabs
  const voiceTabActive = !_ttsState.blendMode;
  const tabsHtml = `<div style="display:flex;gap:0;margin-bottom:14px;border-radius:8px;border:1.5px solid var(--border);overflow:hidden;background:var(--bg-darkest)">
    <button onclick="ttsSetBlendMode(false)" style="flex:1;padding:9px 0;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.08em;text-transform:uppercase;border:none;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px;${voiceTabActive ? 'background:rgba(78,205,196,0.08);color:var(--accent)' : 'background:transparent;color:var(--text-muted)'}">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      Voice
    </button>
    <button onclick="ttsSetBlendMode(true)" style="flex:1;padding:9px 0;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.08em;text-transform:uppercase;border:none;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px;background:transparent;color:var(--text-muted)">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 21V9a9 9 0 0 1 9 9"/><path d="M18 3v12a9 9 0 0 1-9-9"/></svg>
      Voice Blend
    </button>
  </div>`;

  // Build language tabs with counts
  const groups = _ttsBuildVoiceGroups();
  const sortedLangs = _ttsSortedLangs(groups);
  const lang = _ttsState.selectedLang;

  let langTabsHtml = `<button class="tts-lang-tab${lang === 'top-picks' ? ' active' : ''}" onclick="ttsSelectLang('top-picks')"><span style="margin-right:3px">&#9733;</span>Top Picks<span class="tts-lang-count">${TOP_PICKS.length}</span></button>`;
  for (const l of sortedLangs) {
    langTabsHtml += `<button class="tts-lang-tab${l === lang ? ' active' : ''}" onclick="ttsSelectLang('${l}')">${LANG_SHORT[l] || l}<span class="tts-lang-count">${groups[l].length}</span></button>`;
  }

  let voiceHtml = '';
  if (lang === 'top-picks') {
    voiceHtml = _ttsRenderTopPicks();
  } else {
    voiceHtml = _ttsRenderVoiceChips(lang, groups);
  }

  container.innerHTML = `${tabsHtml}
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${langTabsHtml}</div>
    <div id="tts-voice-list">${voiceHtml}</div>`;
  _ttsUpdateVoiceSummary();
}

function _ttsRenderTopPicks() {
  return `<div style="display:flex;flex-direction:column;gap:6px">${TOP_PICKS.map(pick => {
    const meta = VOICE_META[pick.voice] || { g: 'm', hue: '#AAB8CC', name: pick.voice, desc: '' };
    const active = pick.voice === _ttsState.selectedVoice;
    const gLabel = meta.g === 'f' ? 'F' : 'M';
    const langLabel = LANG_NAMES[meta.lang] || meta.lang;
    const badgeBg = meta.g === 'f' ? 'rgba(255,155,155,0.12)' : 'rgba(111,227,218,0.12)';
    return `<button onclick="ttsSelectVoice('${pick.voice}')" class="tts-rec-card${active ? ' active' : ''}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:1.5px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'rgba(78,205,196,0.06)' : 'transparent'};cursor:pointer;text-align:left;width:100%;transition:all 0.15s">
      <span style="width:8px;height:8px;border-radius:50%;background:${meta.hue};flex-shrink:0"></span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:${active ? 'var(--accent)' : 'var(--text)'}">${meta.name}</span>
          <span class="tts-gender-tag tts-gender-${meta.g}">${gLabel}</span>
          <span style="padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;background:${badgeBg};color:${meta.hue}">${pick.badge}</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${meta.desc} &middot; ${langLabel}</div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:1px;opacity:0.7">${pick.bestFor}</div>
      </div>
      <span style="font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--text-muted);opacity:0.5;flex-shrink:0">${pick.voice}</span>
    </button>`;
  }).join('')}</div>`;
}

function _ttsRenderVoiceChips(lang, groups) {
  const voices = groups[lang] || [];
  return `<div style="display:flex;flex-wrap:wrap;gap:6px">${voices.map(v => {
    const meta = VOICE_META[v] || { g: 'm', hue: '#AAB8CC', name: v };
    const active = _ttsState.selectedVoice === v;
    const gLabel = meta.g === 'f' ? 'F' : 'M';
    return `<button onclick="ttsSelectVoice('${v}')" class="tts-voice-chip${active ? ' active' : ''}" title="${meta.desc || ''}" style="display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;border:1.5px solid ${active ? meta.hue : 'var(--border)'};background:${active ? meta.hue + '14' : 'transparent'};cursor:pointer;transition:all 0.15s;font-size:12px;color:${active ? meta.hue : 'var(--text-secondary)'}">
      <span style="width:6px;height:6px;border-radius:50%;background:${meta.hue};flex-shrink:0"></span>
      ${meta.name}
      <span class="tts-gender-tag tts-gender-${meta.g}" style="margin-left:2px">${gLabel}</span>
    </button>`;
  }).join('')}</div>`;
}

// ---- Blend UI ----
function ttsRenderBlendUI(container) {
  const mA = VOICE_META[_ttsState.blendVoiceA] || { g: 'm', hue: '#AAB8CC', name: _ttsState.blendVoiceA };
  const mB = VOICE_META[_ttsState.blendVoiceB] || { g: 'm', hue: '#AAB8CC', name: _ttsState.blendVoiceB };
  const ratio = _ttsState.blendRatio;
  const method = _ttsState.blendMethod;
  const gLabelA = mA.g === 'f' ? 'F' : 'M';
  const gLabelB = mB.g === 'f' ? 'F' : 'M';
  const methodDesc = method === 'slerp' ? 'Spherical interpolation' : 'Linear interpolation';

  const presetHtml = BLEND_PRESETS.map((p, i) => {
    const nameA = VOICE_META[p.a]?.name || p.a;
    const nameB = VOICE_META[p.b]?.name || p.b;
    return `<button onclick="ttsApplyBlendPreset(${i})" class="tts-blend-preset-btn" title="${nameA} + ${nameB} at ${p.ratio}%">
      <div style="font-weight:600;font-size:11px">${p.name}</div>
      <div style="font-size:9px;color:var(--text-muted);margin-top:1px">${p.desc}</div>
    </button>`;
  }).join('') + `<button onclick="ttsRandomBlend()" class="tts-blend-preset-btn" title="Random female + male SLERP blend" style="grid-column:1/-1;border-style:dashed">
    <div style="font-weight:600;font-size:11px">&#127922; Random</div>
    <div style="font-size:9px;color:var(--text-muted);margin-top:1px">Random F+M SLERP blend</div>
  </button>`;

  const quickBtns = [0, 25, 50, 75, 100].map(v =>
    `<button onclick="ttsSetBlendRatio(${v})" class="tts-blend-quick-btn${v === ratio ? ' active' : ''}">${v}%</button>`
  ).join('');

  container.innerHTML = `
    <div style="display:flex;gap:0;margin-bottom:14px;border-radius:8px;border:1.5px solid var(--border);overflow:hidden;background:var(--bg-darkest)">
      <button onclick="ttsSetBlendMode(false)" style="flex:1;padding:9px 0;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.08em;text-transform:uppercase;border:none;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px;background:transparent;color:var(--text-muted)">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Voice
      </button>
      <button onclick="ttsSetBlendMode(true)" style="flex:1;padding:9px 0;font-size:11px;font-weight:700;font-family:inherit;letter-spacing:0.08em;text-transform:uppercase;border:none;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(78,205,196,0.08);color:var(--accent)">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 21V9a9 9 0 0 1 9 9"/><path d="M18 3v12a9 9 0 0 1-9-9"/></svg>
        Voice Blend
      </button>
    </div>

    <!-- Voice A / B Selectors -->
    <div style="display:grid;grid-template-columns:1fr 28px 1fr;gap:6px;align-items:end;margin-bottom:14px">
      <div>
        <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted);margin-bottom:4px">Voice A</label>
        <button onclick="ttsOpenBlendPicker('a')" class="tts-blend-voice-btn">
          <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${mA.hue}"></span>
          <span>${mA.name}</span>
          <span class="tts-gender-tag tts-gender-${mA.g}" style="margin-left:auto">${gLabelA}</span>
        </button>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;padding-bottom:8px">
        <svg width="18" height="18" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" viewBox="0 0 24 24" style="opacity:0.4">
          <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </div>
      <div>
        <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted);margin-bottom:4px">Voice B</label>
        <button onclick="ttsOpenBlendPicker('b')" class="tts-blend-voice-btn">
          <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${mB.hue}"></span>
          <span>${mB.name}</span>
          <span class="tts-gender-tag tts-gender-${mB.g}" style="margin-left:auto">${gLabelB}</span>
        </button>
      </div>
    </div>

    <!-- Blend Ratio -->
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted)">Blend Ratio</label>
        <span class="font-mono" style="font-size:11px;font-weight:600;color:#A78BFA">${ratio} / ${100 - ratio}</span>
      </div>
      <div style="height:6px;border-radius:3px;margin-bottom:4px;background:linear-gradient(to right, ${mA.hue}, #A78BFA, ${mB.hue})"></div>
      <input type="range" min="0" max="100" value="${ratio}" oninput="ttsSetBlendRatio(parseInt(this.value))" style="width:100%;accent-color:var(--accent)">
      <div style="display:flex;gap:4px;margin-top:6px">${quickBtns}</div>
    </div>

    <!-- Method Toggle -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <label style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted)">Method</label>
      <div style="display:flex;border-radius:6px;border:1.5px solid var(--border);overflow:hidden">
        <button onclick="ttsSetBlendMethod('slerp')" class="tts-blend-method-btn${method === 'slerp' ? ' active' : ''}">SLERP</button>
        <button onclick="ttsSetBlendMethod('lerp')" class="tts-blend-method-btn${method === 'lerp' ? ' active' : ''}">LERP</button>
      </div>
      <span style="font-size:9px;color:var(--text-muted);opacity:0.6">${methodDesc}</span>
    </div>

    <!-- Presets -->
    <div>
      <label style="display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted);margin-bottom:6px">Presets</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${presetHtml}</div>
    </div>`;
  _ttsUpdateVoiceSummary();
}

// ---- Voice Section Toggle ----
function ttsToggleVoiceSection() {
  const grid = $('#tts-voice-grid');
  const chevron = $('#tts-voice-chevron');
  if (!grid) return;
  const isOpen = grid.style.display !== 'none';
  grid.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  localStorage.setItem('sts-tts-voiceOpen', isOpen ? '' : '1');
}

function _ttsUpdateVoiceSummary() {
  const el = $('#tts-voice-summary');
  const labelEl = $('#tts-voice-label');
  if (!el) return;
  if (_ttsState.blendMode) {
    const mA = VOICE_META[_ttsState.blendVoiceA] || {};
    const mB = VOICE_META[_ttsState.blendVoiceB] || {};
    el.textContent = `${mA.name || _ttsState.blendVoiceA} + ${mB.name || _ttsState.blendVoiceB} (${_ttsState.blendRatio}%)`;
    if (labelEl) labelEl.textContent = 'Voice Blend';
  } else {
    const m = VOICE_META[_ttsState.selectedVoice] || {};
    el.textContent = m.name || _ttsState.selectedVoice;
    if (labelEl) labelEl.textContent = 'Voice';
  }
}

// ---- Voice Selection ----
function ttsSelectLang(lang) {
  _ttsState.selectedLang = lang;
  localStorage.setItem('sts-tts-lang', lang);
  ttsRenderVoices();
}

function ttsSelectVoice(v) {
  _ttsState.selectedVoice = v;
  localStorage.setItem('sts-tts-voice', v);
  ttsRenderVoices();
}

function ttsSetBlendMode(on) {
  _ttsState.blendMode = on;
  localStorage.setItem('sts-tts-blend', on);
  ttsRenderVoices();
}

function ttsToggleBlend() {
  ttsSetBlendMode(!_ttsState.blendMode);
}

function ttsSetBlendRatio(val) {
  _ttsState.blendRatio = parseInt(val);
  localStorage.setItem('sts-tts-blendRatio', val);
  ttsRenderVoices();
}

function ttsSetBlendMethod(m) {
  _ttsState.blendMethod = m;
  localStorage.setItem('sts-tts-blendMethod', m);
  ttsRenderVoices();
}

function ttsApplyBlendPreset(idx) {
  const p = BLEND_PRESETS[idx];
  if (!p) return;
  _ttsState.blendVoiceA = p.a;
  _ttsState.blendVoiceB = p.b;
  _ttsState.blendRatio = p.ratio;
  localStorage.setItem('sts-tts-blendA', p.a);
  localStorage.setItem('sts-tts-blendB', p.b);
  localStorage.setItem('sts-tts-blendRatio', p.ratio);
  ttsRenderVoices();
  toast(`${VOICE_META[p.a]?.name || p.a} + ${VOICE_META[p.b]?.name || p.b}`, 'info');
}

function ttsRandomBlend() {
  const keys = Object.keys(VOICE_META);
  const females = keys.filter(k => VOICE_META[k].g === 'f');
  const males = keys.filter(k => VOICE_META[k].g === 'm');
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const a = pick(females);
  let b = pick(males);
  while (b === a) b = pick(males);
  const ratio = Math.floor(Math.random() * 81) + 10;
  _ttsState.blendVoiceA = a;
  _ttsState.blendVoiceB = b;
  _ttsState.blendRatio = ratio;
  _ttsState.blendMethod = 'slerp';
  localStorage.setItem('sts-tts-blendA', a);
  localStorage.setItem('sts-tts-blendB', b);
  localStorage.setItem('sts-tts-blendRatio', ratio);
  localStorage.setItem('sts-tts-blendMethod', 'slerp');
  ttsRenderVoices();
  toast(`${VOICE_META[a].name} + ${VOICE_META[b].name} @ ${ratio}%`, 'info');
}

// ---- Blend Voice Picker Modal ----
function ttsOpenBlendPicker(target) {
  _ttsState.blendPickerTarget = target;
  const picker = $('#tts-blend-picker-modal');
  if (!picker) return;
  picker.style.display = 'flex';
  $('#tts-blend-picker-title').textContent = `Select Voice ${target.toUpperCase()}`;

  const currentVoice = target === 'a' ? _ttsState.blendVoiceA : _ttsState.blendVoiceB;
  const currentMeta = VOICE_META[currentVoice];
  if (currentMeta) _ttsState.blendPickerLang = currentMeta.lang;

  _ttsRenderPickerTabs();
  _ttsRenderPickerGrid();

  picker.onclick = (e) => { if (e.target === picker) ttsCloseBlendPicker(); };
  document.addEventListener('keydown', _ttsBlendPickerEsc);
}

function ttsCloseBlendPicker() {
  const picker = $('#tts-blend-picker-modal');
  if (picker) picker.style.display = 'none';
  _ttsState.blendPickerTarget = null;
  document.removeEventListener('keydown', _ttsBlendPickerEsc);
}

function _ttsBlendPickerEsc(e) { if (e.key === 'Escape') ttsCloseBlendPicker(); }

function _ttsRenderPickerTabs() {
  const tabsEl = $('#tts-blend-picker-tabs');
  if (!tabsEl) return;
  const groups = _ttsBuildVoiceGroups();
  const sortedLangs = _ttsSortedLangs(groups);
  tabsEl.innerHTML = sortedLangs.map(l =>
    `<button class="tts-lang-tab${l === _ttsState.blendPickerLang ? ' active' : ''}" onclick="_ttsPickerSelectLang('${l}')">${LANG_SHORT_COMPACT[l] || l}<span class="tts-lang-count">${groups[l].length}</span></button>`
  ).join('');
}

function _ttsPickerSelectLang(lang) {
  _ttsState.blendPickerLang = lang;
  _ttsRenderPickerTabs();
  _ttsRenderPickerGrid();
}

function _ttsRenderPickerGrid() {
  const gridEl = $('#tts-blend-picker-grid');
  if (!gridEl) return;
  const groups = _ttsBuildVoiceGroups();
  const voices = groups[_ttsState.blendPickerLang] || [];
  const currentVoice = _ttsState.blendPickerTarget === 'a' ? _ttsState.blendVoiceA : _ttsState.blendVoiceB;

  gridEl.innerHTML = voices.map(v => {
    const meta = VOICE_META[v] || { g: 'm', hue: '#AAB8CC', name: v };
    const active = v === currentVoice;
    const gLabel = meta.g === 'f' ? 'F' : 'M';
    return `<button onclick="ttsSelectBlendVoice('${v}')" class="tts-voice-chip${active ? ' active' : ''}" title="${meta.desc || ''}" style="display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:8px;border:1.5px solid ${active ? meta.hue : 'var(--border)'};background:${active ? meta.hue + '14' : 'transparent'};cursor:pointer;transition:all 0.15s;font-size:12px;color:${active ? meta.hue : 'var(--text-secondary)'}">
      <span style="width:6px;height:6px;border-radius:50%;background:${meta.hue};flex-shrink:0"></span>
      ${meta.name}
      <span class="tts-gender-tag tts-gender-${meta.g}" style="margin-left:2px">${gLabel}</span>
    </button>`;
  }).join('');
}

function ttsSelectBlendVoice(v) {
  if (_ttsState.blendPickerTarget === 'a') {
    _ttsState.blendVoiceA = v;
    localStorage.setItem('sts-tts-blendA', v);
  } else {
    _ttsState.blendVoiceB = v;
    localStorage.setItem('sts-tts-blendB', v);
  }
  ttsCloseBlendPicker();
  ttsRenderVoices();
}

// ---- Text Input ----
function ttsUpdateCounts() {
  const el = $('#tts-prompt');
  if (!el) return;
  const text = el.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const tokens = Math.round(words * 1.3);
  const countEl = $('#tts-text-count');
  if (countEl) countEl.textContent = `${words} words ~ ${tokens} tokens`;
  localStorage.setItem('sts-tts-prompt', el.value);
}

async function ttsNormalize() {
  const el = $('#tts-prompt');
  if (!el || !el.value.trim()) { toast('Enter text first', 'error'); return; }
  const btn = $('#tts-normalize-btn');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const r = await fetch('/api/tts/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: el.value }),
    });
    const d = await r.json();
    if (d.normalized) {
      el.value = d.normalized;
      ttsUpdateCounts();
      toast('Text normalized for TTS');
    }
  } catch (e) {
    toast('Normalization failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

function ttsCopyPrompt() {
  const text = $('#tts-prompt')?.value?.trim();
  if (!text) { toast('Nothing to copy', 'error'); return; }
  const plain = text.replace(/[\[\]]/g, '').replace(/\n{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  navigator.clipboard.writeText(plain).then(() => toast('Plain text copied')).catch(() => toast('Copy failed', 'error'));
}

function ttsRandomStory() {
  let idx;
  do { idx = Math.floor(Math.random() * RANDOM_STORIES.length); } while (idx === _lastStoryIdx && RANDOM_STORIES.length > 1);
  _lastStoryIdx = idx;
  const ta = $('#tts-prompt');
  if (!ta) return;
  ta.value = RANDOM_STORIES[idx];
  ta.dispatchEvent(new Event('input'));
  ttsUpdateCounts();
  ta.focus();
  toast('Random story loaded');
}

// ---- Generate Mode Toggle ----
function ttsSetGenMode(mode) {
  _ttsState.genMode = mode;
  localStorage.setItem('sts-tts-genMode', mode);
  ttsApplyGenMode();
}

function ttsApplyGenMode() {
  const genBtn = $('#tts-gen-btn-label');
  const genTab = $('#tts-mode-gen');
  const listenTab = $('#tts-mode-listen');
  if (genBtn) genBtn.textContent = _ttsState.genMode === 'generate' ? 'Generate' : 'Listen';
  if (genTab) genTab.style.color = _ttsState.genMode === 'generate' ? 'var(--accent)' : 'var(--text-muted)';
  if (listenTab) listenTab.style.color = _ttsState.genMode === 'listen' ? 'var(--accent)' : 'var(--text-muted)';
}

// ---- Generate / Stream ----
async function ttsHandleAction() {
  if (_ttsState.isGenerating) return;
  if (_ttsState.genMode === 'listen') {
    await ttsHandleStream();
  } else {
    await ttsHandleGenerate();
  }
}

async function ttsHandleGenerate() {
  const prompt = $('#tts-prompt')?.value?.trim();
  if (!prompt) { toast('Enter some text first', 'error'); return; }

  _ttsState.isGenerating = true;
  ttsSetGeneratingUI(true);

  try {
    if (!_ttsState.modelReady) {
      ttsSetProgress('Downloading model...');
      await ttsDownloadModel();
    }

    ttsSetProgress('Normalizing text...');
    let genPrompt = prompt;
    try {
      const nr = await fetch('/api/tts/normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt }),
      });
      const nd = await nr.json();
      if (nd.normalized) genPrompt = nd.normalized;
    } catch { /* use original */ }

    const speed = parseFloat($('#tts-speed')?.value || '1.0');
    const payload = {
      model: 'kokoro',
      voice: _ttsState.selectedVoice,
      prompt: genPrompt,
      speed,
      max_silence_ms: 500,
    };
    if (_ttsState.blendMode) {
      payload.blend = {
        voice_a: _ttsState.blendVoiceA,
        voice_b: _ttsState.blendVoiceB,
        ratio: (100 - _ttsState.blendRatio) / 100,
        method: _ttsState.blendMethod,
      };
    }

    ttsSetProgress('Generating audio...');
    const r = await fetch('/api/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();

    if (d.job_id) {
      _ttsState.currentJobId = d.job_id;
      await ttsStreamChunkedProgress(d.job_id, d.total_chunks);
    } else if (d.error) {
      throw new Error(d.error);
    } else {
      ttsSetProgress('Done!');
      ttsPlayAudio(d);
      ttsLoadHistory();
    }
  } catch (e) {
    toast(e.message || 'Generation failed', 'error');
  } finally {
    _ttsState.isGenerating = false;
    _ttsState.currentJobId = null;
    ttsSetGeneratingUI(false);
    ttsSetProgress('');
  }
}

async function ttsStreamChunkedProgress(jobId, totalChunks) {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/tts/generate-progress/${jobId}`);
    _ttsState.chunkEventSource = es;

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.phase === 'generating') {
        ttsSetProgress(`Generating chunk ${d.chunk}/${d.total}...`);
      } else if (d.phase === 'concatenating') {
        ttsSetProgress('Concatenating audio...');
      } else if (d.phase === 'normalizing') {
        ttsSetProgress('Normalizing volume...');
      } else if (d.phase === 'done') {
        es.close();
        _ttsState.chunkEventSource = null;
        ttsSetProgress('Done!');
        if (d.metadata) ttsPlayAudio(d.metadata);
        ttsLoadHistory();
        resolve();
      } else if (d.phase === 'error') {
        es.close();
        _ttsState.chunkEventSource = null;
        reject(new Error(d.message || 'Generation failed'));
      } else if (d.phase === 'aborted') {
        es.close();
        _ttsState.chunkEventSource = null;
        toast('Generation aborted', 'info');
        resolve();
      }
    };
    es.onerror = () => {
      es.close();
      _ttsState.chunkEventSource = null;
      reject(new Error('Connection lost'));
    };
  });
}

async function ttsAbortGeneration() {
  if (_ttsState.currentJobId) {
    try {
      await fetch(`/api/tts/generate-abort/${_ttsState.currentJobId}`, { method: 'POST' });
    } catch { /* best effort */ }
  }
  if (_ttsState.chunkEventSource) {
    _ttsState.chunkEventSource.close();
    _ttsState.chunkEventSource = null;
  }
  if (_ttsState.downloadEventSource) {
    _ttsState.downloadEventSource.close();
    _ttsState.downloadEventSource = null;
  }
  if (_ttsState.streamAbortController) {
    _ttsState.streamAbortController.abort();
    _ttsState.streamAbortController = null;
  }
  if (_ttsState.streamAudioCtx) {
    try { _ttsState.streamAudioCtx.close(); } catch {}
    _ttsState.streamAudioCtx = null;
  }
  _ttsState.isGenerating = false;
  _ttsState.currentJobId = null;
  ttsSetGeneratingUI(false);
  ttsSetProgress('');
}

// ---- Stream / Listen Mode ----
async function ttsHandleStream() {
  const prompt = $('#tts-prompt')?.value?.trim();
  if (!prompt) { toast('Enter some text first', 'error'); return; }

  _ttsState.isGenerating = true;
  ttsSetGeneratingUI(true);

  try {
    if (!_ttsState.modelReady) {
      ttsSetProgress('Downloading model...');
      await ttsDownloadModel();
    }

    const speed = parseFloat($('#tts-speed')?.value || '1.0');
    const payload = {
      model: 'kokoro',
      voice: _ttsState.selectedVoice,
      prompt,
      speed,
    };
    if (_ttsState.blendMode) {
      payload.blend = {
        voice_a: _ttsState.blendVoiceA,
        voice_b: _ttsState.blendVoiceB,
        ratio: (100 - _ttsState.blendRatio) / 100,
        method: _ttsState.blendMethod,
      };
    }

    ttsSetProgress('Streaming...');
    const ctrl = new AbortController();
    _ttsState.streamAbortController = ctrl;

    const resp = await fetch('/api/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    _ttsState.streamAudioCtx = audioCtx;
    let nextPlayTime = audioCtx.currentTime;
    let buffer = '';
    let chunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = JSON.parse(line.slice(6));

        if (d.phase === 'audio') {
          chunks++;
          const pcm = Uint8Array.from(atob(d.samples), c => c.charCodeAt(0));
          const float32 = new Float32Array(pcm.buffer);
          const audioBuf = audioCtx.createBuffer(1, float32.length, d.sample_rate);
          audioBuf.getChannelData(0).set(float32);
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuf;
          source.connect(audioCtx.destination);
          if (nextPlayTime < audioCtx.currentTime) nextPlayTime = audioCtx.currentTime;
          source.start(nextPlayTime);
          nextPlayTime += audioBuf.duration;
          ttsSetProgress(`Streaming chunk ${chunks}...`);
        } else if (d.phase === 'done') {
          ttsSetProgress('Stream complete');
        } else if (d.phase === 'error') {
          throw new Error(d.message);
        }
      }
    }

    const remaining = nextPlayTime - audioCtx.currentTime;
    if (remaining > 0) {
      await new Promise(r => setTimeout(r, remaining * 1000 + 200));
    }
    audioCtx.close();
    _ttsState.streamAudioCtx = null;

  } catch (e) {
    if (e.name !== 'AbortError') {
      toast(e.message || 'Stream failed', 'error');
    }
  } finally {
    _ttsState.isGenerating = false;
    _ttsState.streamAbortController = null;
    ttsSetGeneratingUI(false);
    ttsSetProgress('');
  }
}

// ---- Audio Playback ----
function ttsPlayAudio(meta) {
  if (!meta || !meta.filename) return;
  _ttsState.nowPlaying = meta;
  const audioEl = $('#tts-audio-el');
  if (!audioEl) return;

  const url = `/output/tts/${meta.folder}/${meta.filename}`;
  audioEl.src = url;
  audioEl.load();
  audioEl.play().catch(() => {});

  const playerEl = $('#tts-now-playing');
  if (playerEl) {
    const m = VOICE_META[meta.voice] || {};
    playerEl.style.display = 'block';
    $('#tts-np-text').textContent = (meta.prompt || '').slice(0, 80) + ((meta.prompt || '').length > 80 ? '...' : '');
    $('#tts-np-voice').textContent = m.name || meta.voice;
    $('#tts-np-duration').textContent = meta.duration_seconds ? `${meta.duration_seconds.toFixed(1)}s` : '';
  }
}

function ttsTogglePlayback() {
  const el = $('#tts-audio-el');
  if (!el) return;
  if (el.paused) el.play().catch(() => {});
  else el.pause();
}

function ttsUpdatePlayIcon() {
  const el = $('#tts-audio-el');
  const btn = $('#tts-play-btn');
  if (!el || !btn) return;
  btn.textContent = el.paused ? '\u25B6' : '\u23F8';
}

function ttsSeekAudio(e) {
  const el = $('#tts-audio-el');
  const bar = $('#tts-seek-bar');
  if (!el || !bar || !el.duration) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  el.currentTime = pct * el.duration;
}

function ttsUpdateSeekBar() {
  const el = $('#tts-audio-el');
  const fill = $('#tts-seek-fill');
  const time = $('#tts-time');
  if (!el || !fill) return;
  const pct = el.duration ? (el.currentTime / el.duration * 100) : 0;
  fill.style.width = pct + '%';
  if (time) {
    const fmt = s => { const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
    time.textContent = `${fmt(el.currentTime)} / ${fmt(el.duration || 0)}`;
  }
}

// ---- History ----
async function ttsLoadHistory() {
  try {
    const r = await fetch('/api/tts/generation');
    _ttsState.history = await r.json();
    ttsRenderHistory();
  } catch { /* no-op */ }
}

function ttsRenderHistory() {
  const container = $('#tts-history-list');
  if (!container) return;
  const items = _ttsState.history;

  if (!items.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:11px;padding:24px 0">No generations yet</p>';
    return;
  }

  const countEl = $('#tts-history-count');
  if (countEl) countEl.textContent = `${items.length} files`;

  container.innerHTML = items.map((item, i) => {
    const m = VOICE_META[item.voice] || {};
    const excerpt = (item.prompt || '').slice(0, 60) + ((item.prompt || '').length > 60 ? '...' : '');
    const dur = item.duration_seconds ? `${item.duration_seconds.toFixed(1)}s` : '';
    const ago = _ttsTimeAgo(item.timestamp);

    return `<div class="card p-3 mb-2" style="cursor:pointer" onclick="ttsPlayHistoryItem(${i})">
      <div class="flex items-start gap-3">
        <button onclick="event.stopPropagation();ttsPlayHistoryItem(${i})" style="width:32px;height:32px;min-width:32px;border-radius:8px;background:rgba(78,205,196,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--accent);margin-top:2px">
          <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="flex-1 min-w-0">
          <p class="text-xs" style="color:var(--text);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(excerpt)}</p>
          <div class="flex items-center gap-2 mt-1" style="font-size:10px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">
            <span>${esc(m.name || item.voice)}</span>
            <span style="opacity:0.3">/</span>
            <span>${dur}</span>
            <span style="opacity:0.3">/</span>
            <span>${ago}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <button onclick="event.stopPropagation();ttsOpenFolder(${i})" title="Open folder" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          </button>
          <button onclick="event.stopPropagation();ttsDeleteItem(${i})" title="Delete" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:4px">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function ttsPlayHistoryItem(idx) {
  const item = _ttsState.history[idx];
  if (item) ttsPlayAudio(item);
}

async function ttsOpenFolder(idx) {
  const item = _ttsState.history[idx];
  if (!item) return;
  try {
    await fetch('/api/tts/open-generation-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: item.filename }),
    });
  } catch { /* best effort */ }
}

async function ttsDeleteItem(idx) {
  const item = _ttsState.history[idx];
  if (!item) return;
  const ok = await confirmDialog({
    title: 'Move to Trash?',
    message: (item.prompt || '').slice(0, 100),
  });
  if (!ok) return;

  try {
    await fetch(`/api/tts/generation/${item.filename}`, { method: 'DELETE' });
    if (_ttsState.nowPlaying?.filename === item.filename) {
      const el = $('#tts-audio-el');
      if (el) { el.pause(); el.src = ''; }
      const np = $('#tts-now-playing');
      if (np) np.style.display = 'none';
      _ttsState.nowPlaying = null;
    }
    toast('Moved to trash');
    ttsLoadHistory();
  } catch {
    toast('Delete failed', 'error');
  }
}

async function ttsDeleteAll() {
  if (_ttsState.isGenerating) { toast('Wait for generation to finish', 'error'); return; }
  const ok = await confirmDialog({
    title: 'Delete All?',
    desc: 'All TTS generations will be moved to TRASH.',
    confirmLabel: 'Delete All',
  });
  if (!ok) return;
  try {
    const r = await fetch('/api/tts/generation', { method: 'DELETE' });
    const d = await r.json();
    toast(`Moved ${d.count} items to trash`);
    const el = $('#tts-audio-el');
    if (el) { el.pause(); el.src = ''; }
    const np = $('#tts-now-playing');
    if (np) np.style.display = 'none';
    _ttsState.nowPlaying = null;
    ttsLoadHistory();
  } catch {
    toast('Delete failed', 'error');
  }
}

// ---- UI Helpers ----
function ttsSetGeneratingUI(on) {
  const btn = $('#tts-gen-btn');
  const spinner = $('#tts-gen-spinner');
  const label = $('#tts-gen-btn-label');
  const abort = $('#tts-abort-btn');
  if (btn) btn.disabled = on;
  if (spinner) spinner.style.display = on ? 'inline-block' : 'none';
  if (label) label.textContent = on ? 'Processing...' : (_ttsState.genMode === 'generate' ? 'Generate' : 'Listen');
  if (abort) abort.style.display = on ? 'inline-block' : 'none';
}

function ttsSetProgress(msg) {
  const el = $('#tts-progress');
  if (el) {
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }
}

function _ttsTimeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-tts') {
      e.preventDefault();
      ttsHandleAction();
    }
  }
});
