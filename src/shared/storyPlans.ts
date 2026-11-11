import type { Beat, Genre } from './types'

/**
 * The chapters a shoot of each kind usually needs, and what makes a frame from
 * each one worth keeping. A starting point: the photographer edits it per project.
 */
export const STORY_PLANS: Record<Genre, Beat[]> = {
  wedding: [
    { name: 'Details and place', look: 'Rings, dress, flowers, the venue, the weather. Texture and context; they set the scene and fill album spreads.' },
    { name: 'Getting ready', look: 'Nerves, anticipation, helping hands. The quiet in-between frames, not the posed ones.' },
    { name: 'First look or arrival', look: 'The instant of seeing each other. Reaction matters more than composition.' },
    { name: 'Ceremony', look: 'Vows, rings, the kiss, and the faces of the people watching. Tears and laughter outrank sharpness.' },
    { name: 'Congratulations', look: 'Hugs, confetti, relief. Chaos is the point; look for one clear emotional centre in the frame.' },
    { name: 'Family and group portraits', look: 'Everyone visible, eyes open, nobody mid-word. Here craft comes first: these are the record.' },
    { name: 'Couple portraits', look: 'Connection between the two. The frame after the pose, when they laugh or lean in, usually beats the pose.' },
    { name: 'Reception and speeches', look: 'Reactions to the speeches more than the speakers. Guests laughing, a parent wiping an eye.' },
    { name: 'First dance and party', look: 'Movement, light, abandon. Motion blur and grain belong here.' },
    { name: 'Ending', look: 'The exit, a last embrace, an empty room. One frame that feels like an exhale.' }
  ],
  event: [
    { name: 'Place and atmosphere', look: 'Where we are and what it feels like before people fill the frame.' },
    { name: 'Arrivals', look: 'Greetings, first reactions, people finding each other.' },
    { name: 'Main programme', look: 'The speaker or performer at a peak gesture, and the audience responding.' },
    { name: 'People together', look: 'Conversation, laughter, groups that show who was there and that they enjoyed it.' },
    { name: 'Details', look: 'Branding, food, decor, hands: what the organiser paid attention to.' },
    { name: 'Closing', look: 'Applause, goodbyes, the room emptying.' }
  ],
  portrait: [
    { name: 'Establishing', look: 'The person in their space or in the light: who and where.' },
    { name: 'Classic portrait', look: 'The frame they will use everywhere. Eyes sharp, expression open, flattering light.' },
    { name: 'Character', look: 'The expression that is unmistakably them: a look away, a half smile, a laugh between poses.' },
    { name: 'Close and intimate', look: 'Tight frames where the eyes carry everything.' },
    { name: 'Movement and in-between', look: 'Walking, adjusting, reacting. Unposed frames that make the set feel alive.' },
    { name: 'Details', look: 'Hands, clothing, objects that say something about the person.' }
  ],
  fashion: [
    { name: 'Hero look', look: 'The single frame that sells the garment and the mood. Line, silhouette and attitude together.' },
    { name: 'Full length', look: 'The whole outfit, readable. Posture and the fall of the fabric.' },
    { name: 'Movement', look: 'Fabric and body in motion. Energy over precision.' },
    { name: 'Beauty and close', look: 'Face, make-up, styling details. Here craft is non-negotiable.' },
    { name: 'Attitude', look: 'The unexpected frame: a glance, a break in the pose, something with tension.' },
    { name: 'Details', look: 'Texture, accessories, construction.' }
  ],
  other: [
    { name: 'Opening', look: 'A frame that says where we are and sets the tone.' },
    { name: 'Subject', look: 'Who or what this is about, clearly.' },
    { name: 'Moments', look: 'Things happening: gesture, reaction, change.' },
    { name: 'Details', look: 'Close observations that add texture.' },
    { name: 'Closing', look: 'A frame that lets the viewer leave.' }
  ]
}

/** How much the moment counts against craft by default, 0..1. */
export const DEFAULT_BALANCE: Record<Genre, number> = {
  wedding: 0.55,
  event: 0.5,
  portrait: 0.45,
  fashion: 0.35,
  other: 0.4
}
