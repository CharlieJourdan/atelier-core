// The illustration presets a pipeline may pick for its director (record 0055, « les exigences sont des réglages mesurés de la
// pipeline, pas des barrières du moteur »): each is DATA measured on a pipeline's reference videos, never an engine rule. A
// pipeline without one keeps the director's general rules (metaphors, labels, warm light and long presenter shots all allowed).
// `reference-literal` is `avatar@1`'s, measured on Charlie's two Headcast videos (research note illustration-grammar-2026-11 (old repository));
// `presenter-vlog` is a pipeline's whose presenter acts the scenes, measured on The Japanese Method (research note style-japanese-method-2026-11 (old repository)).
// `documentary-archive` is the archive documentaries', measured on four videos of a history channel (research note style-markets-of-the-past-2026-11 (old repository)).

export const ILLUSTRATION_PRESETS = ['reference-literal', 'presenter-vlog', 'documentary-archive'] as const
export type IllustrationPreset = (typeof ILLUSTRATION_PRESETS)[number]

/**
 * How the channel's own reference videos illustrate a sentence (avatar-qualite part 2: 411 B-roll shots of Charlie's two
 * Headcast videos, each frame labelled against the words spoken under it): 95 % show something those words say — the object
 * named 35 %, the gesture said 26 %, the problem described 18 %, the place 10 %, the result 4 % — and never a mood or a
 * metaphor; the named word falls in the first third of the shot (median); angles: first-person hands 19 %, the object close
 * 17 %, a picture beside the presenter 20 %, a macro of a detail 10 %, the room wide 9 %, hands from the side 8 %, a person
 * acting 8 %, outside 8 %; the camera is steady (89 %); 3.3 s and about 11 words a shot. Talk sentences are the presenter's.
 */
const REFERENCE_LITERAL: readonly string[] = [
  '- Literal, as the channel’s reference videos are (95 % of their pictures): every picture shows something the words under it SAY — the object they name, the gesture they say, the problem they describe, the place, the result. Never a mood, a metaphor, a generic activity or a « professional at work » that the words do not name. An abstract word gets a concrete object that shows it (« sec et tiède » → a hygrometer reading 21 °C and 50 %).',
  '- The angle follows what is said: a gesture → first-person hands doing it (point of view), or the hands close from the side, sometimes a person waist-up doing it; an object → that object alone, close, filling the frame, or held in a hand; a problem (mould, damp, a crack, the cold) → an extreme close-up of the defect, or the corner of the room in a wide shot; a place → the room wide, or outside; a result → the surface or the object once done. Never the same angle twice in a row.',
  '- Talk sentences (announcing what comes next, giving an opinion, « je » / « on va », a negation such as « ce n’est pas le mur », a question) belong to the presenter. When one has pictures anyway, show the concrete subject of the paragraph (the mould, the wall, the tool), never a picture of the idea.',
  '- What happens in the words happens in the picture, on its own words: « vous avez décalé l’armoire » → the wardrobe pulled away; « Et derrière, dans l’angle du mur… la moisissure » → the mould on the wall corner behind it, clearly visible (never the wardrobe alone hiding it).',
  '- The light is the reference videos’: soft grey daylight, overcast, cool and true-to-life colours (they are about winter, damp and cold); never golden, sunset or warm sunny light unless the words say so.',
  '- An imageAi prompt is a steady phone photo at eye level, close to the subject, in an ordinary home or garden; a clipAi prompt is a steady phone video of the same kind that names the one small movement (the hand spreads the lime, the water runs down) while the camera stays almost still.'
]

/**
 * How a channel whose presenter acts its scenes illustrates a sentence (style-japanese: four long videos of The Japanese Method,
 * frames one a second over 4 minutes and 107 spread ones): every picture is a short scene of home life on a phone, literal (the
 * object, the place, the gesture the sentence names), cut on the sentence's first words; the presenter acts 21–42 % of the
 * pictures in his three recent videos, other people (a wife, a mother, guests, neighbours) a third, places and objects alone the
 * rest; Japanese homes answer American ones; bright warm daylight; every shot moves, hand-held; about 2.7 s a shot.
 */
const PRESENTER_VLOG: readonly string[] = [
  '- Literal, as the channel’s reference videos are: every picture is a short scene of everyday home life that shows what the words under it SAY — the object they name, the place, the gesture, the person doing it. Never a mood, a metaphor or a generic « person thinking ».',
  '- People act the scenes. About a third of the pictures show the presenter (the channel’s own person, same face and same clothes, written « the presenter ») doing what the sentence says: opening the cabinet, counting the shoes, carrying the box, eating at the table. The others show the people the words name (a wife, a mother, guests, a neighbour, children) or the place and the objects alone. In a picture the presenter never talks to the camera.',
  '- Two homes answer each other when the words compare: a Japanese home (wood, tatami, shoji screens, the entrance step with the shoes) and an American suburban home (big sofa, open kitchen, hardwood floors, a full garage). Show the side the sentence is about.',
  '- The light is natural daylight through the windows, bright and warm: sunny mornings, soft golden evenings, true colours. Never grey, gloomy or overcast unless the words say so.',
  '- A clipAi prompt is a hand-held phone video at eye level of one simple action that the camera follows gently; an imageAi prompt is a phone photo of the same kind, the person caught in the middle of the action. One action a shot, about 3 seconds; never the same scene twice in a row.'
]

/**
 * How the documentary references illustrate a sentence (style-markets: four 23–38 min history videos, 0:00–3:00 and 10:00–13:00 of each):
 * the picture shows what the sentence names, the caption names the picture. A person → their portrait as a print with a name label; a
 * place or a movement → a map; a figure, a price, a loss → a data card whose row lands on its number; a document, a law, a headline → the
 * document on graph paper with the cited line marked in red; a period or a mood → a period photograph or painting; an idea with no
 * picture → a word punch over a period picture. ≈ 70 % archives, 20 % cards, 5 % generated period stills; no presenter, no captions.
 */
const DOCUMENTARY_ARCHIVE: readonly string[] = [
  '- A history documentary made of ARCHIVES: every picture is a real period document found in public archives (a photograph, a painting, an engraving, a newspaper, a map, a treaty, a portrait) or, when no archive can show it, a generated still that looks like a period photograph of that exact time and place. Never a modern scene in a period sentence, never an anachronism, never a mood picture.',
  '- The picture shows what the sentence NAMES, on the word that names it: a named person → their portrait; a named place → that place at that time; a named event → a photograph or a painting of that event; a named document, law, letter or newspaper → that document; an abstract idea → the concrete thing that shows it at that time (« margin buying » → traders on a 1929 exchange floor).',
  '- archive query: 2 to 5 English words a museum or Wikimedia Commons search can match, with the period; a FULL NAME is wanted for a portrait (« Benjamin Strong portrait », « Wall Street crowd 1929 », « Treaty of Tordesillas », « Potosi Cerro Rico engraving »). imageAi prompt: « a 1920s black-and-white press photograph of … », grain and period clothes, no text.',
  '- frame (archives only): how the found picture is shown. « board » = a print on a dark board with a label under it (portraits, period photographs: label = the name or the place, sub = a role or a date); « paper » = a document on graph paper (newspapers, letters, laws, treaties: excerpt = the line the narration quotes or paraphrases, under 25 words, mark = the words of it to underline in red, source = the archive and the year); « full » = the picture full frame with a caption box (paintings, engravings, wide scenes: label = the title, sub = the artist and the year); « tv » = an old television (a period street, crowd or factory scene). punch = 1 to 4 words in capitals stamped on the picture when the narration hammers a word (« REFUSED », « THE WEALTHIEST ON EARTH »), at most one picture in five. Labels are facts the narration states or that the picture is known for; never invent a name, a date or a source.',
  '- Cards (kind motion.map, motion.bars, motion.timeline): the shot itself, held while its subject lasts (« hold »: 1 to 6 sentences). A place, a country, a border, a journey or a front → motion.map; two or more figures compared (prices, losses, populations, incomes) → motion.bars; three or more dates in a row → motion.timeline. Keep cards within the stretch\'s card budget and never two in a row.',
  '- card props, motion.map: {"kicker": the date, "title": 2 to 6 words, "regions": [{"countries": ["CHE"], "tone": "gold"|"red"|"pale", "label": "…", "on": "…"}], "pins": [{"label": "Bern", "lat": 46.95, "lon": 7.45, "note": "…", "on": "…"}], "routes": [{"from": {"lat": …, "lon": …}, "to": {…}, "on": "…"}], "view": {"west", "south", "east", "north"} (optional), "zoomTo": {…} (optional)}; countries as ISO 3166 alpha-3 codes; real coordinates.',
  '- card props, motion.bars: {"kicker": the date or the context, "title": 2 to 5 words in capitals, "source": "…", "rows": [{"label": "U.S. LOSS", "value": 500, "display": "$500B", "accent": false, "on": "…"}]} (the row the story is about has "accent": true); motion.timeline: {"kicker", "title", "events": [{"when": "1929", "label": "…", "accent", "on": "…"}]}.',
  '- "on": 1 to 4 words copied EXACTLY from the card\'s sentences, where that part appears (a row on its number, a pin on its place name, a region on its country).',
  '- Every text written on a card or a frame (titles, kickers, labels, notes, row labels, displays, dates, word punches, lines, excerpts) is in the video\'s language and its conventions: French numbers « 1,7 billion de dollars », « 22,6 % », « 10 000 florins », dates « 3 février 1637 », the currency named as the narration names it; English « $1.7T », « 22.6% », « February 3, 1637 ». Place names as that language writes them (« Haarlem », « Londres » in French).'
]

/** The director's lines of each preset (the scene pass's rules carry them when the pipeline picks one). */
export const ILLUSTRATION_RULES: Readonly<Record<IllustrationPreset, readonly string[]>> = { 'reference-literal': REFERENCE_LITERAL, 'presenter-vlog': PRESENTER_VLOG, 'documentary-archive': DOCUMENTARY_ARCHIVE }
