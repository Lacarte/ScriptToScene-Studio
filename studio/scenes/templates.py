"""Scene Style Templates — Pre-tuned visual style presets for AI scene generation.

Each template bundles a style_prompt (LLM instructions for generating image prompts)
along with display metadata for the frontend picker.
"""

SCENE_STYLE_TEMPLATES = [
    {
        "id": "cinematic",
        "name": "Cinematic Realistic",
        "description": "Photorealistic, dramatic lighting, film grain",
        "color": "#4ECDC4",
        "style_prompt": (
            "Generate photorealistic image prompts with cinematic composition. "
            "Use dramatic lighting (golden hour, chiaroscuro, volumetric light rays). "
            "Include film grain texture, shallow depth of field, and anamorphic lens flare. "
            "Frame shots like a Hollywood cinematographer — wide establishing shots, "
            "medium close-ups for emotion, extreme close-ups for tension. "
            "Color palette: rich, saturated, with teal-orange contrast."
        ),
    },
    {
        "id": "dark_horror",
        "name": "Dark / Horror",
        "description": "Eerie shadows, desaturated tones, unsettling atmosphere",
        "color": "#FF6B6B",
        "style_prompt": (
            "Generate dark, unsettling image prompts for horror storytelling. "
            "Use heavy shadows, low-key lighting, and desaturated cold tones (blue-grey, sickly green). "
            "Include fog, mist, silhouettes, and partially obscured subjects. "
            "Environments should feel abandoned, decaying, or claustrophobic. "
            "Faces should be partially hidden or lit from below. "
            "Atmosphere: dread, unease, isolation. Think atmospheric horror, not gore."
        ),
    },
    {
        "id": "reddit_story",
        "name": "Reddit Story",
        "description": "Everyday realism, relatable settings, subtle tension",
        "color": "#FF8A50",
        "style_prompt": (
            "Generate realistic, grounded image prompts for Reddit-style personal stories. "
            "Settings are everyday and relatable: apartments, offices, cars, restaurants, suburban homes. "
            "Lighting should feel natural — overhead fluorescents, laptop screen glow, afternoon window light. "
            "People should look like normal, non-glamorous individuals. "
            "Use medium shots and over-the-shoulder angles for conversational scenes. "
            "Mood shifts with the narrative: warm tones for happy moments, cool desaturated for conflict. "
            "Style: modern photorealistic, candid photography feel."
        ),
    },
    {
        "id": "motivational",
        "name": "Motivational",
        "description": "Bright, uplifting, high-contrast inspirational visuals",
        "color": "#FFD93D",
        "style_prompt": (
            "Generate uplifting, inspirational image prompts with high visual energy. "
            "Use bright, warm lighting — sunrise/sunset, golden backlighting, lens flare. "
            "Include expansive landscapes, mountain peaks, open skies, and silhouettes against light. "
            "People should appear determined, triumphant, or in motion (running, climbing, reaching). "
            "Color palette: warm golds, deep blues, vibrant oranges. High contrast. "
            "Composition: epic wide shots, low-angle hero shots, dramatic scale."
        ),
    },
    {
        "id": "nature_doc",
        "name": "Nature Documentary",
        "description": "BBC Earth aesthetics, macro detail, sweeping landscapes",
        "color": "#26DE81",
        "style_prompt": (
            "Generate nature documentary-style image prompts with BBC Earth quality. "
            "Use extreme macro for small subjects (insects, dewdrops, textures) and "
            "sweeping aerial/wide shots for landscapes. "
            "Lighting: natural golden hour, dappled forest light, underwater caustics. "
            "Include wildlife in natural behavior, pristine environments, and ecological detail. "
            "Color palette: lush greens, ocean blues, earth tones. "
            "Composition: rule of thirds, leading lines in nature, shallow DOF on subjects."
        ),
    },
    {
        "id": "anime",
        "name": "Anime / Manga",
        "description": "Japanese animation style, vivid colors, expressive characters",
        "color": "#A78BFA",
        "style_prompt": (
            "Generate image prompts in Japanese anime/manga art style. "
            "Characters should have expressive faces with large eyes, dynamic poses, and stylized hair. "
            "Use vivid, saturated colors with cel-shading and clean line art. "
            "Backgrounds should be detailed and painterly (Makoto Shinkai sky style). "
            "Include speed lines for action, sparkle effects for emotion, "
            "and dramatic camera angles (dutch angles, extreme low/high). "
            "Lighting: rim lighting, dramatic backlighting, neon glows for night scenes."
        ),
    },
    {
        "id": "surreal",
        "name": "Surreal / Dreamlike",
        "description": "Impossible geometry, floating objects, otherworldly scenes",
        "color": "#E879F9",
        "style_prompt": (
            "Generate surreal, dreamlike image prompts with impossible or fantastical elements. "
            "Include floating objects, impossible architecture, melting landscapes, and scale distortions. "
            "Mix unexpected elements: clocks in forests, doors in oceans, stairs to nowhere. "
            "Use soft, diffused lighting with iridescent or bioluminescent accents. "
            "Color palette: pastels mixed with deep jewel tones, gradient skies. "
            "Composition: center-weighted with vast negative space. "
            "Style: between Salvador Dali and modern digital surrealism."
        ),
    },
    {
        "id": "noir",
        "name": "Noir / Mystery",
        "description": "High contrast B&W, venetian blinds, smoky atmosphere",
        "color": "#94A3B8",
        "style_prompt": (
            "Generate film noir-style image prompts with classic detective/mystery atmosphere. "
            "Use high-contrast black and white or very desaturated tones with a single accent color. "
            "Lighting: harsh venetian blind shadows, single-source desk lamps, neon reflections on wet streets. "
            "Include rain-slicked city streets, smoky interiors, long shadows, and trench coat silhouettes. "
            "Composition: dutch angles, deep shadows covering half the frame, mirror/reflection shots. "
            "Atmosphere: mysterious, morally ambiguous, tension without violence."
        ),
    },
    {
        "id": "minimal",
        "name": "Minimalist",
        "description": "Clean compositions, negative space, simple shapes",
        "color": "#6B7F93",
        "style_prompt": (
            "Generate minimalist image prompts with maximum visual impact from minimal elements. "
            "Use vast negative space, single focal subjects, and geometric simplicity. "
            "Color palette: monochromatic or limited to 2-3 colors. "
            "Composition: centered single subject, extreme negative space, "
            "clean horizons, isolated objects on plain backgrounds. "
            "Lighting: soft, even, shadowless OR single dramatic shadow. "
            "Style: modern design photography, architectural minimalism."
        ),
    },
]

# Quick lookup by ID
TEMPLATES_BY_ID = {t["id"]: t for t in SCENE_STYLE_TEMPLATES}
