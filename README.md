# <a href="https://visibl.ai"><img src="https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/e2f040dd-3dda-408b-e767-b5c02ed1ec00/thumb" alt="Visibl" width="32" height="32" style="vertical-align: middle;"> visibl.ai - One Shot Book to Movie</a>
<p align="center">
  <strong>Transform fiction novels into user guided visual narratives</strong>
</p>
<div align="center">
  <video src="https://github.com/user-attachments/assets/101408e8-a0a5-4b96-8751-b9e20d79f7c1">
  </video>
</div>
<p align="center">
  <a href="https://testflight.apple.com/join/B3P1abHk">
    <img src="https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/b272a654-2e2b-411c-2561-5c94e50e7f00/thumb" alt="Download for iPhone" width="200">
  </a>
</p>
<p align="center">
  <a href="https://testflight.apple.com/join/B3P1abHk">
    <img src="https://img.shields.io/badge/TestFlight-Beta-blue?style=flat-square&logo=apple" alt="TestFlight Beta">
  </a>
  <a href="https://github.com/visibl-ai/visibl-audiobooks/blob/master/LICENCE.md">
    <img src="https://img.shields.io/badge/License-Apache%202.0-yellow?style=flat-square" alt="Apache 2.0">
  </a>
  <a href="https://visibl.ai">
    <img src="https://img.shields.io/badge/Web-visibl.ai-black?style=flat-square" alt="Website">
  </a>
</p>

---

## What is visibl?

[visibl](https://visibl.ai) transforms any fiction novel into a personalized cinematic experience. It's a new kind of **audiobook player** that generates visual scenes in real-time as you listen, letting you guide the artistic direction of your own journey through the story.

Free for iPhone. No production studios. No waiting. Just your books, visualized instantly.

**Read more to understand how it works**

---

## The Problem

Reading is dying. The average American reads 12 minutes per day, while spending 2.5 hours on TikTok and Instagram. Long-form narrative content can't compete with the dopamine hit of short-form video.

But the stories themselves aren't the problem - it's the medium. People still crave narrative (Netflix has +200M subscribers), they just won't read text for 10 hours when they could watch instead.

**Our hypothesis**: Can we make reading as engaging and immersive as tiktok and instagram?

## The Solution

Visibl is a pipeline that converts any fiction novel into a synchronized audio-visual experience in real-time. No human intervention, no production costs - just automated scene generation from text.

Think of it as a compiler that takes a novel as input and outputs a movie.

---

## Technical Architecture

The pipeline consists of several stages that transform text into synchronized visual content:

**TLDR; use RAG and graph data models to create detailed image prompts for a diffusion image model.**

### 1. **Entity Extraction via NER**
*Text to Structured Data*

Using a lightweight language model, we extract characters and locations from text chunks. This creates the foundational scene graph that drives all visualization.

<details>
<summary>Implementation Details</summary>

- Model: `deepseek-v3`
- Processing: ~512-token chunks with no overlap

**Example Input:**
```
In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.

"Whenever you feel like criticizing any one," he told me, "just remember that all the people in this world haven't had the advantages that you've had."
```

**Example Output (JSON):**
```json
["zelda", "gatsby", "my father", "narrator"]
```

*Note: From The Great Gatsby - identifies the narrator and his father as key entities in this passage.*
</details>

---

### 2. **Alias Resolution & Entity Linking**
*Maintaining Consistency*

Multi-pass reasoning model groups entity references ("Harry" = "Potter" = "The Boy Who Lived"). Critical for maintaining visual consistency across scenes.

<details>
<summary>Implementation Details</summary>

- Two-stage process: intra-chapter then inter-chapter resolution
- Model: `gpt-5-mini`
- Processing: Full chapter text with NER list in system message

**Example Input:**
```json
["zelda", "gatsby", "my father", "narrator"]
```

**Example Output:**
```json
{
  "characters": [
    {
      "name": "zelda fitzgerald",
      "aliases": ["zelda"]
    },
    {
      "name": "jay gatsby",
      "aliases": ["gatsby", "mr. gatsby"]
    },
    {
      "name": "narrator's father",
      "aliases": ["my father", "father"]
    },
    {
      "name": "nick carraway",
      "aliases": ["nick", "narrator", "mr. carraway"]
    }
  ]
}
```

*Note: Reasoning model identifies that "narrator" refers to Nick Carraway and groups all related aliases.*

**Cross-Chapter Continuity Example:**
```json
{
  "gatsby's house": {
    "appearsIn": [
      {
        "0": {
          "name": "the house",
          "confidence": "high",
          "reason": "Aliases match (my neighbor's house / my neighbor's mansion / the house) — same primary residence in both chapters."
        }
      },
      {
        "1": {
          "name": "gatsby's",
          "confidence": "high",
          "reason": "Clear identity: 'gatsby's house' in Chapter 2 corresponds to 'gatsby's' in Chapter 1 (same residence/name/alias)."
        }
      }
    ],
    "firstAppearance": 0,
    "allAliases": [
      "my neighbor's house",
      "the house",
      "gatsby's house",
      "gatsby's"
    ]
  }
}
```

*Note: The model tracks entity appearances across chapters, maintaining continuity even when references change (e.g., "my neighbor's house" → "gatsby's house").*
</details>

---

### 3. **Property Tuple Generation**
*Dynamic Entity State*

Entities aren't static - we track state changes through property tuples (character: appearance, injuries). This enables visual progression throughout the narrative.

<details>
<summary>Implementation Details</summary>

- First pass: Entity + full chapter text → generate comprehensive tuples for single entity
- Second pass: Compare with previous chapter tuples using reasoning model
- Determines deprecated tuples (e.g., costume changes, injuries healing)
- Tuple structure: (entity, property, value)
- Tuple Model: `deepseek-v3`
- Reasoning Model: `gpt-5-mini`

**Example Input:**
```
[raw chapter text] +
{
  "name": "tom buchanan",
  "aliases": ["tom buchanan", "tom"]
}
```

**Example Output (Initial Extraction):**
```json
[
  {
    "character": "tom buchanan",
    "relationship": "hair_color",
    "property": "straw-haired"
  },
  {
    "character": "tom buchanan",
    "relationship": "facial_features",
    "property": "hard mouth"
  },
  {
    "character": "tom buchanan",
    "relationship": "facial_features",
    "property": "shining, arrogant eyes"
  },
  {
    "character": "tom buchanan",
    "relationship": "wearing",
    "property": "riding clothes"
  },
  {
    "character": "tom buchanan",
    "relationship": "age",
    "property": "thirty"
  }
]
```

**Cross-Chapter Reconciliation:**
```json
{
  "tom buchanan": {
    "sourceChapter": 1,
    "included": [
      {"relationship": "gender", "property": "male"},
      {"relationship": "build", "property": "sturdy"},
      {"relationship": "hair_color", "property": "straw-haired"},
      {"relationship": "facial_features", "property": "hard mouth"},
      {"relationship": "facial_features", "property": "shining, arrogant eyes"},
      {"relationship": "wearing", "property": "riding clothes"},
      {"relationship": "age", "property": "thirty"}
    ],
    "dropped": [],
    "reasoning": "No properties from previous chapter contradicted. Retained gender, permanent features (hair, face), build, age, and clothing."
  }
}
```

*Note: System tracks which properties persist vs. change between chapters, essential for maintaining character continuity.*
</details>

---

### 4. **Entity Prompt Generation**
*Tuples to Visual Description*

Converts entity property tuples into rich visual descriptions ready for diffusion models.

<details>
<summary>Implementation Details</summary>

- Entity tuples → visual description generation
- Only requires tuples from prior steps
- Model: `fine tuned gpt-4.1`

**Example Input:**
```json
[
  {
    "character": "tom buchanan",
    "relationship": "hair_color",
    "property": "straw-haired"
  },
  {
    "character": "tom buchanan",
    "relationship": "facial_features",
    "property": "hard mouth"
  },
  {
    "character": "tom buchanan",
    "relationship": "facial_features",
    "property": "shining, arrogant eyes"
  },
  {
    "character": "tom buchanan",
    "relationship": "wearing",
    "property": "riding clothes"
  },
  {
    "character": "tom buchanan",
    "relationship": "age",
    "property": "thirty"
  }
]
```

**Example Output:**
```json
{
  "character": "tom buchanan",
  "description": "Tom Buchanan is a thirty-year-old man with a sturdy, athletic build that commands physical presence. His straw-blonde hair is slightly tousled, appearing as if recently windblown from outdoor activity. His face is dominated by a hard, set mouth that suggests stubbornness and privilege, complemented by shining eyes that radiate unapologetic arrogance. These piercing eyes seem to constantly appraise others with undisguised superiority. Currently dressed in fitted riding clothes—likely consisting of tailored breeches, knee-high leather boots, and a crisp riding jacket—his attire speaks to both his wealth and athletic pursuits. His forehead might show faint weathering from outdoor sports, and his posture carries the natural authority of someone accustomed to dominance. The sunlight catches golden highlights in his hair as he stands with the squared shoulders of a former collegiate athlete."
}
```

**Generated Image:**

![Tom Buchanan](https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/380e2a7c-1b22-49a5-b1e1-2f5f7be7f300/public)

*Note: The model expands sparse tuples into cinematically rich descriptions optimized for visual generation.*
</details>

---

### 5. **Scene Decomposition**
*Narrative to Timeline*

Chunks text into ~15-second scenes synchronized with audio narration. Handles pacing, transitions, and narrative structure.

<details>
<summary>Implementation Details</summary>

- Processing: ~2048-token chunks with no overlap
- Creative LLM chunks text into storyboard-style scenes
- Timing embeddings for audio synchronization
- Model:  `deepseek-v3`

**Example Input:**
```
[raw chapter text with timestamps]
```

**Example Output (Scene Data):**
```json
{
  "scene_number": 2,
  "description": "A young Nick Carraway stands in a well-appointed study with his father, a distinguished older gentleman. Sunlight streams through french windows as Nick listens intently to his father's advice. The father places a hand on Nick's shoulder in a moment of paternal wisdom.",
  "startTime": 35.1,
  "endTime": 70.6,
  "characters": {
    "nick carraway": "- Early 30s\n- Male\n- Lean, wiry build\n- Clean-shaven face\n- Sharp, angular features\n- Defined jawline\n- High cheekbones\n- Bright, intelligent eyes\n- Straight eyebrows\n- Short, neatly combed hair with a precise side part\n- Medium brown hair, slightly sun-bleached at the temples\n- Straight-backed posture\n- Wears well-tailored suits in muted tones\n- Crisp collars\n- Carefully knotted ties\n- Smooth but strong-looking hands\n- Long fingers",
    "nick carraway's father": "- Male\n- Late 50s\n- Strong, square jawline\n- Neatly trimmed gray hair, slightly receding at the temples\n- Gentle weathering of middle age\n- Faint smile lines around eyes and mouth\n- Wears round, wire-rimmed glasses\n- Upright posture\n- Wears a well-tailored charcoal gray wool three-piece suit\n- Crisp white dress shirt\n- Muted patterned tie secured with a simple tie pin\n- Polished black oxford shoes\n- Carries a mahogany-tipped walking stick"
  },
  "locations": {
    "the room": "- Walls are crimson in color\n- Soft, radiant light fills the room\n- A luxurious long couch at the center, upholstered in deep red\n- Rich wood paneling\n- French windows letting in bright afternoon light"
  },
  "viewpoint": {
    "setting": "bright afternoon light, rich wood paneling",
    "placement": "two-shot with Nick in foreground",
    "shot_type": "medium close-up",
    "mood": "reflective, nostalgic",
    "technical": "85mm f/4, warm color temperature, 9:16 aspect ratio"
  }
}
```

**Final Prompt (after fine-tuning):**
```
"Envision a young male character in his early 30s, with a lean, wiry build and a crisp, clean-shaven face. He possesses sharp, angular features, highlighted by a defined jawline and high cheekbones. His bright, intelligent eyes shine under straight eyebrows and his short, neatly combed hair, with a precise side part, is medium brown, slightly sun-bleached at the temples. His posture is straight-backed and he is dressed in a well-tailored suit in muted tones. Beside him stands an older, distinguished gentleman, his late 50s bearing a gentle weathering of middle age. He has a strong, square jawline, and neatly trimmed gray hair, slightly receding at the temples. Round, wire-rimmed glasses sit on his face and he wears a well-tailored charcoal gray wool three-piece suit, with a crisp white dress shirt and a muted patterned tie secured with a simple tie pin. His shoes are polished black oxfords and he carries a mahogany-tipped walking stick. They are inside a well-appointed study bathed in bright afternoon light, rich wood paneling serving as the background. The room is painted crimson, and a sense of warmth radiates from all surfaces. Both men have been captured in a nostalgic, reflective mood."
```

**Generated Scene:**

![Nick and his father](https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/43e3b0f9-4087-489c-ec7c-f590eeba8300/public)

*Note: System creates cinematic scenes with precise timing, character descriptions, and camera direction - essentially automated storyboarding.*
</details>

---

### 6. **Real-time Image Synthesis**
*Visual Generation*

Finally, use our prompt with a diffusion model

<details>
<summary>Implementation Details</summary>

- Model: `imagen4`

**Example Input (Prompt):**
```
"Envision a young male character in his early 30s, with a lean, wiry build and a crisp, clean-shaven face. He possesses sharp, angular features, highlighted by a defined jawline and high cheekbones. His bright, intelligent eyes shine under straight eyebrows and his short, neatly combed hair, with a precise side part, is medium brown, slightly sun-bleached at the temples. His posture is straight-backed and he is dressed in a well-tailored suit in muted tones. Beside him stands an older, distinguished gentleman, his late 50s bearing a gentle weathering of middle age. He has a strong, square jawline, and neatly trimmed gray hair, slightly receding at the temples. Round, wire-rimmed glasses sit on his face and he wears a well-tailored charcoal gray wool three-piece suit, with a crisp white dress shirt and a muted patterned tie secured with a simple tie pin. His shoes are polished black oxfords and he carries a mahogany-tipped walking stick. They are inside a well-appointed study bathed in bright afternoon light, rich wood paneling serving as the background. The room is painted crimson, and a sense of warmth radiates from all surfaces. Both men have been captured in a nostalgic, reflective mood."
```

**Example Output:**

![Generated scene](https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/43e3b0f9-4087-489c-ec7c-f590eeba8300/public)

*Note: Diffusion model generates high-quality images from detailed prompts in real-time during audiobook playback.*
</details>

---

### 7. **Style Transfer via ControlNet**
*User-Directed Aesthetics*

Allows artistic control while maintaining structural accuracy. Users can define visual style without breaking narrative coherence.

<details>
<summary>Implementation Details</summary>

- LLM used to take user input and convert to directions a controlnet model can accept
- Model: `seededit-3`

**Example User Input:**
```
"Wes Anderson film"
```

**LLM Conditioning Output:**
```
"Transform this image into a scene that belongs in the world of Wes Anderson films, with symmetrical compositions, pastel color palettes, and whimsical atmosphere fully adapted to that universe."
```

**Input Image:**

![Original scene](https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/43e3b0f9-4087-489c-ec7c-f590eeba8300/public)

**ControlNet Output:**

![Wes Anderson styled scene](https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/4cdb1864-c0cd-442a-b574-c9af67a0a700/public)

*Note: ControlNet preserves the scene composition and character positions while completely transforming the visual style to match the user's creative direction.*
</details>

---

## Key Features

### **Public Domain Library**
Pre-processed classical literature ready for immediate visualization. No copyright issues, instant access.

### **5-Minute Processing**
Import any novel -> Entity extraction -> Scene graph generation -> Ready for playback. Most books process in under 5 minutes.

### **Ambient Display Mode**
iOS homescreen album art updates with story-relevant imagery during playback. Maintains engagement without active watching - designed for the "second screen" generation.

### **Style Transfer Control**
ControlNet implementation allows users to define visual aesthetics while maintaining narrative accuracy. Not just filters - actual artistic direction.

---

## Open Problems

These aren't just bugs - they're fundamental challenges in automated storytelling:

### Character Consistency
- **Challenge**: Diffusion models lack persistent identity mechanisms
- **Exploring**: Face embedding injection, 3D model generation

### Entity Coverage
- **Current**: Characters and locations only
- **Challenge**: Objects and abstract concepts need different handling
- **Impact**: Missing crucial story elements (the One Ring, the Elder Wand)

### Temporal Reasoning
- **Current**: Static property snapshots at chapter boundaries
- **Challenge**: Need continuous state tracking for smooth transitions
- **Proposed**: Move to proper graph database with temporal queries

### Scene Generation
- **Current**: Film-style linear scenes
- **Challenge**: Literature uses flashbacks, parallel narratives, internal monologues
- **Needed**: Multi-track timeline with narrative device recognition

### Audio Pipeline
- **Current**: Requires existing audiobook files (M4B)
- **Challenge**: TTS quality vs. professional narration
- **Future**: Multi-voice synthesis with emotion modeling


---

## Repository Structure

```
visibl-audiobooks/
├── README.md              # This file
├── visibl-swift/          # iOS client
│   └── README.md          # iOS specific instructions
└── visibl-server/         # Pipeline server
    └── README.md          # Server specific instructions
```

---

## Contributing

We need help solving hard problems at the intersection of NLP, computer vision, and narrative understanding.

### Priority Areas
- **Model Optimization**: Quantization, pruning, mobile deployment
- **Character Consistency**: Novel approaches to identity preservation
- **Graph Systems**: Temporal knowledge graphs for narrative
- **Scene Understanding**: Better narrative structure detection

---

## About the Author

**[Moe Adham](https://moeadham.com)** - Engineer and entrepreneur who co-founded two companies now listed on NASDAQ. Specializes in graph data, AI systems, and distributed computing. Open source contributor to Bitcoin, Linux, and Tor.

Learn more: [moeadham.com](https://moeadham.com)

---

## License

Apache 2.0 - See [LICENSE](LICENCE.md)

---

<p align="center">
  <a href="https://testflight.apple.com/join/B3P1abHk">TestFlight</a> •
  <a href="https://visibl.ai">Website</a> •
  <a href="https://github.com/visibl-ai/visibl-audiobooks/discussions">Discussions</a>
</p>
