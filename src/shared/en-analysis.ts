// English strings of fr-analysis.ts (shared vocabulary: components, modes, tiers, validation codes).
import type { MessageKey } from './fr'

export const enAnalysis: Partial<Record<MessageKey, string>> = {
  // Visual components of the gauge
  'analysis.comp.stock': 'Stock footage',
  'analysis.comp.text_anim': 'Text animation',
  'analysis.comp.ai_image': 'AI image',
  'analysis.comp.ai_video': 'AI video',
  'analysis.comp.avatar': 'Avatar',
  'analysis.comp.face_camera': 'Face to camera',
  'analysis.comp.gameplay': 'Gameplay',
  'analysis.comp.cartoon': 'Cartoon',
  'analysis.comp.three_d': '3D',
  'analysis.comp.infographic': 'Infographic',
  'analysis.comp.map': 'Map',
  'analysis.comp.clip': 'Clip from another source',

  // Budget modes
  'analysis.mode.qualite_max': 'Max quality',
  'analysis.mode.usage_max': 'Max volume',

  // Tiers
  'analysis.tier.reproductible': 'Reproducible',
  'analysis.tier.adaptations': 'Reproducible with adaptations',
  'analysis.tier.partiel': 'Partial',
  'analysis.tier.special': 'Special format',
  'analysis.conf.high': 'High confidence',
  'analysis.conf.medium': 'Medium confidence',
  'analysis.conf.low': 'Low confidence',

  // Inputs (questions)
  'analysis.input.camera': 'your camera',
  'analysis.input.gameplay': 'your gameplay',
  'analysis.input.camera.question': 'Do you have face-to-camera footage?',
  'analysis.input.gameplay.question': 'Do you have gameplay footage?',
  'analysis.input.camera.help': 'Your face-to-camera takes, in 1080p, clean sound, one take per section.',
  'analysis.input.gameplay.help': '10 to 30 min of gameplay without voice, in 1080p.',

  // Pipeline origins
  'analysis.origin.template': 'Template',
  'analysis.origin.own': 'Yours',
  'analysis.origin.team': 'Team',
  'analysis.origin.builder': 'Builder',
  'analysis.origin.analysis': 'Analysis',
  'analysis.origin.import': 'Imported',

  // Validation problems (code to sentence), shown with their path
  'analysis.val.json': 'This is not readable JSON.',
  'analysis.val.empty': 'The document is empty.',
  'analysis.val.too_large': 'The document is too large (200,000 characters at most).',
  'analysis.val.schema': 'Missing field or wrong shape.',
  'analysis.val.duplicate_id': 'Identifier declared twice.',
  'analysis.val.unknown_node_type': 'Node type not in the catalogue.',
  'analysis.val.bad_params': 'Setting rejected by the node.',
  'analysis.val.unknown_ref': 'Reference to a node, output or input that does not exist.',
  'analysis.val.unknown_port': 'This node has no such input.',
  'analysis.val.missing_input': 'Required input not connected.',
  'analysis.val.type_mismatch': 'These types do not connect: the output does not fit this input.',
  'analysis.val.cycle': 'The graph loops back on itself.',
  'analysis.val.bad_where': 'This node cannot run there.',
  'analysis.val.unknown': 'Validation problem.',
  'analysis.val.root': 'document',
  'analysis.val.title': '{n} problem(s): nothing is saved',

  // Diff
  'analysis.diff.same': 'No differences.',
  'analysis.diff.stats': '+{added} · −{removed}',
  'analysis.diff.label': 'Differences',

  // Cost per mode
  'analysis.cost.title': 'Cost by mode',
  'analysis.cost.perMinute': '{n} credits / min',
  'analysis.cost.video': '{m} min video: {n} credits',
  'analysis.cost.free': 'Free (your computer or your Claude Code)',
  'analysis.cost.note': 'Estimate based on Atelier Cloud’s indicative price list; local nodes and Claude Code cost 0 credits.',

  'analysis.common.example': 'Example',
  'analysis.common.cancel': 'Cancel',
  'analysis.common.close': 'Close',
  'analysis.common.save': 'Save',
  'analysis.common.saving': 'Saving…',
  'analysis.common.version': 'v{n}',
  'analysis.common.loadingError': 'Could not load: {e}'
}
