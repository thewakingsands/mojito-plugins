import type { ClassJobActionsFile } from '../../defs.js'
import arcanist from './Arcanist.json' with { type: 'json' }
import astrologian from './Astrologian.json' with { type: 'json' }
import bard from './Bard.json' with { type: 'json' }
import beastmaster from './Beastmaster.json' with { type: 'json' }
import blackMage from './BlackMage.json' with { type: 'json' }
import blueMage from './BlueMage.json' with { type: 'json' }
import dancer from './Dancer.json' with { type: 'json' }
import darkKnight from './DarkKnight.json' with { type: 'json' }
import dragoon from './Dragoon.json' with { type: 'json' }
import gunbreaker from './Gunbreaker.json' with { type: 'json' }
import machinist from './Machinist.json' with { type: 'json' }
import monk from './Monk.json' with { type: 'json' }
import ninja from './Ninja.json' with { type: 'json' }
import paladin from './Paladin.json' with { type: 'json' }
import pictomancer from './Pictomancer.json' with { type: 'json' }
import reaper from './Reaper.json' with { type: 'json' }
import redMage from './RedMage.json' with { type: 'json' }
import rogue from './Rogue.json' with { type: 'json' }
import sage from './Sage.json' with { type: 'json' }
import samurai from './Samurai.json' with { type: 'json' }
import scholar from './Scholar.json' with { type: 'json' }
import summoner from './Summoner.json' with { type: 'json' }
import viper from './Viper.json' with { type: 'json' }
import warrior from './Warrior.json' with { type: 'json' }
import whiteMage from './WhiteMage.json' with { type: 'json' }

/** The file of each class and job, by ascending ID; periodic-potency.mjs writes them */
export const classJobActions: readonly ClassJobActionsFile[] = [
  { name: 'ClassJobActions/Paladin', content: paladin },
  { name: 'ClassJobActions/Monk', content: monk },
  { name: 'ClassJobActions/Warrior', content: warrior },
  { name: 'ClassJobActions/Dragoon', content: dragoon },
  { name: 'ClassJobActions/Bard', content: bard },
  { name: 'ClassJobActions/WhiteMage', content: whiteMage },
  { name: 'ClassJobActions/BlackMage', content: blackMage },
  { name: 'ClassJobActions/Arcanist', content: arcanist },
  { name: 'ClassJobActions/Summoner', content: summoner },
  { name: 'ClassJobActions/Scholar', content: scholar },
  { name: 'ClassJobActions/Rogue', content: rogue },
  { name: 'ClassJobActions/Ninja', content: ninja },
  { name: 'ClassJobActions/Machinist', content: machinist },
  { name: 'ClassJobActions/DarkKnight', content: darkKnight },
  { name: 'ClassJobActions/Astrologian', content: astrologian },
  { name: 'ClassJobActions/Samurai', content: samurai },
  { name: 'ClassJobActions/RedMage', content: redMage },
  { name: 'ClassJobActions/BlueMage', content: blueMage },
  { name: 'ClassJobActions/Gunbreaker', content: gunbreaker },
  { name: 'ClassJobActions/Dancer', content: dancer },
  { name: 'ClassJobActions/Reaper', content: reaper },
  { name: 'ClassJobActions/Sage', content: sage },
  { name: 'ClassJobActions/Viper', content: viper },
  { name: 'ClassJobActions/Pictomancer', content: pictomancer },
  { name: 'ClassJobActions/Beastmaster', content: beastmaster },
]
