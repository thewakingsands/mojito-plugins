const deepeye = {
  InstanceContentType: 'DeepDungeon',
  Aggro: 'Sight',
  Threat: 'Easy',
  Weakness: ['Stun', 'Heavy', 'Slow', 'Bind', 'Sleep'],
}
const knight = { InstanceContentType: 'DeepDungeon', Aggro: 'Proximity', Threat: 'Easy', Weakness: ['Undead'] }

export const overrides = [
  {
    id: 12161,
    keep: [
      'DD/EO/1-50.yml',
      'Orthos apa',
      {
        InstanceContentType: 'DeepDungeon',
        Aggro: 'Proximity',
        Threat: 'Easy',
        Weakness: ['Stun', 'Heavy', 'Slow', 'Sleep'],
      },
    ],
    drop: ['DD/EO/51-100.yml', 'Orthos deepeye', deepeye],
    notesTo: 12210,
    reason:
      'Both clients resolve 12161 to Orthos apa and 12210 to Orthos deepeye. The correct deepeye structure already exists at 12210; move only the miskeyed English and Simplified Chinese notes.',
  },
  {
    id: 5298,
    keep: ['DD/PotD/51-100.yml', 'Necrose knight', knight],
    drop: ['DD/Special.yml', 'necrose knight', { ...knight, Threat: 'Caution' }],
    reason:
      'MonsterDex selects the first match in index order. Keep the Easy PotD record and its own notes; the later Special record and its notes do not apply.',
  },
]
